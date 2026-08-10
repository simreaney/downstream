/**
 * Toon shading ramp.
 *
 * `MeshToonMaterial` quantises its diffuse lighting through a gradient map, so
 * the number of steps in this texture is literally the number of shading bands
 * in the world. Four is the Animal Crossing register: enough to read form, few
 * enough that surfaces stay flat blocks of colour rather than turning into
 * gradients.
 *
 * The steps are deliberately not evenly spaced. Real toon art gives the lit side
 * most of the range and compresses the shadow side, so that the terrain reads as
 * brightly lit with a crisp terminator rather than as half-dark.
 */

import * as THREE from "three";

/** Shade levels from fully shadowed to fully lit. */
const STEPS = [0.42, 0.68, 0.86, 1.0];

export function createToonRamp(): THREE.DataTexture {
  const data = new Uint8Array(STEPS.length * 4);
  STEPS.forEach((level, i) => {
    const value = Math.round(level * 255);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  });

  const texture = new THREE.DataTexture(data, STEPS.length, 1, THREE.RGBAFormat);
  // Nearest sampling is what makes the bands discrete; linear would restore the
  // smooth falloff the whole ramp exists to remove.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
