/**
 * FD8 multiple-flow-direction partitioning and accumulation.
 *
 * SCIMAP deliberately uses two flow algorithms. Upslope contributing area comes
 * from FD8 (Holmgren), which splits flow across every downslope neighbour in
 * proportion to `(gradient * contourLength)^p`, so divergent hillslopes spread
 * water the way they actually do rather than concentrating it into a single
 * artificial thread. The *connectivity* trace uses single-direction D8 instead,
 * because the Network Index is defined along one flow path. Mixing them up would
 * be a subtle and very hard-to-spot error.
 *
 * ## Why the fractions are cached separately from the accumulation
 *
 * This split is the single most important performance decision in the pipeline.
 * Building the partition table costs eight gradients and eight multiplies per
 * cell — the most expensive step in a recompute. But it depends only on the DEM,
 * and the player's interventions do not change the DEM: trees rewrite a land
 * cover weight, and ponds and dams clamp TWI. So the table is built once at
 * catchment generation and every later accumulation is a pure multiply-add sweep
 * over a fixed visiting order.
 *
 * That is what turns the in-channel risk calculation — which needs two separate
 * weighted accumulations over the whole grid — from a costly operation into
 * something affordable on every single placement, which is what makes the
 * overlay update live rather than on release.
 *
 * Units are **cells**, matching the reference `out_type: 'cells'`. The area is
 * never divided by contour width and never converted to square metres; TWI
 * consumes the raw cell count.
 */

import { type GridSpec, N8_CONTOUR, N8_DCOL, N8_DIST, N8_DROW } from "../core/grid";
import { sortIndicesByValue } from "../core/sort";
import { FD8_EXPONENT } from "./constants";

/**
 * Relative mass-balance error to expect from an accumulation sweep.
 *
 * The fraction table is Float32, which halves the memory traffic of the sweep —
 * and these sweeps scatter into memory, so they are bandwidth-bound rather than
 * arithmetic-bound, making that the single cheapest speedup available. The cost
 * is that each cell's eight fractions sum to 1 only to about 1e-7, and that
 * error compounds along flow paths to roughly 2e-7 of the catchment total.
 *
 * Two centimetres of area error in a square kilometre is far below anything the
 * model claims to resolve, so this is a good trade — but it is a real error, so
 * mass-balance assertions state a relative tolerance rather than pretending the
 * arithmetic is exact.
 */
export const FD8_MASS_TOLERANCE = 1e-5;

/** Flow partitioning that depends only on the DEM, so it survives placements. */
export interface Fd8Table {
  /** Fraction of a cell's flow leaving in each of the 8 directions, 8 per cell. */
  readonly fractions: Float32Array;
  /** Cell indices in descending elevation order — the accumulation sweep order. */
  readonly order: Int32Array;
}

/**
 * Build the partition table and the sweep order.
 *
 * Processing cells from high to low guarantees a cell's total inflow is complete
 * before it passes anything on, because after an epsilon fill every successor is
 * strictly lower. That is why this is a plain sorted sweep rather than a
 * topological sort with an in-degree queue: elevation order *is* a topological
 * order of the flow graph, and a radix sort finds it in about a millisecond.
 */
export function buildFd8Table(dem: Float64Array, spec: GridSpec, valid?: Uint8Array): Fd8Table {
  const { width, height } = spec;
  const n = width * height;

  const fractions = new Float32Array(n * 8);
  const order = sortIndicesByValue(dem, true);

  const weights = new Float64Array(8);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      if (valid && !valid[cell]) continue;

      const z = dem[cell];
      let total = 0;

      for (let k = 0; k < 8; k++) {
        weights[k] = 0;
        const nRow = row + N8_DROW[k];
        const nCol = col + N8_DCOL[k];
        if (nRow < 0 || nRow >= height || nCol < 0 || nCol >= width) continue;

        const neighbour = nRow * width + nCol;
        if (valid && !valid[neighbour]) continue;

        const drop = z - dem[neighbour];
        if (drop <= 0) continue;

        // Holmgren: weight proportional to (tan(beta) * contourLength)^p, with
        // p held at exactly 2.0. Squaring directly rather than calling Math.pow
        // saves a surprising amount over half a million evaluations.
        const gradient = drop / N8_DIST[k];
        const base = gradient * N8_CONTOUR[k];
        const weight = FD8_EXPONENT === 2 ? base * base : Math.pow(base, FD8_EXPONENT);

        weights[k] = weight;
        total += weight;
      }

      if (total <= 0) continue;
      const offset = cell * 8;
      for (let k = 0; k < 8; k++) fractions[offset + k] = weights[k] / total;
    }
  }

  return { fractions, order };
}

/**
 * Accumulate a per-cell payload downslope.
 *
 * With `weights` omitted every cell contributes 1 and the result is upslope
 * contributing area in cells. With `weights` supplied the result is that
 * quantity routed and summed downslope, which is how source risk and
 * rainfall-weighted area are delivered to the channel network.
 */
export function accumulate(
  table: Fd8Table,
  spec: GridSpec,
  weights?: Float64Array,
  out?: Float64Array,
): Float64Array {
  const { width, height } = spec;
  const n = width * height;
  const { fractions, order } = table;

  const accum = out && out.length === n ? out : new Float64Array(n);
  if (weights) {
    for (let i = 0; i < n; i++) accum[i] = weights[i];
  } else {
    accum.fill(1);
  }

  for (let index = 0; index < n; index++) {
    const cell = order[index];
    const load = accum[cell];
    if (load === 0) continue;

    const offset = cell * 8;
    const row = (cell / width) | 0;
    const col = cell % width;

    for (let k = 0; k < 8; k++) {
      const fraction = fractions[offset + k];
      if (fraction === 0) continue;
      const nRow = row + N8_DROW[k];
      const nCol = col + N8_DCOL[k];
      if (nRow < 0 || nRow >= height || nCol < 0 || nCol >= width) continue;
      accum[nRow * width + nCol] += load * fraction;
    }
  }
  return accum;
}

/**
 * Accumulate two payloads in a single sweep.
 *
 * In-channel risk is a ratio of two flow-accumulated quantities over the same
 * flow field. Running `accumulate` twice would walk the grid and re-read the
 * fraction table twice; fusing them shares the neighbour arithmetic and the
 * cache lines, which matters because these sweeps scatter into memory and are
 * bandwidth-bound rather than arithmetic-bound.
 */
export function accumulatePair(
  table: Fd8Table,
  spec: GridSpec,
  weightsA: Float64Array,
  weightsB: Float64Array,
  outA: Float64Array,
  outB: Float64Array,
): void {
  const { width, height } = spec;
  const n = width * height;
  const { fractions, order } = table;

  outA.set(weightsA);
  outB.set(weightsB);

  for (let index = 0; index < n; index++) {
    const cell = order[index];
    const loadA = outA[cell];
    const loadB = outB[cell];
    if (loadA === 0 && loadB === 0) continue;

    const offset = cell * 8;
    const row = (cell / width) | 0;
    const col = cell % width;

    for (let k = 0; k < 8; k++) {
      const fraction = fractions[offset + k];
      if (fraction === 0) continue;
      const nRow = row + N8_DROW[k];
      const nCol = col + N8_DCOL[k];
      if (nRow < 0 || nRow >= height || nCol < 0 || nCol >= width) continue;
      const neighbour = nRow * width + nCol;
      outA[neighbour] += loadA * fraction;
      outB[neighbour] += loadB * fraction;
    }
  }
}
