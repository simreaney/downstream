/**
 * World constants shared by the simulation and the renderer.
 *
 * The grid is the load-bearing choice here. 256 x 256 at 4 m gives a 1 km²
 * catchment: small enough that the full SCIMAP pipeline re-runs inside a frame
 * budget so the risk overlay updates live as the player places features, and
 * large enough that the drainage network has real tributaries and the whole
 * catchment is legible from a hilltop. Walking corner to corner takes about two
 * minutes, which is the right size for one sitting.
 *
 * Doubling to 512 would quadruple every sweep and push recompute past 100 ms,
 * at which point the overlay has to update on release rather than live — and
 * that immediacy is the entire teaching mechanism.
 */

import type { GridSpec } from "./core/grid";

export const GRID: GridSpec = {
  width: 256,
  height: 256,
  cellSize: 4,
};

export const CELL_COUNT = GRID.width * GRID.height;
export const CELL_AREA_M2 = GRID.cellSize * GRID.cellSize;
export const WORLD_SIZE_M = GRID.width * GRID.cellSize;

/**
 * Vertical relief from outlet to catchment divide, as a fraction of the
 * catchment's width.
 *
 * A ratio rather than a fixed height, because relief only means anything
 * relative to the distance it is spread over. Pinning it at an absolute 180 m
 * made the shipped 1 km grid a gentle 18% pastoral catchment and a 384 m test
 * grid a 47% alpine one — so the tests were exercising terrain the game never
 * generates, and reported two thirds of the catchment as relict woodland on
 * slopes too steep to farm.
 *
 * 0.175 gives about 180 m across the shipped 1024 m grid: enough for the
 * drainage network to read from a hilltop, gentle enough to walk.
 */
export const RELIEF_RATIO = 0.175;

/** Relief in metres for a given catchment extent. */
export function reliefFor(spec: GridSpec): number {
  return spec.width * spec.cellSize * RELIEF_RATIO;
}

/** Relief of the shipped grid, in metres. */
export const RELIEF_M = reliefFor(GRID);

/**
 * Elevation added to break ties when priority-flood resolves a depression.
 *
 * Every cell ends up strictly below the cell draining into it by at least this
 * much, which is what guarantees steepest descent always finds a downhill
 * neighbour and flow paths never dead-end on a filled flat. See `scimap/fill.ts`
 * for why that matters more than it sounds.
 *
 * 1e-6 m is eight orders of magnitude above float64 spacing at these
 * elevations, and accumulates to at most a few centimetres across the longest
 * possible flow path — invisible in the terrain, decisive in the routing.
 */
export const FILL_EPSILON = 1e-6;

/**
 * Whether to run the reduced-detail settings.
 *
 * Judged from device memory and core count rather than from a user-agent string,
 * which lies and dates badly. The compute core is untouched either way — the
 * science is the same on a phone as on a workstation, and only what is drawn
 * changes, so a screenshot from a low-end device still reports the truth.
 */
export function isLowPower(): boolean {
  if (typeof navigator === "undefined") return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarsePointer =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return (memory !== undefined && memory <= 4) || cores <= 4 || coarsePointer;
}
