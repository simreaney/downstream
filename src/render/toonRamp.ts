/**
 * Toon shading ramp.
 *
 * `MeshToonMaterial` reads its diffuse lighting through a gradient map indexed by
 * `N·L * 0.5 + 0.5`, so the shape of this texture is the shape of the light
 * falloff on every surface in the world.
 *
 * It used to be four nearest-sampled steps — hard cel bands. The art direction
 * is now a soft, toy-like diorama, so the ramp is a smooth curve sampled with
 * linear filtering: surfaces roll gently from lit to shaded with no visible
 * terminator line, the way a matte vinyl figure does under an overcast sky.
 *
 * Two properties carry the look:
 *
 * - **A high floor.** The fully shaded side still receives most of the light.
 *   On an overcast day the sun barely models form; most of what you see is sky.
 *   Combined with the strong hemisphere fill in `lighting.ts`, this keeps every
 *   surface high-key — nothing in the landscape is ever allowed to go gloomy.
 * - **A late, wide shoulder.** The curve does its turning well past the
 *   terminator (u = 0.5), so surfaces facing even vaguely towards the light sit
 *   near full brightness and the shading gradient lives on the far side of forms.
 *   That is what makes a canopy or a head read as a soft rounded volume rather
 *   than a half-lit ball.
 */

import * as THREE from "three";
import { smoothstep } from "../core/clamp";

/** Ramp resolution. Linear filtering does the rest. */
const RESOLUTION = 64;

/** Brightness of a surface facing directly away from the sun. */
const FLOOR = 0.52;

/** Where the ramp starts and finishes rising, in ramp coordinates (0.5 = terminator). */
const RISE_START = 0.22;
const RISE_END = 0.9;

export function createToonRamp(): THREE.DataTexture {
  const data = new Uint8Array(RESOLUTION * 4);
  for (let i = 0; i < RESOLUTION; i++) {
    const u = i / (RESOLUTION - 1);
    const level = FLOOR + (1 - FLOOR) * smoothstep(RISE_START, RISE_END, u);
    const value = Math.round(level * 255);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, RESOLUTION, 1, THREE.RGBAFormat);
  // Linear, so the ramp is a gradient rather than a staircase of 64 bands.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
