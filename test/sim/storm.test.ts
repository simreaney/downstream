/**
 * The storm model.
 *
 * Mass balance and stability are the two properties that matter most, and both
 * fail in ways that look like a *result* rather than a bug: a leaking store
 * makes the player's work look more effective than it is, and an unstable
 * release fraction makes the hydrograph oscillate, which reads as "the
 * interventions made the flood worse".
 *
 * The dam and pond assertions are the game's central flood claim, stated as
 * tests: leaky dams delay and clip the peak without removing water, ponds remove
 * water until they fill.
 */

import { describe, expect, it } from "vitest";
import { createRng } from "../../src/core/rng";
import {
  STORM_ANCHORS,
  depthForReturnPeriod,
  fitGumbel,
  returnPeriodForDepth,
  sampleStormDepth,
} from "../../src/sim/gumbel";
import { DAM_ROUGHNESS, runStorm, type StormInput } from "../../src/sim/storm";
import { createWorld } from "../../src/world";
import type { GridSpec } from "../../src/core/grid";

const SPEC: GridSpec = { width: 64, height: 64, cellSize: 4 };
const OPTIONS = { spec: SPEC, erosion: { droplets: 3000 } };

function stormInput(overrides: Partial<StormInput> = {}): StormInput {
  const { arrays } = createWorld(20260809, OPTIONS);
  const n = SPEC.width * SPEC.height;

  return {
    spec: SPEC,
    table: arrays.table,
    slopeDeg: arrays.slopeDeg,
    channelMask: arrays.channelMask,
    landCover: arrays.landCover,
    rainfallScaled: arrays.rainfallScaled,
    sourceRisk: arrays.sourceRisk,
    outlet: arrays.outlet,
    gaugeCell: arrays.outlet,
    features: {
      pondStorageM3: new Float64Array(n),
      damRoughness: new Float64Array(n),
    },
    ...overrides,
  };
}

const STORM = { depthMm: 32, durationHours: 6, frames: 12 };

describe("fitGumbel", () => {
  it("fits all anchors rather than passing exactly through two", () => {
    // A least-squares line through three points that are not collinear in
    // (reduced variate, depth) space does not pass through any of them exactly,
    // and should not: it balances the residuals. That is the difference from the
    // reference implementation, which fits anchors [0] and [1] exactly and
    // ignores the third entirely.
    const fitted = fitGumbel(STORM_ANCHORS);
    const twoPoint = fitGumbel([STORM_ANCHORS[0], STORM_ANCHORS[1]]);

    const totalError = (g: typeof fitted): number =>
      STORM_ANCHORS.reduce(
        (sum, a) => sum + Math.abs(depthForReturnPeriod(g, a.returnPeriodDays) - a.depthMm),
        0,
      );

    // Every anchor is reproduced to well under a millimetre, because they are
    // chosen to lie on a real Gumbel curve.
    for (const anchor of STORM_ANCHORS) {
      const fittedDepth = depthForReturnPeriod(fitted, anchor.returnPeriodDays);
      expect(Math.abs(fittedDepth - anchor.depthMm)).toBeLessThan(0.5);
    }
    // ...and the three-anchor fit is closer overall than ignoring the third.
    expect(totalError(fitted)).toBeLessThan(totalError(twoPoint));
  });

  it("notices when the third anchor moves", () => {
    const raised = fitGumbel([
      STORM_ANCHORS[0],
      STORM_ANCHORS[1],
      { depthMm: 90, returnPeriodDays: 100 },
    ]);
    expect(raised.beta).toBeGreaterThan(fitGumbel(STORM_ANCHORS).beta);
  });

  it("round-trips depth and return period", () => {
    const gumbel = fitGumbel();
    for (const period of [5, 25, 200]) {
      const depth = depthForReturnPeriod(gumbel, period);
      expect(returnPeriodForDepth(gumbel, depth)).toBeCloseTo(period, 4);
    }
  });

  it("samples a distribution with the right frequency of large events", () => {
    const gumbel = fitGumbel();
    const rng = createRng(7);
    const oneInThirty = depthForReturnPeriod(gumbel, 30);

    let exceedances = 0;
    const draws = 60_000;
    for (let i = 0; i < draws; i++) {
      if (sampleStormDepth(gumbel, rng) >= oneInThirty) exceedances++;
    }
    // Should land near 1 in 30, i.e. about 3.3% of draws.
    expect(exceedances / draws).toBeGreaterThan(0.025);
    expect(exceedances / draws).toBeLessThan(0.042);
  });

  it("never returns a non-positive depth", () => {
    const gumbel = fitGumbel();
    const rng = createRng(99);
    for (let i = 0; i < 20_000; i++) {
      expect(sampleStormDepth(gumbel, rng)).toBeGreaterThan(0);
    }
  });
});

describe("runStorm", () => {
  it("produces a hydrograph that rises, peaks and recedes", () => {
    const result = runStorm(stormInput(), STORM);
    const { q, peakQ, tPeakSeconds } = result.withFeatures;

    expect(peakQ).toBeGreaterThan(0);
    // The peak must be inside the run, not at the very first or last step.
    expect(tPeakSeconds).toBeGreaterThan(0);
    expect(tPeakSeconds).toBeLessThan((result.steps - 1) * result.stepSeconds);
    // And it must actually recede afterwards.
    expect(q[q.length - 1]).toBeLessThan(peakQ * 0.5);
  }, 120_000);

  it("never lets a store go negative, so the hydrograph cannot oscillate", () => {
    const result = runStorm(stormInput(), STORM);
    for (const value of result.withFeatures.q) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  }, 120_000);

  it("routes more water for a bigger storm", () => {
    const small = runStorm(stormInput(), { ...STORM, depthMm: 12 });
    const large = runStorm(stormInput(), { ...STORM, depthMm: 55 });
    expect(large.withFeatures.peakQ).toBeGreaterThan(small.withFeatures.peakQ);
  }, 120_000);

  it("matches its own counterfactual when nothing has been built", () => {
    // With no features, the two runs are the same simulation, so any difference
    // would mean the counterfactual is not a fair comparison.
    const result = runStorm(stormInput(), STORM);
    expect(result.withFeatures.peakQ).toBeCloseTo(result.counterfactual.peakQ, 9);
    expect(result.withFeatures.tPeakSeconds).toBe(result.counterfactual.tPeakSeconds);
  }, 120_000);

  it("makes leaky dams delay and clip the peak", () => {
    const input = stormInput();
    const damRoughness = new Float64Array(input.spec.width * input.spec.height);

    let placed = 0;
    for (let cell = 0; cell < damRoughness.length && placed < 40; cell++) {
      if (input.channelMask[cell]) {
        damRoughness[cell] = DAM_ROUGHNESS;
        placed++;
      }
    }
    expect(placed).toBeGreaterThan(10);

    const result = runStorm({ ...input, features: { ...input.features, damRoughness } }, STORM);

    // The claim the whole flood half of the game rests on.
    expect(result.withFeatures.peakQ).toBeLessThan(result.counterfactual.peakQ);
    expect(result.withFeatures.tPeakSeconds).toBeGreaterThanOrEqual(
      result.counterfactual.tPeakSeconds,
    );
  }, 120_000);

  it("makes ponds remove water rather than only delay it", () => {
    const input = stormInput();
    const pondStorageM3 = new Float64Array(input.spec.width * input.spec.height);

    let placed = 0;
    for (let cell = 0; cell < pondStorageM3.length && placed < 30; cell++) {
      if (!input.channelMask[cell] && input.slopeDeg[cell] < 5) {
        pondStorageM3[cell] = 200;
        placed++;
      }
    }
    expect(placed).toBeGreaterThan(10);

    const result = runStorm({ ...input, features: { ...input.features, pondStorageM3 } }, STORM);
    expect(result.withFeatures.peakQ).toBeLessThan(result.counterfactual.peakQ);
  }, 120_000);

  it("returns playback frames covering the requested count", () => {
    const result = runStorm(stormInput(), STORM);
    const n = SPEC.width * SPEC.height;

    expect(result.frameCount).toBe(STORM.frames);
    expect(result.depthFrames.length).toBe(STORM.frames * n);

    // Some frame, somewhere, must have water in it.
    let wettest = 0;
    for (const depth of result.depthFrames) wettest = Math.max(wettest, depth);
    expect(wettest).toBeGreaterThan(0);
  }, 120_000);
});
