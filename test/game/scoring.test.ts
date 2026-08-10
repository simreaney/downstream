/**
 * Scoring and receptors.
 *
 * The direction tests are the point. Every sub-score must move up when the
 * catchment improves and never when it does not — a score that drifted upward on
 * its own, or that rewarded scattering trees as much as banding them, would
 * quietly teach the wrong lesson while looking like it worked.
 */

import { describe, expect, it } from "vitest";
import {
  computeFloodRisk,
  computeHabitat,
  computeScores,
  computeWaterQuality,
  type StormSummary,
} from "../../src/game/scoring";
import { floodVillage, initialReceptors, MAX_FISH, updateReceptors } from "../../src/game/receptors";
import type { CatchmentMetrics } from "../../src/scimap/metrics";

function metrics(overrides: Partial<CatchmentMetrics> = {}): CatchmentMetrics {
  return {
    meanSourceRisk: 0.1,
    meanConnectivity: 0.5,
    inChannelAtOutlet: 0.4,
    inChannelAtFishery: 0.45,
    woodlandFraction: 0.15,
    channelCells: 1000,
    bufferedChannelCells: 100,
    longestBufferRun: 20,
    pondCount: 0,
    ...overrides,
  };
}

describe("water quality", () => {
  it("is zero on an untouched catchment", () => {
    const baseline = metrics();
    expect(computeWaterQuality(baseline, baseline)).toBe(0);
  });

  it("rises as delivered sediment falls", () => {
    const baseline = metrics();
    const improved = metrics({
      inChannelAtFishery: 0.22,
      inChannelAtOutlet: 0.2,
      meanSourceRisk: 0.05,
    });
    expect(computeWaterQuality(improved, baseline)).toBeGreaterThan(40);
  });

  it("weights the fishery above the outlet", () => {
    const baseline = metrics();
    const fisheryFixed = computeWaterQuality(metrics({ inChannelAtFishery: 0 }), baseline);
    const outletFixed = computeWaterQuality(metrics({ inChannelAtOutlet: 0 }), baseline);
    expect(fisheryFixed).toBeGreaterThan(outletFixed);
  });

  it("never goes negative when the catchment gets worse", () => {
    const baseline = metrics();
    const worse = metrics({ inChannelAtFishery: 0.9, inChannelAtOutlet: 0.9, meanSourceRisk: 0.5 });
    expect(computeWaterQuality(worse, baseline)).toBe(0);
  });

  it("survives a pristine baseline instead of reporting infinity", () => {
    const pristine = metrics({ inChannelAtFishery: 0, inChannelAtOutlet: 0, meanSourceRisk: 0 });
    const score = computeWaterQuality(metrics(), pristine);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(0);
  });
});

describe("flood risk", () => {
  const storm = (peak: number, tPeak: number): StormSummary => ({
    peakQ: peak,
    baselinePeakQ: 10,
    tPeakSeconds: tPeak,
    baselineTPeakSeconds: 3600,
  });

  it("reports installed storage before the first storm, not zero", () => {
    // A player who has dug three ponds has done something; telling them nothing
    // has changed is simply wrong.
    expect(computeFloodRisk(null, 300, 1000)).toBeCloseTo(30, 6);
    expect(computeFloodRisk(null, 0, 1000)).toBe(0);
  });

  it("rewards cutting the peak", () => {
    expect(computeFloodRisk(storm(5, 3600), 0, 1000)).toBeGreaterThan(
      computeFloodRisk(storm(9, 3600), 0, 1000),
    );
  });

  it("rewards delaying the peak, up to a point", () => {
    const delayed = computeFloodRisk(storm(10, 5400), 0, 1000);
    const undelayed = computeFloodRisk(storm(10, 3600), 0, 1000);
    expect(delayed).toBeGreaterThan(undelayed);

    // Beyond a 50% increase, more lag stops earning credit.
    expect(computeFloodRisk(storm(10, 9000), 0, 1000)).toBeCloseTo(
      computeFloodRisk(storm(10, 5400), 0, 1000),
      6,
    );
  });

  it("scores a storm that got worse as zero, not as a negative", () => {
    expect(computeFloodRisk(storm(14, 3000), 0, 1000)).toBe(0);
  });
});

describe("habitat", () => {
  it("prefers one continuous corridor to the same cover scattered", () => {
    const banded = computeHabitat(metrics({ bufferedChannelCells: 200, longestBufferRun: 200 }));
    const scattered = computeHabitat(metrics({ bufferedChannelCells: 200, longestBufferRun: 8 }));
    expect(banded).toBeGreaterThan(scattered);
  });

  it("rises with buffered bank, ponds and woodland", () => {
    const bare = computeHabitat(metrics({ bufferedChannelCells: 0, longestBufferRun: 0 }));
    const rich = computeHabitat(
      metrics({ bufferedChannelCells: 700, longestBufferRun: 350, pondCount: 8, woodlandFraction: 0.3 }),
    );
    expect(rich).toBeGreaterThan(bare);
    expect(rich).toBeLessThanOrEqual(100);
  });

  it("copes with a catchment that has no channel at all", () => {
    const score = computeHabitat(metrics({ channelCells: 0, bufferedChannelCells: 0 }));
    expect(Number.isFinite(score)).toBe(true);
  });
});

describe("computeScores", () => {
  it("keeps every part inside 0-100", () => {
    const baseline = metrics();
    const scores = computeScores(metrics({ inChannelAtFishery: 0 }), baseline, null, 0, 1000);
    for (const value of Object.values(scores)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("receptors", () => {
  it("starts turbid with no fish", () => {
    const state = initialReceptors();
    expect(state.fishCount).toBe(0);
    expect(state.fisheryClarity).toBe(0);
  });

  it("clears slowly rather than snapping", () => {
    const scores = { waterQuality: 100, floodRisk: 0, habitat: 0, overall: 0 };
    let state = initialReceptors();

    state = updateReceptors(state, scores, 1);
    // One second must not deliver a whole game day of recovery.
    expect(state.fisheryClarity).toBeGreaterThan(0);
    expect(state.fisheryClarity).toBeLessThan(0.2);

    for (let i = 0; i < 600; i++) state = updateReceptors(state, scores, 1);
    expect(state.fisheryClarity).toBeGreaterThan(0.9);
    expect(state.fishCount).toBeGreaterThan(MAX_FISH * 0.6);
  });

  it("drains the village flood over time", () => {
    let state = floodVillage(initialReceptors(), 0.8);
    expect(state.villageFloodDepthM).toBeCloseTo(0.8, 6);

    const scores = { waterQuality: 0, floodRisk: 0, habitat: 0, overall: 0 };
    state = updateReceptors(state, scores, 1);
    expect(state.villageDamage).toBe(2);

    for (let i = 0; i < 400; i++) state = updateReceptors(state, scores, 1);
    expect(state.villageFloodDepthM).toBeLessThan(0.01);
    expect(state.villageDamage).toBe(0);
  });
});
