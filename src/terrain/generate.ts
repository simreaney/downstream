/**
 * Seed to topography.
 *
 * The order of these five stages is not interchangeable. Ridged noise supplies
 * texture but no drainage; conditioning supplies catchment-scale shape but no
 * detail; erosion turns the two into an actual valley network; talus relaxation
 * makes the result walkable; and the final smoothing pass removes the cell-scale
 * speckle that would otherwise destroy every slope-derived layer downstream.
 *
 * Everything is driven from `splitSeed(seed, ...)` streams, so the same seed
 * reproduces the same catchment on any machine, in any browser, after any
 * reload. That is what lets a save file be a seed plus a list of interventions.
 */

import type { GridSpec } from "../core/grid";
import { createRng, splitSeed } from "../core/rng";
import type { ProgressCallback } from "../worker/protocol";
import { fillDepressions } from "../scimap/fill";
import { GRID } from "../config";
import { conditionSurface } from "./conditioning";
import { DEFAULT_EROSION, erode, type ErosionParams } from "./hydraulicErosion";
import { generateBaseSurface } from "./ridgedFbm";
import { smooth } from "./smooth";
import { DEFAULT_THERMAL_SWEEPS, thermalErode } from "./thermalErosion";

export interface TerrainResult {
  readonly spec: GridSpec;
  readonly seed: number;
  /** Elevation in metres, row-major. */
  readonly dem: Float64Array;
  /** The single cell the catchment drains to. */
  readonly outlet: number;
}

export interface TerrainOptions {
  spec?: GridSpec;
  erosion?: Partial<ErosionParams>;
  thermalSweeps?: number;
  smoothSigma?: number;
  onProgress?: ProgressCallback;
}

export function generateTerrain(seed: number, options: TerrainOptions = {}): TerrainResult {
  const spec = options.spec ?? GRID;
  const onProgress = options.onProgress;

  onProgress?.(2, "1.1 Raising the ground…");
  const surface = generateBaseSurface(spec, createRng(splitSeed(seed, "terrain:base")));

  onProgress?.(6, "1.2 Shaping the catchment…");
  const { dem, outlet } = conditionSurface(
    spec,
    surface,
    createRng(splitSeed(seed, "terrain:shape")),
  );

  // Condition *before* eroding, not only after. Ridged noise leaves closed
  // basins, and a droplet that falls into one spends the rest of its life
  // circling and depositing, which builds a plug rather than cutting an outlet.
  // Filling first gives every droplet a continuous downhill path to follow, so
  // erosion spends its effort carving the drainage network instead of fighting
  // artefacts of the noise. The pipeline fills again at the end to catch the
  // shallow pits erosion itself creates.
  onProgress?.(8, "1.3 Draining the hollows…");
  fillDepressions(dem, spec, outlet);

  onProgress?.(10, "1.4 Cutting the valleys…");
  erode(dem, spec, createRng(splitSeed(seed, "terrain:erosion")), {
    ...DEFAULT_EROSION,
    ...options.erosion,
  });

  onProgress?.(26, "1.5 Settling the slopes…");
  thermalErode(dem, spec, options.thermalSweeps ?? DEFAULT_THERMAL_SWEEPS);

  onProgress?.(30, "1.6 Smoothing…");
  smooth(dem, spec, options.smoothSigma);

  // The smoothing pass runs over the whole grid including the outlet, so the
  // pin applied during conditioning has been blurred away. Restore it: the fill
  // seeds here and needs this cell to be the unambiguous low point.
  let lowestNeighbour = Infinity;
  const outletRow = (outlet / spec.width) | 0;
  const outletCol = outlet % spec.width;
  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      const r = outletRow + dRow;
      const c = outletCol + dCol;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;
      const index = r * spec.width + c;
      if (index !== outlet) lowestNeighbour = Math.min(lowestNeighbour, dem[index]);
    }
  }
  dem[outlet] = lowestNeighbour - 1;

  onProgress?.(32, "1.7 Topography ready.");
  return { spec, seed, dem, outlet };
}
