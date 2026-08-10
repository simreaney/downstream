/**
 * Sun, sky bounce, and a shadow camera that follows the player.
 *
 * Two lights only. A directional sun gives the toon ramp a clean terminator, and
 * a hemisphere light fills the shadows with sky blue from above and bounced
 * ground green from below — which is what stops shadowed slopes reading as dead
 * grey and is most of why the Animal Crossing palette feels warm.
 *
 * The shadow camera is the interesting part. A single orthographic camera
 * covering all 1 km² of catchment would spread a 2048px map over a million
 * square metres — about half a metre per texel, so a tree's shadow would be four
 * blurry pixels. Instead the camera covers a small box around the player and
 * travels with them, giving roughly 5 cm per texel where it matters. Distant
 * terrain simply goes unshadowed, which nobody notices because the toon ramp
 * already gives every slope its own shading band.
 */

import * as THREE from "three";
import { isLowPower } from "../config";

/** Half-width of the shadowed region around the player, in metres. */
const SHADOW_RADIUS_M = 55;

/**
 * Shadow map resolution, halved on low-power devices.
 *
 * At 55 m of coverage even 1024 gives about 11 cm per texel, which is still
 * finer than the toon ramp's banding can show — so the fallback costs almost
 * nothing visually and a quarter of the shadow pass.
 */
const SHADOW_MAP_SIZE = isLowPower() ? 1024 : 2048;

export interface Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly sky: THREE.HemisphereLight;
  /** Keep the shadow camera centred on a moving target. */
  follow(target: THREE.Vector3): void;
  setTimeOfDay(fraction: number): void;
}

export function createLighting(scene: THREE.Scene): Lighting {
  const sun = new THREE.DirectionalLight(0xfff6e4, 1.3);
  sun.position.set(-140, 190, 110);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 520;
  sun.shadow.camera.left = -SHADOW_RADIUS_M;
  sun.shadow.camera.right = SHADOW_RADIUS_M;
  sun.shadow.camera.top = SHADOW_RADIUS_M;
  sun.shadow.camera.bottom = -SHADOW_RADIUS_M;
  // Terrain is a huge, gently curved surface, so depth precision is tight and
  // ordinary bias produces either acne on the flats or peter-panning on slopes.
  // Normal bias offsets along the surface normal instead, which handles both.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;

  scene.add(sun);
  scene.add(sun.target);

  const sky = new THREE.HemisphereLight(0xbfe3ff, 0x7d8a52, 0.45);
  scene.add(sky);

  const offset = sun.position.clone();

  return {
    sun,
    sky,

    follow(target) {
      // Snap the shadow camera to whole texels. Without this the shadow map
      // resamples every frame as the player walks and every shadow edge crawls,
      // which is far more distracting than a slightly stale shadow position.
      const texelSize = (2 * SHADOW_RADIUS_M) / SHADOW_MAP_SIZE;
      const snappedX = Math.round(target.x / texelSize) * texelSize;
      const snappedZ = Math.round(target.z / texelSize) * texelSize;

      sun.target.position.set(snappedX, target.y, snappedZ);
      sun.position.set(snappedX + offset.x, target.y + offset.y, snappedZ + offset.z);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    },

    setTimeOfDay(fraction) {
      // A shallow arc: the sun never gets low enough for the shadow camera's far
      // plane to run out, and never so high that slopes lose their modelling.
      const angle = Math.PI * (0.18 + 0.64 * fraction);
      offset.set(Math.cos(angle) * 180, Math.sin(angle) * 190 + 40, 110);

      const warmth = 1 - Math.abs(fraction - 0.5) * 2;
      sun.color.setHSL(0.09 - warmth * 0.02, 0.35 - warmth * 0.15, 0.62 + warmth * 0.08);
    },
  };
}
