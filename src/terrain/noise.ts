/**
 * Seeded gradient noise and the fractal sums built on it.
 *
 * Perlin-style gradient noise with a shuffled permutation table, rather than a
 * hash-per-call function, so that a given seed produces a bit-identical field on
 * every machine — hash functions that rely on float rounding do not.
 *
 * Nothing here knows about terrain; `ridgedFbm.ts` composes these into the
 * actual base surface.
 */

import type { Rng } from "../core/rng";

/** Samples 2D noise in roughly [-1, 1]. */
export type Noise2D = (x: number, y: number) => number;

/** The eight unit-ish gradient directions Perlin noise projects onto. */
const GRAD_X = new Float64Array([1, -1, 1, -1, 1, -1, 0, 0]);
const GRAD_Y = new Float64Array([1, 1, -1, -1, 0, 0, 1, -1]);

function fade(t: number): number {
  // 6t^5 - 15t^4 + 10t^3: zero first and second derivative at 0 and 1, so
  // adjacent cells meet without the visible grid creases linear blending gives.
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function createNoise2D(rng: Rng): Noise2D {
  // Fisher-Yates over 0..255, then duplicated so lookups never need a modulo.
  const perm = new Uint8Array(512);
  const source = new Uint8Array(256);
  for (let i = 0; i < 256; i++) source[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = source[i];
    source[i] = source[j];
    source[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = source[i & 255];

  return (x: number, y: number): number => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = fade(xf);
    const v = fade(yf);

    const aa = perm[perm[xi] + yi] & 7;
    const ab = perm[perm[xi] + yi + 1] & 7;
    const ba = perm[perm[xi + 1] + yi] & 7;
    const bb = perm[perm[xi + 1] + yi + 1] & 7;

    const dotAA = GRAD_X[aa] * xf + GRAD_Y[aa] * yf;
    const dotBA = GRAD_X[ba] * (xf - 1) + GRAD_Y[ba] * yf;
    const dotAB = GRAD_X[ab] * xf + GRAD_Y[ab] * (yf - 1);
    const dotBB = GRAD_X[bb] * (xf - 1) + GRAD_Y[bb] * (yf - 1);

    const lerpX0 = dotAA + u * (dotBA - dotAA);
    const lerpX1 = dotAB + u * (dotBB - dotAB);
    return lerpX0 + v * (lerpX1 - lerpX0);
  };
}

export interface FbmOptions {
  octaves: number;
  /** Frequency multiplier between octaves. */
  lacunarity: number;
  /** Amplitude multiplier between octaves. */
  gain: number;
  frequency: number;
}

export const DEFAULT_FBM: FbmOptions = {
  octaves: 6,
  lacunarity: 2.0,
  gain: 0.5,
  frequency: 1.0,
};

/** Standard fractal Brownian motion, normalised to roughly [-1, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, options: FbmOptions): number {
  let frequency = options.frequency;
  let amplitude = 1;
  let sum = 0;
  let norm = 0;

  for (let octave = 0; octave < options.octaves; octave++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    frequency *= options.lacunarity;
    amplitude *= options.gain;
  }
  return norm === 0 ? 0 : sum / norm;
}

/**
 * Ridged multifractal: `1 - |noise|`, squared, with each octave weighted by the
 * one above it.
 *
 * This is what produces sharp divides and rounded valley floors rather than the
 * blobby hills plain fBm gives. It matters beyond looks — the droplet erosion
 * pass needs coherent ridge lines to organise drainage around, and SCIMAP needs
 * a real drainage structure or the connectivity map is diffuse mush.
 */
export function ridged(noise: Noise2D, x: number, y: number, options: FbmOptions): number {
  let frequency = options.frequency;
  let amplitude = 1;
  let sum = 0;
  let norm = 0;
  let weight = 1;

  for (let octave = 0; octave < options.octaves; octave++) {
    let signal = 1 - Math.abs(noise(x * frequency, y * frequency));
    signal *= signal;

    // Weighting by the previous octave suppresses detail in the valleys and
    // concentrates it along the ridges, which is what makes the divides read.
    signal *= weight;
    weight = Math.min(Math.max(signal * 2, 0), 1);

    sum += signal * amplitude;
    norm += amplitude;
    frequency *= options.lacunarity;
    amplitude *= options.gain;
  }
  return norm === 0 ? 0 : sum / norm;
}

/**
 * Offset the sample point by another noise field before sampling.
 *
 * Straight fBm has a faint axis-aligned quality that reads as artificial once
 * it is a landscape you walk across. Warping the domain bends the features into
 * the meandering, slightly folded shapes real terrain has.
 */
export function domainWarp(
  noise: Noise2D,
  x: number,
  y: number,
  strength: number,
  frequency: number,
): [number, number] {
  const wx = noise(x * frequency + 3.7, y * frequency - 1.3);
  const wy = noise(x * frequency - 5.1, y * frequency + 8.9);
  return [x + wx * strength, y + wy * strength];
}
