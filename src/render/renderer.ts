/**
 * WebGL renderer setup and the single requestAnimationFrame loop.
 *
 * Everything that wants per-frame time registers a callback here rather than
 * starting its own loop, so there is exactly one place where frame budget can be
 * measured and exactly one place that knows about pause and visibility state.
 */

import * as THREE from "three";

/** Called once per frame with seconds since the previous frame and total elapsed. */
export type FrameCallback = (dt: number, elapsed: number) => void;

export interface Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  onFrame(callback: FrameCallback): () => void;
  start(): void;
  stop(): void;
  dispose(): void;
}

/**
 * Device pixel ratio is capped at 2. Beyond that the fill cost roughly doubles
 * again for a difference nobody can see on the soft, smoothly shaded art,
 * and phones with ratio 3 are exactly the devices that can least afford it.
 */
const MAX_PIXEL_RATIO = 2;

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  gl.outputColorSpace = THREE.SRGBColorSpace;
  // No tone mapping. ACES is a filmic curve built to make photographic highlights
  // roll off gracefully, and it does that by desaturating as values rise — which
  // is the opposite of what an authored pastel palette needs: it turned the
  // river's blue to grey and washed the fields pale. With the curve removed,
  // colours arrive as authored, and the lights below are set so that lit
  // surfaces land just under 1.0 rather than clipping.
  gl.toneMapping = THREE.NoToneMapping;
  gl.shadowMap.enabled = true;
  // PCF with a wide filter radius (set on the light) rather than the old soft
  // variant, which three now maps onto this anyway: the radius is what gives the
  // faint, feathered overcast-day shadows the art direction asks for.
  gl.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5ecdc);

  // A narrow field of view from further back, for the flattened, miniature
  // perspective of a diorama photographed from across the table. See
  // `camera.ts` for the framing that goes with it.
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 4000);
  camera.position.set(0, 40, 60);
  camera.lookAt(0, 0, 0);

  const callbacks = new Set<FrameCallback>();
  // Timer rather than the deprecated Clock. Connected to the document so a tab
  // that was hidden resumes with a fresh delta instead of the whole absence.
  const timer = new THREE.Timer();
  timer.connect(document);
  let running = false;

  const resize = (): void => {
    // Re-read on every resize: dragging the window to a display with a
    // different pixel ratio fires one, and the buffer should follow.
    gl.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    gl.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const tick = (timestamp: number): void => {
    timer.update(timestamp);
    // Clamp dt so a stalled frame cannot take a huge step that teleports the
    // player through terrain or destabilises the storm routing.
    const dt = Math.min(timer.getDelta(), 0.1);
    const elapsed = timer.getElapsed();
    for (const callback of callbacks) callback(dt, elapsed);
    gl.render(scene, camera);
  };

  window.addEventListener("resize", resize);
  resize();

  return {
    gl,
    scene,
    camera,
    onFrame(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    start() {
      if (running) return;
      running = true;
      timer.reset();
      gl.setAnimationLoop(tick);
    },
    stop() {
      running = false;
      gl.setAnimationLoop(null);
    },
    dispose() {
      this.stop();
      window.removeEventListener("resize", resize);
      callbacks.clear();
      timer.dispose();
      gl.dispose();
    },
  };
}
