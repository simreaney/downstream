/**
 * The base surface: a domain-warped ridged multifractal in [0, 1].
 *
 * This is texture, not structure. It supplies plausible ridge and hollow detail
 * for the droplet erosion to organise into drainage, while `conditioning.ts`
 * supplies the catchment-scale shape that makes the whole grid drain to one
 * outlet. Neither alone produces terrain SCIMAP can read.
 */

import type { GridSpec } from "../core/grid";
import type { Rng } from "../core/rng";
import { createNoise2D, domainWarp, ridged, type FbmOptions } from "./noise";

const BASE_FBM: FbmOptions = {
  octaves: 6,
  lacunarity: 2.0,
  gain: 0.5,
  // One primary landform across the catchment, dissected by finer octaves.
  frequency: 2.2,
};

/** How far, in noise units, the warp displaces the sample point. */
const WARP_STRENGTH = 0.22;
const WARP_FREQUENCY = 1.6;

export function generateBaseSurface(spec: GridSpec, rng: Rng): Float64Array {
  const noise = createNoise2D(rng);
  const surface = new Float64Array(spec.width * spec.height);

  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < spec.height; row++) {
    // Sample in normalised [0, 1] domain coordinates so the field is independent
    // of grid resolution — changing the grid must not change the landform.
    const v = row / spec.height;
    for (let col = 0; col < spec.width; col++) {
      const u = col / spec.width;
      const [wx, wy] = domainWarp(noise, u, v, WARP_STRENGTH, WARP_FREQUENCY);
      const value = ridged(noise, wx, wy, BASE_FBM);

      surface[row * spec.width + col] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  // Normalise to [0, 1] so the conditioning constants below mean the same thing
  // for every seed, rather than drifting with whatever range the noise happened
  // to produce.
  const span = max - min;
  const invSpan = span > 0 ? 1 / span : 0;
  for (let i = 0; i < surface.length; i++) surface[i] = (surface[i] - min) * invSpan;

  return surface;
}
