/**
 * Catchment-scale shaping: turn a noise field into a landscape that drains to
 * exactly one outlet.
 *
 * The single-outlet property is not cosmetic. Everything downstream assumes it:
 * the in-channel risk concentration is reported at an outlet, the storm
 * hydrograph is gauged at one, and the fishery sits on it. A grid that drains
 * off three different edges has three partial catchments and no coherent story.
 *
 * The guarantee is made in two places working together. Here, the surface is
 * tilted and walled so that water naturally runs to a notch in one edge. Then
 * `scimap/fill.ts` seeds its priority-flood from that outlet cell *alone*, which
 * turns "naturally drains there" into "provably drains there" — any basin the
 * noise left behind is filled until it can spill towards the outlet.
 *
 * Shaping deliberately uses a tilted, laterally-walled trough rather than a
 * radial bowl. A bowl produces radial drainage that reads as a crater; a trough
 * produces a trunk valley with tributaries entering from both sides, which is
 * what a catchment looks like and what gives riparian planting somewhere to go.
 */

import { type GridSpec, colOf, rowOf } from "../core/grid";
import type { Rng } from "../core/rng";
import { clamp01, smoothstep } from "../core/clamp";
import { reliefFor } from "../config";

/**
 * Relative contributions of each shaping term.
 *
 * These are ratios, not metres. The assembled surface is rescaled to the relief
 * the catchment's extent implies (see `reliefFor`), so adding or retuning a term
 * changes the catchment's shape without also changing how steep it is. Letting the weights set the
 * relief directly is how an earlier version ended up with 313 m of relief across
 * 1 km — an alpine gradient that made the droplet model erode violently and
 * looked nothing like the pastoral catchment this is meant to be.
 *
 * The balance between TILT and NOISE is the one that has to be right. The tilt
 * spreads its drop across the whole grid, so its gradient is roughly
 * TILT_WEIGHT / gridWidth per cell, while the noise concentrates its amplitude
 * into features a few dozen cells across. Give the noise too much and it wins
 * locally: the surface acquires closed basins, the fill floods them, and valley
 * floors arrive as flat lakes with no usable flow direction — precisely where
 * connectivity matters most.
 */
const TILT_WEIGHT = 0.7;
const LATERAL_WEIGHT = 0.45;
const NOISE_WEIGHT = 0.22;

/**
 * Divide wall along the grid edge, and how far in it reaches as a fraction of
 * the grid's width.
 *
 * A fraction rather than a cell count, for the same reason relief is a ratio:
 * rim height scales with relief, so a fixed cell count would make the divide
 * proportionally steeper on a large grid and gentler on a small one. At 7% the
 * wall sits near 20 degrees at any resolution — steep enough to be a convincing
 * catchment boundary, gentle enough that it comes out as rough grazing rather
 * than being classified as unfarmable relict woodland.
 */
const RIM_WEIGHT = 0.25;
const RIM_WIDTH_FRACTION = 0.07;

/** Radius over which the rim is notched away around the outlet, as a fraction. */
const NOTCH_RADIUS_FRACTION = 0.035;

/** Keep the outlet off the corners, where a notch would open two edges at once. */
const OUTLET_EDGE_MARGIN = 0.28;

export interface ConditionedTerrain {
  /** Elevation in metres. */
  readonly dem: Float64Array;
  /** Index of the single cell the whole catchment drains to. */
  readonly outlet: number;
}

/** Choose an outlet on a random edge, away from the corners. */
function chooseOutlet(spec: GridSpec, rng: Rng): number {
  const edge = rng.int(4);
  const along = rng.range(OUTLET_EDGE_MARGIN, 1 - OUTLET_EDGE_MARGIN);

  switch (edge) {
    case 0:
      return 0 * spec.width + Math.floor(along * spec.width);
    case 1:
      return Math.floor(along * spec.height) * spec.width + (spec.width - 1);
    case 2:
      return (spec.height - 1) * spec.width + Math.floor(along * spec.width);
    default:
      return Math.floor(along * spec.height) * spec.width;
  }
}

/**
 * Apply the trough, the rim and the noise to produce elevations in metres.
 *
 * `surface` is the [0, 1] base field and is not modified.
 */
export function conditionSurface(
  spec: GridSpec,
  surface: Float64Array,
  rng: Rng,
): ConditionedTerrain {
  const outlet = chooseOutlet(spec, rng);
  const outletRow = rowOf(spec, outlet);
  const outletCol = colOf(spec, outlet);

  // Inward normal of the edge the outlet sits on, and the tangent along it.
  const normalRow = outletRow === 0 ? 1 : outletRow === spec.height - 1 ? -1 : 0;
  const normalCol = outletCol === 0 ? 1 : outletCol === spec.width - 1 ? -1 : 0;
  const tangentRow = normalCol === 0 ? 0 : 1;
  const tangentCol = normalRow === 0 ? 0 : 1;

  const maxAlong = normalRow !== 0 ? spec.height - 1 : spec.width - 1;
  const maxLateral = (tangentRow !== 0 ? spec.height : spec.width) / 2;

  const rimWidth = Math.max(2, spec.width * RIM_WIDTH_FRACTION);
  const notchRadius = Math.max(2, spec.width * NOTCH_RADIUS_FRACTION);
  const dem = new Float64Array(spec.width * spec.height);

  for (let row = 0; row < spec.height; row++) {
    for (let col = 0; col < spec.width; col++) {
      const index = row * spec.width + col;
      const dRow = row - outletRow;
      const dCol = col - outletCol;

      // Distance into the catchment from the outlet edge, and sideways off the
      // trough axis. Both normalised to [0, 1].
      const along = clamp01(Math.abs(dRow * normalRow + dCol * normalCol) / maxAlong);
      const lateral = clamp01(
        Math.abs(dRow * tangentRow + dCol * tangentCol) / maxLateral,
      );

      // Distance to the nearest grid edge, for the divide wall.
      const edgeDistance = Math.min(row, col, spec.height - 1 - row, spec.width - 1 - col);
      const rimFalloff = 1 - clamp01(edgeDistance / rimWidth);

      // Notch the wall away near the outlet so the catchment has exactly one
      // way out. smoothstep rather than a hard cut, or the fill has to resolve a
      // step change and the river mouth develops a visible cliff.
      const outletDistance = Math.hypot(dRow, dCol);
      const notch = smoothstep(0, notchRadius, outletDistance);

      dem[index] =
        TILT_WEIGHT * along +
        LATERAL_WEIGHT * lateral * lateral +
        RIM_WEIGHT * rimFalloff * rimFalloff * notch +
        NOISE_WEIGHT * surface[index];
    }
  }

  // Rescale to the relief this catchment's extent implies, so the weights above
  // stay pure shape ratios and steepness is set in one place.
  const relief = reliefFor(spec);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < dem.length; i++) {
    if (dem[i] < min) min = dem[i];
    if (dem[i] > max) max = dem[i];
  }
  const scale = max > min ? relief / (max - min) : 0;
  for (let i = 0; i < dem.length; i++) dem[i] = (dem[i] - min) * scale;

  // Pin the outlet below every neighbour so it is unambiguously the low point.
  // The fill seeds here, and a seed that is not the local minimum immediately
  // floods its own neighbourhood.
  let lowestNeighbour = Infinity;
  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      const r = outletRow + dRow;
      const c = outletCol + dCol;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;
      const index = r * spec.width + c;
      if (index !== outlet) lowestNeighbour = Math.min(lowestNeighbour, dem[index]);
    }
  }
  dem[outlet] = Math.min(dem[outlet], lowestNeighbour) - 1;

  return { dem, outlet };
}
