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
 * again for a difference nobody can see on the toon-shaded, flat-coloured art,
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
  // is the opposite of what flat, saturated toon colour needs. It turned the
  // river's blue to grey and washed the fields pale. With the curve removed,
  // colours arrive as authored, and the lights below are set so that lit
  // surfaces land just under 1.0 rather than clipping.
  gl.toneMapping = THREE.NoToneMapping;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd3e8);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
  camera.position.set(0, 40, 60);
  camera.lookAt(0, 0, 0);

  const callbacks = new Set<FrameCallback>();
  const clock = new THREE.Clock();
  let running = false;

  const resize = (): void => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    gl.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const tick = (): void => {
    // Clamp dt so a backgrounded tab does not resume with a huge step that
    // teleports the player through terrain or destabilises the storm routing.
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsed = clock.elapsedTime;
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
      clock.start();
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
      gl.dispose();
    },
  };
}
