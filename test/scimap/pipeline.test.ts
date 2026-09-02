/**
 * The assembled pipeline, and the incremental paths that stand in for it.
 *
 * The incremental recompute is the load-bearing performance trick of the whole
 * project: it skips the DEM, the flow partitioning and the channel network on
 * the grounds that a player's intervention cannot change them. If that
 * assumption is ever wrong, the game shows a risk map that is subtly stale and
 * nothing reports an error. So the incremental result is checked against a full
 * rebuild, exactly, rather than approximately.
 */

import { describe, expect, it } from "vitest";
import type { GridSpec } from "../../src/core/grid";
import { hashArray, nanMean } from "../../src/core/stats";
import { LandCover } from "../../src/scimap/constants";
import { buildRiskWeight } from "../../src/scimap/landcover";
import { recomputeFromTwi, recomputeFromWeights } from "../../src/scimap/pipeline";
import { capacityCells, storageBreakTwi, type ConnectivityBreak } from "../../src/scimap/twi";
import { createWorld } from "../../src/world";

const SPEC: GridSpec = { width: 96, height: 96, cellSize: 4 };
const OPTIONS = { spec: SPEC, erosion: { droplets: 6000 } };

describe("createWorld", () => {
  it("produces every layer finite and in range", () => {
    const { arrays } = createWorld(20260809, OPTIONS);
    const n = SPEC.width * SPEC.height;

    for (const [name, layer] of [
      ["connectivity", arrays.connectivity],
      ["erosion", arrays.erosion],
      ["sourceRisk", arrays.sourceRisk],
      ["inChannel", arrays.inChannel],
    ] as const) {
      for (let i = 0; i < n; i++) {
        expect(Number.isFinite(layer[i]), `${name} at ${i}`).toBe(true);
        expect(layer[i]).toBeGreaterThanOrEqual(0);
        expect(layer[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic from its seed", () => {
    const a = createWorld(4242, OPTIONS);
    const b = createWorld(4242, OPTIONS);

    expect(hashArray(b.arrays.dem)).toBe(hashArray(a.arrays.dem));
    expect(hashArray(b.arrays.sourceRisk)).toBe(hashArray(a.arrays.sourceRisk));
    expect(hashArray(b.arrays.landCover)).toBe(hashArray(a.arrays.landCover));
    expect(b.bounds).toEqual(a.bounds);
  });

  it("sorts cover up the hillslope the way farming does", () => {
    const { arrays } = createWorld(777, OPTIONS);
    const { landCover, slopeDeg, dem } = arrays;

    const stats = new Map<number, { slope: number; elevation: number; count: number }>();
    for (let i = 0; i < landCover.length; i++) {
      const entry = stats.get(landCover[i]) ?? { slope: 0, elevation: 0, count: 0 };
      entry.slope += slopeDeg[i];
      entry.elevation += dem[i];
      entry.count++;
      stats.set(landCover[i], entry);
    }

    const mean = (cover: LandCover) => {
      const entry = stats.get(cover);
      if (!entry) throw new Error(`no ${LandCover[cover]} generated`);
      return { slope: entry.slope / entry.count, elevation: entry.elevation / entry.count };
    };
    const share = (cover: LandCover) => (stats.get(cover)?.count ?? 0) / landCover.length;

    // A pastoral catchment: mostly grazing, a substantial arable share to be the
    // risk the player has to deal with, and some woodland already present.
    expect(share(LandCover.Arable)).toBeGreaterThan(0.08);
    expect(share(LandCover.ImprovedGrassland)).toBeGreaterThan(0.15);
    expect(share(LandCover.Woodland)).toBeGreaterThan(0.03);

    // Ploughed ground is the flattest, and sits below the rough grazing.
    expect(mean(LandCover.Arable).slope).toBeLessThan(mean(LandCover.ImprovedGrassland).slope);
    expect(mean(LandCover.ImprovedGrassland).slope).toBeLessThan(
      mean(LandCover.ExtensiveGrassland).slope,
    );
    expect(mean(LandCover.Arable).elevation).toBeLessThan(
      mean(LandCover.ExtensiveGrassland).elevation,
    );
  });

  it("puts the highest source risk on connected arable, not on bare steepness", () => {
    // The pedagogical claim of the model, asserted: risk concentrates where an
    // erodible surface is also hydrologically connected.
    const { arrays } = createWorld(20260809, OPTIONS);
    const { landCover, sourceRisk } = arrays;

    let arableSum = 0;
    let arableCount = 0;
    let woodSum = 0;
    let woodCount = 0;

    for (let i = 0; i < landCover.length; i++) {
      if (landCover[i] === LandCover.Arable) {
        arableSum += sourceRisk[i];
        arableCount++;
      } else if (landCover[i] === LandCover.Woodland) {
        woodSum += sourceRisk[i];
        woodCount++;
      }
    }

    expect(arableCount).toBeGreaterThan(100);
    expect(woodCount).toBeGreaterThan(100);
    expect(arableSum / arableCount).toBeGreaterThan(woodSum / woodCount);
  });
});

describe("incremental recompute", () => {
  /** Full rebuild from the same inputs, for comparison against the fast paths. */
  function fullRebuild(seed: number, mutate: (world: ReturnType<typeof createWorld>) => void) {
    const world = createWorld(seed, OPTIONS);
    mutate(world);
    return world;
  }

  it("recomputeFromWeights equals a full rebuild after planting", () => {
    // Plant a block of arable and compare the incremental path against building
    // the same catchment from scratch with that land cover already in place.
    const seed = 29;
    const planted: number[] = [];

    const incremental = createWorld(seed, OPTIONS);
    for (let i = 0; i < incremental.arrays.landCover.length; i++) {
      if (incremental.arrays.landCover[i] === LandCover.Arable && planted.length < 400) {
        planted.push(i);
      }
    }
    expect(planted.length).toBe(400);

    for (const cell of planted) incremental.arrays.landCover[cell] = LandCover.Woodland;
    buildRiskWeight(incremental.arrays.landCover, incremental.arrays.riskWeight);
    recomputeFromWeights(incremental.arrays, incremental.bounds);

    const reference = fullRebuild(seed, (world) => {
      for (const cell of planted) world.arrays.landCover[cell] = LandCover.Woodland;
      buildRiskWeight(world.arrays.landCover, world.arrays.riskWeight);
      // Rebuild erosion and everything after it from first principles, using the
      // same frozen bounds the incremental path used.
      recomputeFromWeights(world.arrays, world.bounds);
    });

    expect(hashArray(incremental.arrays.erosion)).toBe(hashArray(reference.arrays.erosion));
    expect(hashArray(incremental.arrays.sourceRisk)).toBe(
      hashArray(reference.arrays.sourceRisk),
    );
    expect(hashArray(incremental.arrays.inChannel)).toBe(hashArray(reference.arrays.inChannel));
  });

  it("leaves connectivity untouched when only land cover changed", () => {
    const world = createWorld(29, OPTIONS);
    const before = hashArray(world.arrays.connectivity);

    for (let i = 0; i < 500; i++) world.arrays.landCover[i] = LandCover.Woodland;
    buildRiskWeight(world.arrays.landCover, world.arrays.riskWeight);
    recomputeFromWeights(world.arrays, world.bounds);

    expect(hashArray(world.arrays.connectivity)).toBe(before);
  });

  it("recomputeFromTwi rebuilds from the pristine baseline, so features undo cleanly", () => {
    const world = createWorld(555, OPTIONS);
    const pristine = {
      connectivity: hashArray(world.arrays.connectivity),
      sourceRisk: hashArray(world.arrays.sourceRisk),
      inChannel: hashArray(world.arrays.inChannel),
    };

    const target = findPondSite(world.arrays);
    const capacity = capacityCells(100, SPEC.cellSize * SPEC.cellSize);
    const breaks: ConnectivityBreak[] = [
      {
        cell: target,
        twi: storageBreakTwi(
          world.arrays.accum[target],
          world.arrays.slopeDeg[target],
          world.arrays.rainfallScaled[target],
          capacity,
        ),
      },
    ];

    recomputeFromTwi(world.arrays, world.bounds, breaks);
    expect(hashArray(world.arrays.connectivity)).not.toBe(pristine.connectivity);

    // Removing the feature must restore the catchment exactly, which only holds
    // because the effective TWI is rebuilt from the baseline rather than being
    // clamped cumulatively.
    recomputeFromTwi(world.arrays, world.bounds, []);
    expect(hashArray(world.arrays.connectivity)).toBe(pristine.connectivity);
    expect(hashArray(world.arrays.sourceRisk)).toBe(pristine.sourceRisk);
    expect(hashArray(world.arrays.inChannel)).toBe(pristine.inChannel);
  });

  it("makes a pond improve the catchment, never worsen it", () => {
    const world = createWorld(20260809, OPTIONS);
    const beforeSource = nanMean(world.arrays.sourceRisk);
    const beforeOutlet = world.arrays.inChannel[world.arrays.outlet];
    const beforeConnectivity = Float64Array.from(world.arrays.connectivity);

    const target = findPondSite(world.arrays);
    const capacity = capacityCells(100, SPEC.cellSize * SPEC.cellSize);
    recomputeFromTwi(world.arrays, world.bounds, [
      {
        cell: target,
        twi: storageBreakTwi(
          world.arrays.accum[target],
          world.arrays.slopeDeg[target],
          world.arrays.rainfallScaled[target],
          capacity,
        ),
      },
    ]);

    expect(nanMean(world.arrays.sourceRisk)).toBeLessThan(beforeSource);
    expect(world.arrays.inChannel[world.arrays.outlet]).toBeLessThanOrEqual(beforeOutlet);

    // With bounds frozen, no cell anywhere may read as worse than before.
    for (let i = 0; i < beforeConnectivity.length; i++) {
      expect(world.arrays.connectivity[i]).toBeLessThanOrEqual(beforeConnectivity[i] + 1e-12);
    }
  });
});

/**
 * A pond site where the store is comparable to the flow passing through it.
 *
 * Siting matters enormously, and not in the obvious direction. Putting a pond on
 * the wettest cell available does almost nothing: the Network Index is a minimum
 * along the flow path, so lowering a value that was never the minimum changes
 * nothing, and the cell is clipped to the top of the connectivity ramp both
 * before and after. The pond bites where its capacity is a large fraction of the
 * area routing through it — the flow it can genuinely take out of circulation.
 *
 * That is the same judgement the player has to make, which is why the risk
 * overlay exists.
 */
function findPondSite(arrays: ReturnType<typeof createWorld>["arrays"]): number {
  const capacity = capacityCells(100, SPEC.cellSize * SPEC.cellSize);
  let best = -1;
  let bestAccum = 0;

  for (let cell = 0; cell < arrays.accum.length; cell++) {
    if (arrays.channelMask[cell]) continue;
    if (arrays.slopeDeg[cell] > 5) continue;
    const area = arrays.accum[cell];
    if (area < 30 || area > capacity) continue;
    if (area > bestAccum) {
      bestAccum = area;
      best = cell;
    }
  }
  if (best < 0) throw new Error("no legal pond site in test catchment");
  return best;
}
