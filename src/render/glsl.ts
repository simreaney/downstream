/**
 * Shader snippets shared by the terrain, water and path materials.
 *
 * One copy, so the three surfaces that sit against each other — ground, river,
 * gravel — cannot drift into slightly different noise, and a precision fix
 * like the one below lands everywhere at once.
 */

import * as THREE from "three";

/**
 * Hash and value noise, declaring `cwHash(vec2)` and `cwNoise(vec2)`.
 *
 * Value noise, hashed rather than sampled: a texture lookup would need a
 * texture to author, ship and bind, and these surfaces only need something
 * stationary and band-limited to break their own flatness.
 *
 * The multiply is by a small constant and the fract comes first, which is the
 * part that matters. The finest ground octave has a 0.85 m wavelength and the
 * catchment is over a kilometre across, so its lattice coordinate reaches about
 * 1200 — and hashing that by multiplying up to five figures first spends the
 * whole float32 mantissa before the fract, collapsing 3600 lattice cells at the
 * far corner onto 235 distinct values. The far corner of the map then tiles
 * visibly.
 */
export const GLSL_NOISE = /* glsl */ `
  float cwHash(vec2 cell) {
    vec3 p = fract(vec3(cell.xyx) * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float cwNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    // Smoothstep weights, so the lattice does not show as a square grid of
    // creases — which, on ground already drawn in 4 m squares, would read as a
    // second and wrong grid.
    vec2 w = f * f * (3.0 - 2.0 * f);
    float a = cwHash(cell);
    float b = cwHash(cell + vec2(1.0, 0.0));
    float c = cwHash(cell + vec2(0.0, 1.0));
    float d = cwHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
  }
`;

/**
 * An sRGB hex colour as a GLSL `vec3` in the linear space shaders work in.
 *
 * Colours pasted into shader text bypass three's colour management, so they
 * must be converted here or they come out washed-out and too bright.
 */
export function glslColour(hex: number): string {
  const colour = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  return `vec3(${colour.r.toFixed(4)}, ${colour.g.toFixed(4)}, ${colour.b.toFixed(4)})`;
}
