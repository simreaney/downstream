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

/**
 * Shade levels from fully shadowed to fully lit.
 *
 * The darkest step carries the whole shadow side of every surface in the world,
 * so it sets how gloomy the landscape is allowed to get. It was 0.42, which was
 * fine while the terrain had no occlusion term of its own; now that a hollow
 * also gives up sky fill, the two compound and a shaded dip in a wood came back
 * nearly black. Lifting the floor pays that back without touching the spacing
 * above it, which is what gives the lit side its range.
 */
const STEPS = [0.47, 0.7, 0.87, 1.0];

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
