/**
 * Timing harness for the recompute budget.
 *
 * Run explicitly: `npx vitest run tools/bench.test.ts`.
 *
 * The budget is the reason the game works the way it does. If a placement cannot
 * be reflected in the risk overlay inside a frame or two, the overlay has to
 * update on release instead of live, and the immediate cause-and-effect that
 * makes the model legible is lost. Everything from the Float32 fraction table to
 * the radix sort to the single-sweep Network Index exists to protect this
 * number, so it is measured rather than assumed.
 */

import { describe, it } from "vitest";
import { GRID } from "../src/config";
import { buildRiskWeight } from "../src/scimap/landcover";
import { recomputeFromTwi, recomputeFromWeights } from "../src/scimap/pipeline";
import { LandCover } from "../src/scimap/constants";
import { capacityCells, storageBreakTwi } from "../src/scimap/twi";
import { createWorld } from "../src/world";

function time(label: string, runs: number, fn: () => void): number {
  // One warm-up run so JIT compilation is not charged to the first sample.
  fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const worst = samples[samples.length - 1];
  console.log(`  ${label.padEnd(34)} median ${median.toFixed(2)} ms   worst ${worst.toFixed(2)} ms`);
  return median;
}

describe("bench", () => {
  it("measures cold generation and the incremental recompute tiers", () => {
    console.log(`\ngrid ${GRID.width}x${GRID.height} (${GRID.width * GRID.height} cells)`);

    time("cold: createWorld (seed to layers)", 3, () => {
      createWorld(20260809, { spec: GRID });
    });

    const world = createWorld(20260809, { spec: GRID });
    const { arrays, bounds } = world;

    // Tier A: a tree planted away from the riparian zone. Land cover changed,
    // connectivity did not.
    let plantTarget = 0;
    for (let i = 0; i < arrays.landCover.length; i++) {
      if (arrays.landCover[i] === LandCover.Arable) {
        plantTarget = i;
        break;
      }
    }
    time("tier A: recomputeFromWeights", 30, () => {
      arrays.landCover[plantTarget] =
        arrays.landCover[plantTarget] === LandCover.Woodland
          ? LandCover.Arable
          : LandCover.Woodland;
      buildRiskWeight(arrays.landCover, arrays.riskWeight);
      recomputeFromWeights(arrays, bounds);
    });

    // Tier B: a pond or leaky dam. Connectivity changes, the DEM does not.
    const capacity = capacityCells(100, GRID.cellSize * GRID.cellSize);
    let pondTarget = 0;
    for (let i = 0; i < arrays.accum.length; i++) {
      if (!arrays.channelMask[i] && arrays.slopeDeg[i] < 5 && arrays.accum[i] > 150) {
        pondTarget = i;
        break;
      }
    }
    const breakValue = storageBreakTwi(
      arrays.accum[pondTarget],
      arrays.slopeDeg[pondTarget],
      arrays.rainfallScaled[pondTarget],
      capacity,
    );
    time("tier B: recomputeFromTwi (1 feature)", 30, () => {
      recomputeFromTwi(arrays, bounds, [{ cell: pondTarget, twi: breakValue }]);
    });

    // A well-developed catchment: the player has been at it for a while.
    const many = [];
    for (let i = 0; i < arrays.accum.length && many.length < 60; i++) {
      if (!arrays.channelMask[i] && arrays.slopeDeg[i] < 5 && arrays.accum[i] > 100) {
        many.push({
          cell: i,
          twi: storageBreakTwi(
            arrays.accum[i],
            arrays.slopeDeg[i],
            arrays.rainfallScaled[i],
            capacity,
          ),
        });
      }
    }
    time(`tier B: recomputeFromTwi (${many.length} features)`, 30, () => {
      recomputeFromTwi(arrays, bounds, many);
    });
  }, 300_000);
});
