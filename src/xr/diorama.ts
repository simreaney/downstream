/**
 * The catchment as a tabletop diorama, for a headset.
 *
 * On a screen the game is a miniature photographed from across a table; in a
 * headset it becomes one. The player's head is tracked one to one and the game
 * never moves it. What moves is the world: it is scaled down, turned and slid
 * so that the character stands on an imaginary table in front of the player,
 * and it glides along under them as the character walks.
 *
 * That split is what keeps it comfortable. VR sickness comes from the view
 * moving in ways the inner ear did not feel — smooth rotation and sudden lurches
 * above all. Here the horizon never tilts, turning happens in snaps, and
 * walking is a model landscape sliding past at about the speed of a slow
 * stroll, which is how Moss and Astro Bot keep third-person VR comfortable.
 *
 * ## One transform does all of it
 *
 * The rig is the parent of the camera, and three reports the headset's pose
 * relative to it. It carries a uniform scale S, and three applies the rig's
 * world matrix to both eye cameras, interpupillary offset included, so S = 18
 * makes the player an eighteen-times giant and the world reads as a 1:18
 * model with nothing in the scene itself changed. View space comes out in real
 * metres as a result, which has two side effects `mode.ts` deals with:
 *
 * - The curved-world bend is k·d² in view space and k is tuned per world
 *   metre, so it all but vanishes. A tabletop is flat, so it is switched off
 *   outright rather than left as a sub-millimetre wobble.
 * - Fog density is per view-space metre too, so it is rescaled by S to keep
 *   the haze where it was in world terms.
 *
 * ## Zoom ends with the whole catchment on the table
 *
 * Zooming changes S. At the default the character is a figure about 15 cm
 * tall a forearm's length away, with the valley around it; fully out, the whole
 * catchment is a board about 1.4 m across. On the way out the focus drifts
 * from the character to the middle of the catchment, and the table moves a
 * little further away, so that the board ends up laid out in front of the
 * player rather than with one corner through their chest.
 */

import * as THREE from "three";
import { approach, clamp, lerp, smoothstep } from "../core/clamp";
import type { GridSpec } from "../core/grid";
import { sampleHeight } from "../render/terrainMesh";

/** World metres per real metre at the default zoom. */
export const DEFAULT_XR_SCALE = 18;
/** Closest zoom: the character is nearly half a metre tall. */
const MIN_SCALE = 6;

/** Width the whole catchment shrinks to at full zoom-out, in real metres. */
const BOARD_WIDTH_M = 1.4;

/**
 * Where the table is, relative to the eyes when the session starts.
 *
 * Taken from the headset's own height rather than fixed above the floor, so
 * it suits a player standing or sitting.
 */
const TABLE_BELOW_EYES_M = 0.5;
const TABLE_MIN_HEIGHT_M = 0.3;
/** How far in front of the player the focus sits: close up, and at full zoom-out. */
const NEAR_DISTANCE_M = 0.55;
const BOARD_DISTANCE_M = 0.95;

/** One snap turn, in radians. Thirty degrees is the common comfort default. */
export const SNAP_TURN_RAD = Math.PI / 6;

/** Time constants, in seconds: the focus following the character, and zoom easing. */
const FOLLOW_TAU = 0.12;
const ZOOM_TAU = 0.14;

/**
 * Real metres kept between the eyes and the ground beneath them.
 *
 * The desktop camera lifts over rising ground for the same reason. Without it,
 * a player on a steep hillside puts the slope behind them through the
 * headset, where the terrain's back faces are culled and the world vanishes.
 */
const HEAD_CLEARANCE_M = 0.15;
/** Slower than the follow, so the world sinks out of the way rather than jumping. */
const LIFT_TAU = 0.3;

export interface DioramaOptions {
  /** The camera's parent. Its transform is rewritten every update. */
  readonly rig: THREE.Object3D;
  /** The ground as drawn — what the player walks on. */
  readonly dem: Float32Array;
  readonly spec: GridSpec;
  /** Height the board centres on when fully zoomed out; the catchment's mean elevation. */
  readonly centreElevation: number;
}

export interface Diorama {
  /** World metres per real metre, after easing. */
  readonly scale: number;
  /** How far the table has been turned, in radians about Y. */
  readonly yaw: number;
  /** 0 at the default zoom and closer, 1 with the whole catchment on the table. */
  readonly overview: number;
  /**
   * World-space distance from the eyes to the focus: what the desktop follow
   * camera calls its distance, for sizing the shadowed region.
   */
  readonly viewDistance: number;
  /** Where the table is in rig space (real metres), once a head pose has fixed its height. */
  readonly anchor: THREE.Vector3;
  /** Whether the table height has been fixed from a head pose yet. */
  readonly placed: boolean;
  /**
   * Movement heading for the player controller, in the follow camera's
   * convention: forward is (sin h, 0, cos h) in world space. Taken from the
   * head's yaw, so pushing the stick forward walks the way the player looks.
   */
  heading(headQuaternion: THREE.Quaternion): number;
  /** Turn the table by whole snaps. Positive turns the view left, as the gamepad's orbit does. */
  turn(steps: number): void;
  /** Step to the next zoom stop outwards, wrapping back in from the board view. */
  cycleZoom(): void;
  /**
   * Start afresh, for a new session: forget the table height, snap rather than
   * ease on the next update, and face along `heading` (same convention as
   * `heading()`), so the headset opens looking where the screen was.
   */
  reset(heading: number): void;
  /**
   * Place the rig so the focus sits on the table.
   *
   * `head` is the headset's position in rig space — the XR reference space, in
   * real metres. `zoom` is a change in the log of the scale, as
   * `InputState.zoom` reports it: positive pulls back.
   */
  update(target: THREE.Vector3, head: THREE.Vector3, dt: number, zoom: number): void;
}

export function createDiorama(options: DioramaOptions): Diorama {
  const { rig, dem, spec, centreElevation } = options;

  const extent = Math.max(spec.width, spec.height) * spec.cellSize;
  const maxScale = Math.max(DEFAULT_XR_SCALE * 4, extent / BOARD_WIDTH_M);
  const logSpan = Math.log(maxScale / DEFAULT_XR_SCALE);
  /** Close, halfway in log terms, and the whole board — as the desktop zoom button steps. */
  const zoomStops = [DEFAULT_XR_SCALE, Math.sqrt(DEFAULT_XR_SCALE * maxScale), maxScale];

  let scale = DEFAULT_XR_SCALE;
  let targetScale = DEFAULT_XR_SCALE;
  let yaw = 0;
  let overview = 0;
  let viewDistance = DEFAULT_XR_SCALE * NEAR_DISTANCE_M;
  let lift = 0;
  let tableHeight: number | null = null;
  let initialised = false;

  const focus = new THREE.Vector3();
  const wanted = new THREE.Vector3();
  const anchor = new THREE.Vector3(0, 0, -NEAR_DISTANCE_M);
  const headWorld = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const euler = new THREE.Euler(0, 0, 0, "YXZ");

  return {
    get scale() {
      return scale;
    },
    get yaw() {
      return yaw;
    },
    get overview() {
      return overview;
    },
    get viewDistance() {
      return viewDistance;
    },
    get anchor() {
      return anchor;
    },
    get placed() {
      return tableHeight !== null;
    },

    heading(headQuaternion) {
      // YXZ isolates yaw from pitch, so looking down at the table — which a
      // player does most of the time — still gives a steady heading. The
      // headset looks down its own -z, hence the half turn.
      euler.setFromQuaternion(headQuaternion, "YXZ");
      return yaw + euler.y + Math.PI;
    },

    turn(steps) {
      yaw += steps * SNAP_TURN_RAD;
    },

    cycleZoom() {
      const next = zoomStops.find((stop) => stop > targetScale * 1.05);
      targetScale = next ?? zoomStops[0];
    },

    reset(heading) {
      yaw = heading - Math.PI;
      tableHeight = null;
      lift = 0;
      initialised = false;
    },

    update(target, head, dt, zoom) {
      if (tableHeight === null) tableHeight = Math.max(TABLE_MIN_HEIGHT_M, head.y - TABLE_BELOW_EYES_M);

      // Eased in log space, as the desktop zoom is, so stepping from close-up
      // to the board takes as long to settle as a small adjustment.
      targetScale = clamp(targetScale * Math.exp(zoom), MIN_SCALE, maxScale);
      const ease = initialised ? 1 - Math.exp(-dt / ZOOM_TAU) : 1;
      scale = Math.exp(Math.log(scale) + (Math.log(targetScale) - Math.log(scale)) * ease);

      overview = clamp(Math.log(scale / DEFAULT_XR_SCALE) / logSpan, 0, 1);
      // Held on the character for the first third of the zoom range, so a
      // modest pull-back still keeps the player's figure in the middle.
      const board = smoothstep(0.35, 1, overview);

      // The character's feet, not their chest: the ground they stand on is
      // the table top.
      wanted.set(
        lerp(target.x, 0, board),
        lerp(target.y, centreElevation, board),
        lerp(target.z, 0, board),
      );
      if (!initialised) focus.copy(wanted);
      else focus.lerp(wanted, 1 - Math.exp(-dt / FOLLOW_TAU));

      anchor.set(0, tableHeight, -lerp(NEAR_DISTANCE_M, BOARD_DISTANCE_M, board));

      // Solve for the rig that maps the anchor onto the focus:
      //   focus = position + scale · R(yaw) · anchor
      rig.quaternion.setFromAxisAngle(up, yaw);
      rig.scale.setScalar(scale);
      rig.position.copy(anchor).applyQuaternion(rig.quaternion).multiplyScalar(-scale).add(focus);

      // Then raise the rig — sinking the world — if the eyes would otherwise
      // be inside a hill.
      headWorld.copy(head).applyQuaternion(rig.quaternion).multiplyScalar(scale).add(rig.position);
      const ground = sampleHeight(dem, spec, headWorld.x, headWorld.z);
      const wantedLift = Math.max(0, ground + HEAD_CLEARANCE_M * scale - headWorld.y);
      lift = initialised ? approach(lift, wantedLift, LIFT_TAU, dt) : wantedLift;
      rig.position.y += lift;

      viewDistance = scale * head.distanceTo(anchor);
      initialised = true;
      rig.updateMatrixWorld(true);
    },
  };
}
