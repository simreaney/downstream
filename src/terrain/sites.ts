/**
 * Where the village and the fishery go.
 *
 * Both are placed by the hydrology rather than by taste, because both are the
 * game's receptors and their position decides what the player's work is worth.
 *
 * The fishery sits on the trunk river near the outlet: everything the catchment
 * does passes it, so its water is the catchment's report card. The village sits
 * on the floodplain a little upstream — close enough to the channel to be
 * genuinely at risk in a large event, on ground flat enough to have been built
 * on, which is exactly the bargain real settlements made.
 *
 * Every catchment gets a whole village. The first version looked for flat
 * ground only around one fixed point on the trunk and only below 9 degrees,
 * which works on most seeds and quietly thins the village out on a steep one.
 * Now the whole stretch of trunk above the fishery is scored for buildable
 * ground, and the slope limit and search radius relax step by step until every
 * cottage has a plot — the village is guaranteed by construction rather than
 * by the terrain being kind.
 */

import type { GridSpec } from "../core/grid";
import { channelThresholdCells } from "../scimap/constants";

export interface Sites {
  /** Cell on the channel where the fishery's jetty reaches the water. */
  readonly fisheryCell: number;
  /** Centre of the village. */
  readonly villageCell: number;
  /** Cells to place cottages on. */
  readonly cottageCells: readonly number[];
}

/** How far upstream of the outlet the fishery sits, in cells. */
const FISHERY_OFFSET_CELLS = 14;

/** Cottages per village, and how far they spread from its centre. */
export const COTTAGE_COUNT = 7;
const VILLAGE_RADIUS_CELLS = 5;

/**
 * Slope limits tried in turn, in degrees, and then search radii.
 *
 * 9 degrees is where a cottage still sits on its plot without looking
 * perched; past that it stands on a stone plinth (see `props/building.ts`),
 * which reads as a hillside village rather than as a mistake.
 */
const BUILDABLE_SLOPES_DEG = [9, 12, 16, 22, 90];
const SEARCH_RADII_CELLS = [VILLAGE_RADIUS_CELLS, VILLAGE_RADIUS_CELLS + 2, VILLAGE_RADIUS_CELLS + 4];

/** Cells kept clear around the village centre, for the green and its well. */
const GREEN_RADIUS_CELLS = 1;

/**
 * Stretch of trunk scored for a village site, in cells above the outlet, and
 * the spot within it that is preferred when several have room.
 */
const VILLAGE_SEARCH_START = FISHERY_OFFSET_CELLS + 8;
const VILLAGE_SEARCH_END = FISHERY_OFFSET_CELLS + 72;
const VILLAGE_PREFERRED = FISHERY_OFFSET_CELLS + 18;

export function chooseSites(
  spec: GridSpec,
  outlet: number,
  downstream: Int32Array,
  d8Accum: Float64Array,
  slopeDeg: Float64Array,
  channelMask: Uint8Array,
): Sites {
  // Walk upstream from the outlet along the largest tributary each step, which
  // keeps to the trunk rather than wandering into a headwater.
  const trunk: number[] = [outlet];
  const inflows = buildInflows(downstream, channelMask);

  let cell = outlet;
  for (let step = 0; step < spec.width; step++) {
    const upstream = inflows.get(cell);
    if (!upstream || upstream.length === 0) break;

    let best = upstream[0];
    for (const candidate of upstream) {
      if (d8Accum[candidate] > d8Accum[best]) best = candidate;
    }
    cell = best;
    trunk.push(cell);
  }

  const fisheryCell = trunk[Math.min(FISHERY_OFFSET_CELLS, trunk.length - 1)];

  // The village goes on the flattest ground near the trunk, further upstream
  // than the fishery so the player passes it on the way inland. Every few
  // cells along that stretch is a candidate; the one with the most room wins,
  // and among those with room enough the one nearest the preferred spot.
  let villageCell = -1;
  let bestScore = -Infinity;
  const searchEnd = Math.min(trunk.length, VILLAGE_SEARCH_END);
  for (let k = VILLAGE_SEARCH_START; k < searchEnd; k += 3) {
    const centre = flattestNear(spec, trunk[k], slopeDeg, channelMask, 6);
    const room = countBuildable(spec, centre, slopeDeg, channelMask, VILLAGE_RADIUS_CELLS, BUILDABLE_SLOPES_DEG[0]);
    // Room saturates at three plots a cottage: beyond that more room is not a
    // better village, and the preference decides.
    const score = Math.min(room, COTTAGE_COUNT * 3) - Math.abs(k - VILLAGE_PREFERRED) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      villageCell = centre;
    }
  }
  if (villageCell < 0) {
    // A trunk too short to search: fall back to its top.
    villageCell = flattestNear(spec, trunk[trunk.length - 1], slopeDeg, channelMask, 6);
  }

  return {
    fisheryCell,
    villageCell,
    cottageCells: scatterCottages(spec, villageCell, slopeDeg, channelMask),
  };
}

function buildInflows(
  downstream: Int32Array,
  channelMask: Uint8Array,
): Map<number, number[]> {
  const inflows = new Map<number, number[]>();
  for (let cell = 0; cell < downstream.length; cell++) {
    if (!channelMask[cell]) continue;
    const next = downstream[cell];
    if (next < 0) continue;
    const list = inflows.get(next);
    if (list) list.push(cell);
    else inflows.set(next, [cell]);
  }
  return inflows;
}

/** Whether a cell is a channel cell or touches one. */
function nearChannel(spec: GridSpec, cell: number, channelMask: Uint8Array): boolean {
  const row = (cell / spec.width) | 0;
  const col = cell % spec.width;
  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      const r = row + dRow;
      const c = col + dCol;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;
      if (channelMask[r * spec.width + c]) return true;
    }
  }
  return false;
}

/**
 * Whether a cottage may stand on a cell.
 *
 * Not on the channel or beside it — the render ground there is carved into a
 * river bed (see `render/riverMesh.ts`), and the model's floodplain is right
 * next to it anyway — and not on the map's outermost ring, where half the plot
 * would be off the edge of the world.
 */
function buildable(
  spec: GridSpec,
  cell: number,
  slopeDeg: Float64Array,
  channelMask: Uint8Array,
  maxSlope: number,
): boolean {
  const row = (cell / spec.width) | 0;
  const col = cell % spec.width;
  if (row < 1 || row >= spec.height - 1 || col < 1 || col >= spec.width - 1) return false;
  if (slopeDeg[cell] > maxSlope) return false;
  return !nearChannel(spec, cell, channelMask);
}

/** Buildable cells within `radius` of a centre. */
function countBuildable(
  spec: GridSpec,
  centre: number,
  slopeDeg: Float64Array,
  channelMask: Uint8Array,
  radius: number,
  maxSlope: number,
): number {
  const row = (centre / spec.width) | 0;
  const col = centre % spec.width;
  let count = 0;
  for (let dRow = -radius; dRow <= radius; dRow++) {
    for (let dCol = -radius; dCol <= radius; dCol++) {
      if (dRow * dRow + dCol * dCol > radius * radius) continue;
      const r = row + dRow;
      const c = col + dCol;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;
      if (buildable(spec, r * spec.width + c, slopeDeg, channelMask, maxSlope)) count++;
    }
  }
  return count;
}

/** Flattest cell clear of the channel within `radius` of an anchor. */
function flattestNear(
  spec: GridSpec,
  anchor: number,
  slopeDeg: Float64Array,
  channelMask: Uint8Array,
  radius: number,
): number {
  const row = (anchor / spec.width) | 0;
  const col = anchor % spec.width;

  let best = anchor;
  let bestSlope = Infinity;

  for (let dRow = -radius; dRow <= radius; dRow++) {
    for (let dCol = -radius; dCol <= radius; dCol++) {
      const r = row + dRow;
      const c = col + dCol;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;

      const cell = r * spec.width + c;
      if (nearChannel(spec, cell, channelMask)) continue;
      if (slopeDeg[cell] < bestSlope) {
        bestSlope = slopeDeg[cell];
        best = cell;
      }
    }
  }
  return best;
}

/**
 * Plots for every cottage in the village.
 *
 * Tries the strictest slope limit in the smallest radius first and relaxes one
 * step at a time until every cottage has a plot, so a gentle floodplain gets a
 * tight village of level plots and a steep valley still gets a whole one.
 */
function scatterCottages(
  spec: GridSpec,
  centre: number,
  slopeDeg: Float64Array,
  channelMask: Uint8Array,
): number[] {
  let best: number[] = [];
  for (const radius of SEARCH_RADII_CELLS) {
    for (const maxSlope of BUILDABLE_SLOPES_DEG) {
      const chosen = pickPlots(spec, centre, slopeDeg, channelMask, radius, maxSlope);
      if (chosen.length >= COTTAGE_COUNT) return chosen;
      if (chosen.length > best.length) best = chosen;
    }
  }
  return best;
}

function pickPlots(
  spec: GridSpec,
  centre: number,
  slopeDeg: Float64Array,
  channelMask: Uint8Array,
  radius: number,
  maxSlope: number,
): number[] {
  const row = (centre / spec.width) | 0;
  const col = centre % spec.width;

  // Collect buildable ground near the centre, then repeatedly take the flattest
  // cell that is not already crowded. A repeated-min scan rather than a sort:
  // it is a handful of picks from a hundred-odd candidates, the spacing rule has
  // to be applied as we go anyway, and `lint:hotpath` keeps comparator sorts out
  // of the generation path on principle.
  const candidates: { cell: number; slope: number }[] = [];
  for (let dRow = -radius; dRow <= radius; dRow++) {
    for (let dCol = -radius; dCol <= radius; dCol++) {
      if (dRow * dRow + dCol * dCol > radius * radius) continue;
      // The green stays open.
      if (Math.abs(dRow) <= GREEN_RADIUS_CELLS && Math.abs(dCol) <= GREEN_RADIUS_CELLS) continue;
      const r = row + dRow;
      const c = col + dCol;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;

      const cell = r * spec.width + c;
      if (!buildable(spec, cell, slopeDeg, channelMask, maxSlope)) continue;
      candidates.push({ cell, slope: slopeDeg[cell] });
    }
  }

  const chosen: number[] = [];
  const taken = new Set<number>();

  while (chosen.length < COTTAGE_COUNT) {
    let best = -1;
    let bestSlope = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      if (taken.has(i)) continue;
      const candidate = candidates[i];
      if (candidate.slope >= bestSlope) continue;

      // Keep cottages at least two cells apart, so they read as a village rather
      // than a terrace.
      const clash = chosen.some((other) => {
        const dRow = ((other / spec.width) | 0) - ((candidate.cell / spec.width) | 0);
        const dCol = (other % spec.width) - (candidate.cell % spec.width);
        return Math.hypot(dRow, dCol) < 2;
      });
      if (clash) continue;

      best = i;
      bestSlope = candidate.slope;
    }

    if (best < 0) break;
    taken.add(best);
    chosen.push(candidates[best].cell);
  }
  return chosen;
}

/** Cells adjacent to the fishery where fish may be drawn. */
export function fisheryPool(
  spec: GridSpec,
  fisheryCell: number,
  channelMask: Uint8Array,
  radius = 5,
): number[] {
  const row = (fisheryCell / spec.width) | 0;
  const col = fisheryCell % spec.width;
  const cells: number[] = [];

  for (let dRow = -radius; dRow <= radius; dRow++) {
    for (let dCol = -radius; dCol <= radius; dCol++) {
      const r = row + dRow;
      const c = col + dCol;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;
      const cell = r * spec.width + c;
      if (channelMask[cell]) cells.push(cell);
    }
  }
  return cells;
}

export { channelThresholdCells };
