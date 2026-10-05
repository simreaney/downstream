/**
 * Immersive VR, aimed at a standalone headset such as a Meta Quest.
 *
 * Everything that exists only in a headset lives behind this module: the page's
 * "Enter VR" button, the session, the camera rig that `diorama.ts` scales and
 * slides, the controllers (`controls.ts`) and their pointer, the headset HUD
 * (`hud.ts`), and the plinth under the board. `main.ts` asks each frame whether
 * a session is presenting and, if one is, takes the player's intent and heading
 * from here instead of from the page's input and follow camera. The rest of the
 * game — building, the model, storms, scoring — cannot tell the difference.
 *
 * The game loop needs no changes to run in a headset. It already runs through
 * three's `setAnimationLoop`, which hands over to the session's own frame
 * clock while presenting, and three renders both eyes from the one camera.
 */

import * as THREE from "three";
import { isStandaloneHeadset } from "../config";
import { clamp } from "../core/clamp";
import type { GameAction, InputState } from "../player/input";
import type { Renderer } from "../render/renderer";
import type { WorldScene } from "../render/scene";
import type { Tutorial } from "../ui/tutorial";
import { createXrControls, type XrControls } from "./controls";
import { createDiorama, type Diorama } from "./diorama";
import type { DashboardButton, XrHud } from "./hud";
import { createPlinth } from "./plinth";
import { correctUnionCamera } from "./unionCamera";

/**
 * Depth range while presenting, in real metres — view space is real metres
 * once the rig is scaled (see `diorama.ts`). Near enough for a hand held up
 * to the face; far enough for the far divide at the closest zoom.
 */
const XR_NEAR = 0.05;
const XR_FAR = 1000;

/** Length of the pointer stub when it is not over the dashboard, in metres. */
const RAY_STUB_M = 0.08;

/**
 * Frames per shadow-map redraw while presenting on a standalone headset.
 *
 * The shadow pass draws every tree in the catchment — they are all unculled,
 * for the curved world — so it costs about as much as an eye. Every other frame
 * is still 36 Hz, which is fine for shadows that are faint and soft, and only
 * the character's ever moves. The lookup stays consistent in between, because
 * three only moves the shadow matrix when it redraws the map.
 */
const HEADSET_SHADOW_INTERVAL = 2;

/** Seconds without a controller before the player is asked to pick one up. */
const MISSING_CONTROLLERS_GRACE = 1.5;

export interface XrModeOptions {
  readonly renderer: Renderer;
  readonly scene: WorldScene;
  readonly hud: XrHud;
  readonly tutorial: Tutorial;
  /** Where the page's "Enter VR" button goes. */
  readonly buttonHost: HTMLElement;
  /** The follow camera's heading, so the headset opens looking the way the screen was. */
  readonly heading: () => number;
  /** Tell the player something, on the page or in the headset. */
  readonly notify: (message: string) => void;
  /** Called once the session has ended and the page's camera is its own again. */
  readonly onExit: () => void;
}

export interface XrMode {
  /** Whether a headset session is presenting. Everything else is only meaningful while it is. */
  readonly presenting: boolean;
  /** Walk, run and zoom intent, and this frame's actions — controller buttons and dashboard presses. */
  readonly state: InputState;
  /** Movement heading for the player controller; see `Diorama.heading`. */
  readonly heading: number;
  /** The headset's position in world space, for the see-through window into the trees. */
  readonly eye: THREE.Vector3;
  readonly diorama: Diorama;
  /** Read the controllers and the pointer. Call first in a frame. */
  poll(dt: number): void;
  /**
   * Put the world on the table around the character, and the HUD around both.
   * Call every presenting frame, after the player has moved: it also updates
   * the headset's camera, which three no longer does by itself in a session.
   */
  update(feet: THREE.Vector3, dt: number): void;
  /** A short buzz in the right hand: a build, a refusal, a pickup. */
  pulse(strength: number, ms: number): void;
}

interface Hand {
  readonly group: THREE.XRTargetRaySpace;
  readonly ray: THREE.Mesh;
  handedness: XRHandedness | null;
}

/** The dashboard's buttons that are plain game actions, under the same names. */
const DASHBOARD_ACTIONS: Partial<Record<DashboardButton, GameAction>> = {
  toolTree: "toolTree",
  toolDam: "toolDam",
  toolPond: "toolPond",
  overlayNext: "overlayNext",
  overlayOff: "overlayOff",
  storm: "storm",
  undo: "undo",
  save: "save",
};

/**
 * A soft marker at each controller and a pointer ray from the right one.
 *
 * Procedural, like every other prop in the game, rather than the controller
 * models three can fetch from a CDN: the game has no binary assets and makes
 * no requests beyond its own files.
 */
function createHand(group: THREE.XRTargetRaySpace): Hand {
  const marker = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.012, 0.035, 4, 12).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xfdf6e3, fog: false }),
  );
  marker.position.z = 0.02;
  group.add(marker);

  // Drawn over the dashboard, which itself ignores depth, so it is never
  // swallowed by the panel it is pointing at.
  const ray = new THREE.Mesh(
    new THREE.BoxGeometry(0.003, 0.003, 1).translate(0, 0, -0.5),
    new THREE.MeshBasicMaterial({
      color: 0x4fb286,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }),
  );
  ray.renderOrder = 2002;
  ray.visible = false;
  group.add(ray);

  return { group, ray, handedness: null };
}

export function createXrMode(options: XrModeOptions): XrMode {
  const { renderer, scene, hud, tutorial } = options;
  const gl = renderer.gl;
  const camera = renderer.camera;

  const rig = new THREE.Group();
  rig.name = "xr-rig";
  renderer.scene.add(rig);
  rig.add(hud.dashboard);
  renderer.scene.add(hud.label);

  const plinth = createPlinth(scene.renderDem, scene.spec);
  renderer.scene.add(plinth);

  let centreElevation = 0;
  for (let i = 0; i < scene.groundDem.length; i++) centreElevation += scene.groundDem[i];
  centreElevation /= scene.groundDem.length;

  const diorama = createDiorama({ rig, dem: scene.groundDem, spec: scene.spec, centreElevation });
  const controls: XrControls = createXrControls();
  const extent = Math.max(scene.spec.width, scene.spec.height) * scene.spec.cellSize;

  const hands: Hand[] = [0, 1].map((index) => {
    const hand = createHand(gl.xr.getController(index));
    hand.group.addEventListener("connected", (event) => {
      hand.handedness = event.data.handedness;
    });
    hand.group.addEventListener("disconnected", () => {
      hand.handedness = null;
      hand.ray.visible = false;
    });
    rig.add(hand.group);
    return hand;
  });

  let presenting = false;
  let heading = 0;
  let dashboardPlaced = false;
  let missingFor = 0;
  let pageFog = 0;
  let frame = 0;
  const shadowInterval = isStandaloneHeadset() ? HEADSET_SHADOW_INTERVAL : 1;
  const pageCamera = { near: camera.near, far: camera.far, fov: camera.fov };

  const head = new THREE.Vector3();
  const headQuaternion = new THREE.Quaternion();
  const eye = new THREE.Vector3();
  const rayDirection = new THREE.Vector3();
  const actions = new Set<GameAction>();

  const state: InputState = {
    get moveX() {
      return controls.state.moveX;
    },
    get moveZ() {
      return controls.state.moveZ;
    },
    lookX: 0,
    lookY: 0,
    get sprint() {
      return controls.state.sprint;
    },
    get zoom() {
      return controls.state.zoom;
    },
    get actions() {
      return actions;
    },
  };

  /** The headset's pose in rig space: the midpoint between the eyes, and the left eye's orientation. */
  const readHead = (): void => {
    const xrCamera = gl.xr.getCamera();
    const eyes = xrCamera.cameras;
    if (eyes.length >= 2) head.copy(eyes[0].position).add(eyes[1].position).multiplyScalar(0.5);
    else head.copy(xrCamera.position);
    headQuaternion.copy(xrCamera.quaternion);
  };

  const press = (button: DashboardButton): void => {
    const action = DASHBOARD_ACTIONS[button];
    if (action) {
      actions.add(action);
      return;
    }
    if (button === "skipTutorial") tutorial.skip();
    if (button === "exit") void gl.xr.getSession()?.end();
  };

  gl.xr.addEventListener("sessionstart", () => {
    presenting = true;
    dashboardPlaced = false;
    missingFor = 0;
    rig.add(camera);
    camera.near = XR_NEAR;
    camera.far = XR_FAR;
    // Updated by hand at the end of `update` instead, so the culling camera
    // can be corrected for the rig's scale; see `unionCamera.ts`.
    gl.xr.cameraAutoUpdate = false;
    gl.shadowMap.autoUpdate = shadowInterval === 1;
    diorama.reset(options.heading());
    controls.reset();
    hud.show(true);
    plinth.visible = true;
    pageFog = renderer.scene.fog instanceof THREE.FogExp2 ? renderer.scene.fog.density : 0;
  });

  gl.xr.addEventListener("sessionend", () => {
    presenting = false;
    gl.xr.cameraAutoUpdate = true;
    gl.shadowMap.autoUpdate = true;
    rig.remove(camera);
    camera.scale.set(1, 1, 1);
    camera.near = pageCamera.near;
    camera.far = pageCamera.far;
    camera.fov = pageCamera.fov;
    camera.updateProjectionMatrix();
    if (renderer.scene.fog instanceof THREE.FogExp2) renderer.scene.fog.density = pageFog;
    hud.show(false);
    plinth.visible = false;
    for (const hand of hands) hand.ray.visible = false;
    options.onExit();
  });

  mountButton(options, gl);

  return {
    get presenting() {
      return presenting;
    },
    state,
    get heading() {
      return heading;
    },
    eye,
    diorama,

    poll(dt) {
      actions.clear();
      const session = gl.xr.getSession();
      controls.poll(session ? session.inputSources : [], dt);
      for (const action of controls.state.actions ?? []) actions.add(action);

      readHead();
      diorama.turn(controls.turn);
      heading = diorama.heading(headQuaternion);

      // The pointer: the right controller's ray against the dashboard. The
      // trigger presses whatever it is over, and builds when it is over
      // nothing — but never both, and pointing at the panel's background
      // does neither, so a missed button cannot drop a dam in the river.
      let hit = null;
      for (const hand of hands) {
        if (hand.handedness !== "right" || !hand.group.visible) {
          hand.ray.visible = false;
          continue;
        }
        rayDirection.set(0, 0, -1).applyQuaternion(hand.group.quaternion);
        hit = hud.point(hand.group.position, rayDirection);
        hand.ray.visible = true;
        hand.ray.scale.z = hit ? hit.distance : RAY_STUB_M;
      }
      if (!hit) hud.point(null);
      if (controls.select) {
        if (hit?.button) press(hit.button);
        else if (!hit) actions.add("build");
      }

      missingFor = controls.hasControllers ? 0 : missingFor + dt;
      hud.setControllersMissing(missingFor > MISSING_CONTROLLERS_GRACE);
    },

    update(feet, dt) {
      diorama.update(feet, head, dt, controls.state.zoom);
      if (!dashboardPlaced && diorama.placed) {
        hud.placeDashboard(diorama.anchor, head);
        dashboardPlaced = true;
      }
      eye.copy(head);
      rig.localToWorld(eye);

      // Keep the haze where it is in world terms (fog runs in view space,
      // which is now real metres), and thin it out towards the board view:
      // a model on a table has no aerial perspective.
      if (renderer.scene.fog instanceof THREE.FogExp2) {
        renderer.scene.fog.density = (diorama.scale / extent) * clamp(1 - diorama.overview, 0, 1);
      }

      hud.setTutorial(tutorial.current?.vrText ?? null);
      hud.placeLabel(feet, eye, diorama.scale);
      hud.update();

      // Last, once the rig has stopped moving for this frame: what three
      // would otherwise do inside render(), plus the correction.
      gl.xr.updateCamera(camera);
      correctUnionCamera(gl.xr.getCamera(), rig);
      if (shadowInterval > 1) gl.shadowMap.needsUpdate = frame % shadowInterval === 0;
      frame++;
    },

    pulse(strength, ms) {
      const session = gl.xr.getSession();
      if (!session) return;
      for (const source of session.inputSources) {
        if (source.handedness !== "right") continue;
        // Not every runtime implements pulse(); Quest's does.
        const pulsing = source.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms);
        void pulsing?.catch(() => undefined);
      }
    },
  };
}

/**
 * The page's "Enter VR" button, shown only where an immersive session can
 * actually start — so not on a desktop with no headset attached, and not in a
 * browser without WebXR at all.
 */
function mountButton(options: XrModeOptions, gl: THREE.WebGLRenderer): void {
  const xr = navigator.xr;
  if (!xr) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "hud__vr";
  button.textContent = "Enter VR";
  button.hidden = true;
  options.buttonHost.append(button);

  const check = (): void => {
    xr.isSessionSupported("immersive-vr")
      .then((supported) => {
        button.hidden = !supported;
      })
      .catch(() => {
        button.hidden = true;
      });
  };
  check();
  // A headset plugged in (or Link started) after the page loaded.
  xr.addEventListener("devicechange", check);

  button.addEventListener("click", () => {
    if (gl.xr.isPresenting) return;
    button.disabled = true;
    xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor", "layers"],
    })
      .then(async (session) => {
        // Floor-relative where the runtime offers it, so the table can be
        // placed from the player's own eye height; head-relative otherwise.
        const features = session.enabledFeatures;
        gl.xr.setReferenceSpaceType(!features || features.includes("local-floor") ? "local-floor" : "local");
        await gl.xr.setSession(session);
      })
      .catch((error: unknown) => {
        console.error(error);
        options.notify("The headset could not start a VR session");
      })
      .finally(() => {
        button.disabled = false;
      });
  });
}
