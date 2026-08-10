/**
 * The Network Index: hydrological connectivity as the wettest-bottleneck along
 * the flow path to the channel network.
 *
 * The idea, from Lane et al. (2004), is that a place only delivers pollutant to
 * a river if there is a continuously wet path for it to travel along. A single
 * dry, steep, well-drained cell anywhere between a field and the stream breaks
 * that path regardless of how wet either end is. So connectivity is not the
 * average wetness along the route, nor the wetness at the source — it is the
 * *minimum*, the driest point the flow has to get past.
 *
 * The recurrence, transcribed from the reference implementation:
 *
 *     f(x) = twi(x)                    if x has no successor
 *     f(x) = min(twi(x), twi(d(x)))    if the successor is a channel cell
 *     f(x) = min(twi(x), f(d(x)))      otherwise
 *
 * ## Why a single sweep replaces pointer doubling
 *
 * The reference solves this by pointer doubling — repeatedly folding each cell's
 * value with its successor's while advancing successors two steps at a time —
 * which converges in log(path length) rounds of full-grid work. That is the
 * right structure for a GPU or a vectorised NumPy kernel, where the work is
 * parallel and the rounds are cheap.
 *
 * Here it is unnecessary, and the licence comes from `d8.ts`: steepest descent
 * starts at `bestGrad = 0` and compares with a strict `>`, so every successor is
 * strictly lower than its predecessor. The successor graph is therefore acyclic,
 * and elevation order *is* a topological order of it. Walking cells from lowest
 * to highest means `f(d(x))` is always already final when `f(x)` is computed, so
 * the whole recurrence resolves in one linear pass with no iteration, no
 * convergence check and no cycle handling.
 *
 * On the game's grid that is roughly 0.5 ms against something like 40 ms for
 * seventeen rounds of pointer doubling with its three array copies apiece —
 * which is the difference between the risk overlay updating as the player places
 * a feature and updating a noticeable beat afterwards.
 */

import { deriveBounds, applyStretch, type Bounds } from "../core/normalise";
import { STRETCH_HIGH, STRETCH_LOW } from "./constants";

/**
 * Solve the min-along-flow-path recurrence.
 *
 * `order` must be descending elevation — the same order the FD8 table carries —
 * and is walked backwards to visit cells from the bottom of the catchment up.
 *
 * Non-finite wetness values are skipped rather than propagated, matching the
 * reference's NaN-safe comparison: a NoData cell on the path must not wipe out
 * the connectivity of everything above it.
 */
export function networkIndexSweep(
  twi: Float64Array,
  downstream: Int32Array,
  order: Int32Array,
  channelMask: Uint8Array,
  valid?: Uint8Array,
  out?: Float64Array,
): Float64Array {
  const n = twi.length;
  const ni = out && out.length === n ? out : new Float64Array(n);
  ni.fill(NaN);

  for (let i = n - 1; i >= 0; i--) {
    const cell = order[i];
    if (valid && !valid[cell]) continue;

    let value = twi[cell];
    const next = downstream[cell];

    if (next >= 0) {
      // A channel cell terminates the path: fold in its own wetness and stop,
      // rather than continuing to the outlet. Without this the index would
      // measure connectivity to the sea instead of to the nearest watercourse,
      // and every cell in the catchment would report the same bottleneck.
      const candidate = channelMask[next] ? twi[next] : ni[next];
      if (Number.isFinite(candidate) && candidate < value) value = candidate;
    }

    ni[cell] = value;
  }
  return ni;
}

/**
 * Network Index stretched to [0, 1] — the connectivity layer SCIMAP multiplies
 * into the source term.
 *
 * `bounds` must be the frozen baseline endpoints from catchment generation.
 * Re-deriving them per recompute is what makes an improved catchment appear
 * unchanged; see `core/normalise.ts` for the full argument.
 */
export function normaliseConnectivity(
  networkIndex: Float64Array,
  bounds: Bounds,
  out?: Float64Array,
  valid?: Uint8Array,
): Float64Array {
  const target = out && out.length === networkIndex.length ? out : new Float64Array(networkIndex.length);
  return applyStretch(networkIndex, bounds, target, valid);
}

/** Derive the baseline connectivity stretch. Catchment generation only. */
export function deriveConnectivityBounds(
  networkIndex: Float64Array,
  valid?: Uint8Array,
): Bounds {
  return deriveBounds(networkIndex, valid, STRETCH_LOW, STRETCH_HIGH);
}
