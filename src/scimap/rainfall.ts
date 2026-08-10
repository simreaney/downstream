/**
 * Rainfall field and its normalisation.
 *
 * SCIMAP weights contributing area by rainfall so that a wet upland tributary is
 * recognised as delivering more water — and therefore diluting its sediment more
 * — than a dry lowland one carrying the same load.
 *
 * What matters is the *pattern*, not the depth: the field is divided by its own
 * catchment mean before use, giving a dimensionless multiplier near 1. That
 * normalisation is why the same code serves both a real rainfall raster and the
 * synthetic orographic gradient generated here, and why changing the absolute
 * rainfall total cannot move the risk map.
 */

import { nanMean } from "../core/stats";

/**
 * Fractional rainfall increase from the lowest point of the catchment to the
 * highest. Uplands really are wetter, and 35% across 180 m of relief is a
 * conservative reading of typical orographic enhancement.
 */
const OROGRAPHIC_GAIN = 0.35;

/** Synthetic rainfall field: a simple orographic increase with elevation. */
export function generateRainfall(dem: Float64Array, out?: Float64Array): Float64Array {
  const n = dem.length;
  const rain = out && out.length === n ? out : new Float64Array(n);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = dem[i];
    if (!Number.isFinite(z)) continue;
    if (z < min) min = z;
    if (z > max) max = z;
  }

  const span = max - min;
  const invSpan = span > 0 ? 1 / span : 0;
  for (let i = 0; i < n; i++) {
    rain[i] = 1 + OROGRAPHIC_GAIN * (dem[i] - min) * invSpan;
  }
  return rain;
}

/**
 * Divide rainfall by its own catchment mean, in place.
 *
 * The result averages 1, so contributing area weighted by it stays in the same
 * units as unweighted area and every constant tuned against the unweighted case
 * keeps its meaning.
 */
export function scaleRainfall(rain: Float64Array, valid?: Uint8Array): Float64Array {
  const mean = nanMean(rain, valid);
  if (!Number.isFinite(mean) || mean <= 0) {
    rain.fill(1);
    return rain;
  }
  const inv = 1 / mean;
  for (let i = 0; i < rain.length; i++) rain[i] *= inv;
  return rain;
}
