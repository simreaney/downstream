/**
 * Seed to playable catchment.
 *
 * One function, so there is exactly one definition of what a world *is* and the
 * worker, the tests and the preview tools cannot drift apart in how they build
 * one. Given the same seed this is fully deterministic, which is what allows a
 * save file to be nothing but a seed plus an ordered list of interventions.
 */

import { GRID } from "./config";
import type { GridSpec } from "./core/grid";
import { createRng, splitSeed } from "./core/rng";
import type { StretchBounds } from "./core/normalise";
import { runFullScimap, type ScimapArrays } from "./scimap/pipeline";
import { generateLandCover } from "./terrain/landcoverGen";
import { generateTerrain, type TerrainOptions } from "./terrain/generate";
import type { ProgressCallback } from "./worker/protocol";

export interface World {
  readonly seed: number;
  readonly spec: GridSpec;
  readonly arrays: ScimapArrays;
  /** Frozen baseline stretch endpoints. Must be persisted with the save. */
  readonly bounds: StretchBounds;
}

export interface WorldOptions extends TerrainOptions {
  readonly spec?: GridSpec;
}

export function createWorld(
  seed: number,
  options: WorldOptions = {},
  onProgress?: ProgressCallback,
): World {
  const spec = options.spec ?? GRID;

  const terrain = generateTerrain(seed, { ...options, spec, onProgress });

  const { arrays, bounds } = runFullScimap(
    terrain.dem,
    (dem, slopeDeg) =>
      generateLandCover(dem, slopeDeg, spec, createRng(splitSeed(seed, "landcover"))),
    spec,
    terrain.outlet,
    onProgress,
  );

  return { seed, spec, arrays, bounds };
}
