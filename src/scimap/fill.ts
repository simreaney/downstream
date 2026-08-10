/**
 * Priority-flood depression filling, with an epsilon gradient across flats.
 *
 * The reference implementation resolves depressions by least-cost breaching
 * (WhiteboxTools `BreachDepressions`), which is not practical to reproduce in
 * pure TypeScript. Priority-flood is the accepted substitute and behaves the
 * same way for our purposes, but only in its epsilon variant, and the reason is
 * the single most dangerous failure mode in this whole pipeline.
 *
 * Plain priority-flood raises a depression to its spill elevation, producing a
 * genuinely flat plateau. Steepest descent then finds no strictly lower
 * neighbour anywhere on that plateau — the reference kernel starts its search at
 * `bestGrad = 0.0` and compares with a strict `>` — so every one of those cells
 * gets successor -1 and its flow path terminates on the spot. The Network Index
 * is a minimum along the flow path to the channel, so those cells report the
 * minimum of a path of length zero: their own TWI. The result is a connectivity
 * map that is wrong across whole valley floors while looking entirely plausible,
 * because valley floors are exactly where depressions occur.
 *
 * Adding FILL_EPSILON to each cell as it is resolved gives every cell a strictly
 * lower predecessor by construction, so no flow path can dead-end. The cost is a
 * few centimetres of imperceptible tilt across the largest filled flat.
 *
 * Seeding matters as much as the epsilon. The queue starts from the outlet cell
 * *alone*, not from the whole border. That converts "the conditioned surface
 * ought to drain to the outlet" into "every cell provably has a downhill path to
 * the outlet", which is what the score, the hydrograph and the fishery all
 * assume.
 */

import { type GridSpec, N8_DCOL, N8_DROW } from "../core/grid";
import { MinHeap } from "../core/heap";
import { FILL_EPSILON } from "../config";

/** Fill depth above which a cell counts as genuinely flooded, in metres. */
const SUBSTANTIAL_FILL_M = 0.5;

export interface FillResult {
  /** Deepest fill applied to any single cell, in metres. */
  readonly maxFillDepth: number;
  /** Number of cells whose elevation was raised at all. */
  readonly filledCells: number;
  /**
   * Cells raised by more than half a metre — the ones that end up genuinely
   * flat. This, rather than the deepest single pit, is the number that says
   * whether the terrain is usable: one deep enclosed hollow is a real landform
   * (and a natural pond site), whereas a few percent of the grid flattened is
   * valley floor turned into lake, where flow directions become arbitrary and
   * connectivity stops meaning anything.
   */
  readonly floodedCells: number;
}

/**
 * Fill `dem` in place so that every cell drains to `outlet`.
 *
 * `sinks`, when supplied, marks cells that are allowed to remain depressions —
 * they act as additional termini, absorbing flow rather than being raised. The
 * game does not use this by default: an offline attenuation pond stores water
 * without re-routing the channel network, so ponds stay out of the routing DEM
 * entirely. The parameter exists so the alternative model can be switched on
 * behind `pondsAlterDem` without restructuring the pipeline.
 */
export function fillDepressions(
  dem: Float64Array,
  spec: GridSpec,
  outlet: number,
  sinks?: Uint8Array,
): FillResult {
  const { width, height } = spec;
  const n = width * height;

  const resolved = new Uint8Array(n);
  const heap = new MinHeap(n);

  heap.push(dem[outlet], outlet);
  resolved[outlet] = 1;

  if (sinks) {
    for (let i = 0; i < n; i++) {
      if (sinks[i] && !resolved[i]) {
        heap.push(dem[i], i);
        resolved[i] = 1;
      }
    }
  }

  let maxFillDepth = 0;
  let filledCells = 0;
  let floodedCells = 0;

  while (!heap.isEmpty) {
    const key = heap.peekKey();
    const cell = heap.pop();

    const row = (cell / width) | 0;
    const col = cell % width;

    for (let k = 0; k < 8; k++) {
      const nRow = row + N8_DROW[k];
      const nCol = col + N8_DCOL[k];
      if (nRow < 0 || nRow >= height || nCol < 0 || nCol >= width) continue;

      const neighbour = nRow * width + nCol;
      if (resolved[neighbour]) continue;
      resolved[neighbour] = 1;

      // The epsilon is what guarantees a strictly lower predecessor, and hence
      // that steepest descent always finds somewhere to go.
      const floor = key + FILL_EPSILON;
      const original = dem[neighbour];
      if (original < floor) {
        dem[neighbour] = floor;
        filledCells++;
        const depth = floor - original;
        if (depth > SUBSTANTIAL_FILL_M) floodedCells++;
        if (depth > maxFillDepth) maxFillDepth = depth;
      }

      heap.push(dem[neighbour], neighbour);
    }
  }

  return { maxFillDepth, filledCells, floodedCells };
}
