/**
 * Single steepest-descent flow direction over a filled DEM.
 *
 * SCIMAP uses two different flow algorithms and they are not interchangeable.
 * Accumulation uses FD8 multiple-flow so that upslope area spreads realistically
 * across divergent slopes. The *connectivity* trace uses this single-direction
 * D8 successor map, because the Network Index is defined along "the" flow path
 * from a cell to the channel, which only means something if each cell has one.
 *
 * Ported from the reference kernel, including two details that look incidental
 * and are not:
 *
 *  - `bestGrad` starts at 0.0 and the comparison is a strict `>`. Every
 *    successor is therefore strictly lower than its predecessor, which makes the
 *    successor graph a forest — acyclic, and topologically ordered by elevation.
 *    That is what licenses `networkIndex.ts` to solve the min-along-path
 *    recurrence with a single elevation-ordered sweep instead of the reference's
 *    pointer doubling.
 *  - Distances are in *cell units* (1 or sqrt 2), not metres. The gradient is
 *    only ever compared against other gradients from the same cell, so the
 *    common factor of cell size cancels; introducing it would change nothing
 *    except agreement with the reference.
 *
 * A cell with no strictly lower neighbour gets successor -1 and its flow path
 * terminates. After an epsilon fill only the outlet should be in that position,
 * and `assertNoInteriorSinks` exists to keep that true.
 */

import { type GridSpec, N8_DCOL, N8_DIST, N8_DROW } from "../core/grid";

/**
 * Index of each cell's downslope neighbour, or -1 where there is none.
 *
 * `valid` restricts both the source and destination of every link, so flow paths
 * terminate at the edge of the catchment rather than leaking outside it.
 */
export function buildDownstreamIndex(
  dem: Float64Array,
  spec: GridSpec,
  valid?: Uint8Array,
  out?: Int32Array,
): Int32Array {
  const { width, height } = spec;
  const n = width * height;
  const downstream = out && out.length === n ? out : new Int32Array(n);
  downstream.fill(-1);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      if (valid && !valid[cell]) continue;

      const z = dem[cell];
      let bestGrad = 0;
      let bestIndex = -1;

      for (let k = 0; k < 8; k++) {
        const nRow = row + N8_DROW[k];
        const nCol = col + N8_DCOL[k];
        if (nRow < 0 || nRow >= height || nCol < 0 || nCol >= width) continue;

        const neighbour = nRow * width + nCol;
        if (valid && !valid[neighbour]) continue;

        const grad = (z - dem[neighbour]) / N8_DIST[k];
        if (grad > bestGrad) {
          bestGrad = grad;
          bestIndex = neighbour;
        }
      }
      downstream[cell] = bestIndex;
    }
  }
  return downstream;
}

/**
 * Upslope contributing area along single-direction flow paths, in cells.
 *
 * This is *not* the accumulation SCIMAP uses for wetness — that is FD8, because
 * spreading flow across divergent slopes is the physically better description of
 * where water goes. This one exists to define where the river is.
 *
 * The distinction matters visually and mechanically. On the near-flat valley
 * floors left behind by epsilon filling, FD8 gives eight nearly-equal downslope
 * gradients and fans flow out across the whole floor, so thresholding it yields
 * a channel tens of cells wide — a marsh, not a river. D8 commits to one
 * neighbour and produces the single crisp thread a watercourse actually is.
 *
 * So the channel mask, which decides where the Network Index trace terminates,
 * where a leaky dam may be built and where the river mesh is drawn, comes from
 * this; TWI and erosion risk still consume the FD8 area.
 *
 * `order` must be descending elevation, which is a topological order of the flow
 * graph after an epsilon fill — the same order the FD8 table already carries.
 */
export function accumulateD8(
  downstream: Int32Array,
  order: Int32Array,
  out?: Float64Array,
): Float64Array {
  const n = downstream.length;
  const accum = out && out.length === n ? out : new Float64Array(n);
  accum.fill(1);

  for (let i = 0; i < n; i++) {
    const cell = order[i];
    const next = downstream[cell];
    if (next >= 0) accum[next] += accum[cell];
  }
  return accum;
}

/** Walk downstream from `start`, returning the terminating cell. */
export function walkDownstream(downstream: Int32Array, start: number, maxSteps: number): number {
  let cell = start;
  for (let step = 0; step < maxSteps; step++) {
    const next = downstream[cell];
    if (next < 0) return cell;
    cell = next;
  }
  return cell;
}

export interface DrainageReport {
  /** Cells with no downslope neighbour, excluding the expected outlet. */
  readonly interiorSinks: number;
  /** Fraction of cells whose flow path terminates at the outlet. */
  readonly reachingOutlet: number;
}

/**
 * Verify that the grid really is one catchment draining to one point.
 *
 * This is the assertion that catches a missing fill epsilon. Without it the
 * hydrology still runs and still produces a map that looks like a risk map, so
 * nothing else in the pipeline will notice — which is exactly why it is checked
 * explicitly rather than inferred from downstream results looking reasonable.
 */
export function auditDrainage(
  downstream: Int32Array,
  outlet: number,
  valid?: Uint8Array,
): DrainageReport {
  const n = downstream.length;
  let interiorSinks = 0;
  let reaching = 0;
  let considered = 0;

  // Memoised: once a cell is known to reach the outlet, so does everything
  // upstream of it. Without this the audit is O(n * path length).
  const UNKNOWN = 0;
  const REACHES = 1;
  const STOPS = 2;
  const state = new Uint8Array(n);
  const stack: number[] = [];

  for (let start = 0; start < n; start++) {
    if (valid && !valid[start]) continue;
    considered++;

    if (downstream[start] < 0 && start !== outlet) interiorSinks++;
    if (state[start] !== UNKNOWN) {
      if (state[start] === REACHES) reaching++;
      continue;
    }

    stack.length = 0;
    let cell = start;
    let verdict = STOPS;

    for (;;) {
      if (cell === outlet) {
        verdict = REACHES;
        break;
      }
      if (state[cell] !== UNKNOWN) {
        verdict = state[cell];
        break;
      }
      state[cell] = STOPS; // provisional, also breaks any cycle
      stack.push(cell);

      const next = downstream[cell];
      if (next < 0) break;
      cell = next;
    }

    for (const visited of stack) state[visited] = verdict;
    if (verdict === REACHES) reaching++;
  }

  return {
    interiorSinks,
    reachingOutlet: considered === 0 ? 0 : reaching / considered,
  };
}
