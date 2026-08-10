/**
 * Catchment health, in three parts.
 *
 * Every figure is a **reduction against the frozen t=0 baseline** — a percentage
 * improvement on the catchment as it was found. That is how catchment management
 * results are actually reported, and it is the only framing that works given the
 * risk layers are relative products with no absolute units.
 *
 * Three sub-scores rather than one number, because the three tools act on
 * genuinely different processes and a single score would hide that. Planting
 * changes the source term; ponds change storage; dams change timing. A player
 * who only plants will watch Water Quality climb while Flood Risk sits still,
 * which is the lesson — no single intervention fixes a catchment.
 */

import { clamp01 } from "../core/clamp";
import type { CatchmentMetrics } from "../scimap/metrics";

export interface StormSummary {
  readonly peakQ: number;
  readonly baselinePeakQ: number;
  readonly tPeakSeconds: number;
  readonly baselineTPeakSeconds: number;
}

export interface Scores {
  /** Each 0-100. */
  readonly waterQuality: number;
  readonly floodRisk: number;
  readonly habitat: number;
  readonly overall: number;
}

/** Woodland fraction treated as a fully restored catchment. */
const WOODLAND_TARGET = 0.3;
/** Ponds beyond which more add nothing to the habitat score. */
const POND_TARGET = 8;

/**
 * Guard against dividing by a baseline of nearly zero.
 *
 * A pristine catchment would otherwise report an infinite improvement the moment
 * anything at all changed.
 */
function reduction(now: number, baseline: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(baseline) || baseline <= 1e-9) return 0;
  return clamp01(1 - now / baseline);
}

/**
 * Water Quality: delivered sediment concentration where it matters.
 *
 * Weighted towards the fishery rather than the outlet, because the fishery is
 * the receptor the player can see responding — and because a score dominated by
 * the outlet would reward work anywhere in the catchment equally, which is
 * exactly the undifferentiated thinking the risk map exists to correct.
 */
export function computeWaterQuality(
  now: CatchmentMetrics,
  baseline: CatchmentMetrics,
): number {
  const fishery = reduction(now.inChannelAtFishery, baseline.inChannelAtFishery);
  const outlet = reduction(now.inChannelAtOutlet, baseline.inChannelAtOutlet);
  const source = reduction(now.meanSourceRisk, baseline.meanSourceRisk);
  return 100 * clamp01(0.45 * fishery + 0.3 * outlet + 0.25 * source);
}

/**
 * Flood Risk: measured from a storm, not inferred from the static map.
 *
 * Before the first storm there is nothing to measure, so the score reports
 * installed storage as a proxy rather than showing zero — a player who has dug
 * three ponds has done something, and telling them otherwise is wrong.
 *
 * `peakQ` and `tPeak` are the two figures the natural flood management
 * literature reports, so they should read as correct on sight to anyone who
 * knows the field.
 */
export function computeFloodRisk(
  storm: StormSummary | null,
  storageM3: number,
  designStormVolumeM3: number,
): number {
  if (!storm) {
    return 100 * clamp01(storageM3 / Math.max(1, designStormVolumeM3));
  }

  const peakCut = reduction(storm.peakQ, storm.baselinePeakQ);
  // Delay credited up to a 50% increase in time to peak, past which extra lag
  // stops being useful — the flood still arrives, and evacuation time saturates.
  const lag =
    storm.baselineTPeakSeconds > 0
      ? clamp01((storm.tPeakSeconds / storm.baselineTPeakSeconds - 1) / 0.5)
      : 0;

  return 100 * clamp01(0.7 * peakCut + 0.3 * lag);
}

/**
 * Habitat: continuity first, area second.
 *
 * The corridor term carries the most weight because an unbroken streamside
 * corridor is worth far more than the same trees scattered — the same judgement
 * the buffer model makes about water, applied to wildlife.
 */
export function computeHabitat(now: CatchmentMetrics): number {
  const bankFraction =
    now.channelCells > 0 ? now.bufferedChannelCells / now.channelCells : 0;
  const corridor =
    now.channelCells > 0 ? now.longestBufferRun / Math.max(1, now.channelCells * 0.35) : 0;
  const ponds = clamp01(now.pondCount / POND_TARGET);
  const woodland = clamp01(now.woodlandFraction / WOODLAND_TARGET);

  return (
    100 *
    clamp01(0.3 * clamp01(bankFraction) + 0.35 * clamp01(corridor) + 0.15 * ponds + 0.2 * woodland)
  );
}

export function computeScores(
  now: CatchmentMetrics,
  baseline: CatchmentMetrics,
  storm: StormSummary | null,
  storageM3: number,
  designStormVolumeM3: number,
): Scores {
  const waterQuality = computeWaterQuality(now, baseline);
  const floodRisk = computeFloodRisk(storm, storageM3, designStormVolumeM3);
  const habitat = computeHabitat(now);

  // Water quality leads the headline: it is the problem the game is named for,
  // and the one the risk map is about.
  const overall = 0.45 * waterQuality + 0.3 * floodRisk + 0.25 * habitat;
  return { waterQuality, floodRisk, habitat, overall };
}
