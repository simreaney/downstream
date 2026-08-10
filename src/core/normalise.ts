/**
 * Percentile stretching, and the frozen-baseline decision that the whole game
 * depends on.
 *
 * SCIMAP rescales erosion risk and connectivity to [0, 1] between their 5th and
 * 95th percentiles. It is explicitly a *relative* risk product: the output ranks
 * locations against each other within one catchment, and says nothing absolute.
 *
 * That property quietly destroys the core feedback loop of a game. Suppose the
 * player plants the worst arable field in the catchment. Its raw erosion risk
 * collapses — correct — but so does the grid's 95th percentile, so the stretch
 * span narrows and every *untouched* cell is rescaled upward. The map barely
 * changes, the score barely moves, and some places the player never visited
 * appear to have got worse. Everything is behaving exactly as specified and the
 * game is unplayable.
 *
 * So the endpoints are derived once, from the pristine catchment at t = 0, and
 * held fixed for the rest of the session. Improvement then reads as absolute: a
 * fully remediated catchment scores near zero everywhere, the legend means the
 * same thing in every frame, and a screenshot taken an hour apart is comparable.
 *
 * Two consequences worth knowing:
 *  - `StretchBounds` MUST be persisted in the save. Re-deriving it on load from
 *    an already-improved catchment resets the reference frame and silently zeroes
 *    every score.
 *  - After t = 0 the percentile sort never runs again, which removes the second
 *    largest cost from the per-placement budget.
 */

import { nanPercentiles } from "./stats";

/** Low and high endpoints of a stretch, in the source layer's own units. */
export type Bounds = readonly [low: number, high: number];

/** The frozen reference frame for every normalised layer. Part of the save. */
export interface StretchBounds {
  readonly erosion: Bounds;
  readonly connectivity: Bounds;
  readonly inChannel: Bounds;
}

export const DEFAULT_PERCENTILE_LOW = 5;
export const DEFAULT_PERCENTILE_HIGH = 95;

/**
 * Derive stretch endpoints from a layer. Call only at catchment generation.
 *
 * A degenerate span (constant layer) is widened by 1.0 rather than left at zero,
 * matching the reference implementation, so that `applyStretch` cannot divide by
 * zero and produce a grid of NaN.
 */
export function deriveBounds(
  values: Float64Array,
  mask?: Uint8Array,
  low = DEFAULT_PERCENTILE_LOW,
  high = DEFAULT_PERCENTILE_HIGH,
): Bounds {
  const [lo, hiRaw] = nanPercentiles(values, [low, high], mask);
  if (!Number.isFinite(lo)) return [0, 1];
  return [lo, hiRaw <= lo ? lo + 1.0 : hiRaw];
}

/**
 * Rescale to [0, 1] against fixed endpoints, clipped.
 *
 * Writes into `out`, which may alias `values`. Cells outside the mask become
 * NaN so that NoData never leaks into a downstream product as a real zero.
 */
export function applyStretch(
  values: Float64Array,
  bounds: Bounds,
  out: Float64Array,
  mask?: Uint8Array,
): Float64Array {
  const lo = bounds[0];
  const span = bounds[1] - bounds[0];
  const invSpan = span === 0 ? 0 : 1 / span;

  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) {
      out[i] = NaN;
      continue;
    }
    const v = values[i];
    if (!Number.isFinite(v)) {
      out[i] = NaN;
      continue;
    }
    const t = (v - lo) * invSpan;
    out[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return out;
}
