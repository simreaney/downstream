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
const COTTAGE_COUNT = 7;
const VILLAGE_RADIUS_CELLS = 5;

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
  // than the fishery so the player passes it on the way inland.
  const villageAnchor = trunk[Math.min(FISHERY_OFFSET_CELLS + 18, trunk.length - 1)];
  const villageCell = flattestNear(spec, villageAnchor, slopeDeg, channelMask, 6);

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

/** Flattest non-channel cell within `radius` of an anchor. */
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
      if (channelMask[cell]) continue;
      if (slopeDeg[cell] < bestSlope) {
        bestSlope = slopeDeg[cell];
        best = cell;
      }
    }
  }
  return best;
}

function scatterCottages(
  spec: GridSpec,
  centre: number,
  slopeDeg: Float64Array,
  channelMask: Uint8Array,
): number[] {
  const row = (centre / spec.width) | 0;
  const col = centre % spec.width;

  // Collect buildable ground near the centre, then repeatedly take the flattest
  // cell that is not already crowded. A repeated-min scan rather than a sort:
  // it is a handful of picks from a hundred-odd candidates, the spacing rule has
  // to be applied as we go anyway, and `lint:hotpath` keeps comparator sorts out
  // of the generation path on principle.
  const candidates: { cell: number; slope: number }[] = [];
  for (let dRow = -VILLAGE_RADIUS_CELLS; dRow <= VILLAGE_RADIUS_CELLS; dRow++) {
    for (let dCol = -VILLAGE_RADIUS_CELLS; dCol <= VILLAGE_RADIUS_CELLS; dCol++) {
      const r = row + dRow;
      const c = col + dCol;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;

      const cell = r * spec.width + c;
      if (channelMask[cell] || slopeDeg[cell] > 9) continue;
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
