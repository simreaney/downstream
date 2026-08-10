/**
 * Storm depth from a Gumbel (EV1) distribution.
 *
 * Ported from the author's earlier flood-defence game, with one change: that
 * version fits through the first two anchors and ignores the third, so a
 * carefully chosen 1-in-100 figure has no effect on anything. This fits all
 * anchors by least squares, so every one of them informs the curve.
 *
 * The other change is what the distribution describes. The earlier game sampled
 * flood *stage* directly; here it samples rainfall *depth*, and the catchment
 * turns that into a flood by routing it. That is the whole point — the player
 * changes the catchment, so the flood has to be produced rather than asserted,
 * or leaky dams and ponds could not possibly matter.
 */

import type { Rng } from "../core/rng";

export interface StormAnchor {
  readonly depthMm: number;
  /** Average interval between events at least this large, in game days. */
  readonly returnPeriodDays: number;
}

/**
 * Design storms for a temperate maritime catchment.
 *
 * Chosen so that ordinary events are frequent enough for the player to see their
 * work paying off within a session, while the rare event is large enough to
 * overtop defences that looked adequate.
 *
 * They are also deliberately *self-consistent*: they lie on an actual Gumbel
 * curve (mu 8 mm, beta 7 mm), so the least-squares fit reproduces all three to
 * within a few tenths of a millimetre. An earlier set was picked for feel alone
 * and turned out to be badly non-linear in the reduced variate — the fit then
 * missed the middle anchor by 8%, which is not a bug in the fit but a sign that
 * the anchors did not describe the distribution being fitted. If these are
 * retuned, keep them on a line in reduced-variate space or the same will happen.
 */
export const STORM_ANCHORS: readonly StormAnchor[] = [
  { depthMm: 24, returnPeriodDays: 10 },
  { depthMm: 32, returnPeriodDays: 30 },
  { depthMm: 40, returnPeriodDays: 100 },
];

export interface Gumbel {
  /** Location parameter, in millimetres. */
  readonly mu: number;
  /** Scale parameter, in millimetres. */
  readonly beta: number;
}

/**
 * The Gumbel reduced variate for a return period.
 *
 * `y = -ln(-ln(F))` where `F = 1 - 1/T` is the non-exceedance probability. The
 * distribution is linear in `y`, which is what makes the fit a straight line.
 */
export function reducedVariate(returnPeriodDays: number): number {
  const nonExceedance = 1 - 1 / returnPeriodDays;
  return -Math.log(-Math.log(nonExceedance));
}

/** Least-squares fit of depth against the reduced variate. */
export function fitGumbel(anchors: readonly StormAnchor[] = STORM_ANCHORS): Gumbel {
  if (anchors.length < 2) throw new Error("Gumbel fit needs at least two anchors");

  let sumY = 0;
  let sumX = 0;
  let sumYY = 0;
  let sumXY = 0;

  for (const anchor of anchors) {
    const y = reducedVariate(anchor.returnPeriodDays);
    sumY += y;
    sumX += anchor.depthMm;
    sumYY += y * y;
    sumXY += y * anchor.depthMm;
  }

  const n = anchors.length;
  const denominator = n * sumYY - sumY * sumY;
  if (Math.abs(denominator) < 1e-12) {
    throw new Error("Gumbel anchors must span more than one return period");
  }

  const beta = (n * sumXY - sumY * sumX) / denominator;
  const mu = (sumX - beta * sumY) / n;
  return { mu, beta };
}

/** Depth exceeded on average once every `returnPeriodDays`. */
export function depthForReturnPeriod(gumbel: Gumbel, returnPeriodDays: number): number {
  return gumbel.mu + gumbel.beta * reducedVariate(returnPeriodDays);
}

/**
 * Draw a storm depth, in millimetres.
 *
 * Inverse CDF: `x = mu - beta * ln(-ln(u))`. Seeded, so a saved game replays its
 * storms exactly — which matters because the score compares a catchment against
 * its own past performance.
 */
export function sampleStormDepth(gumbel: Gumbel, rng: Rng): number {
  // Guard the tails: u of exactly 0 or 1 sends the log to infinity.
  const u = Math.min(Math.max(rng.next(), 1e-9), 1 - 1e-9);
  return Math.max(1, gumbel.mu - gumbel.beta * Math.log(-Math.log(u)));
}

/** Return period implied by a depth, for reporting an event to the player. */
export function returnPeriodForDepth(gumbel: Gumbel, depthMm: number): number {
  const y = (depthMm - gumbel.mu) / gumbel.beta;
  const nonExceedance = Math.exp(-Math.exp(-y));
  return 1 / Math.max(1e-9, 1 - nonExceedance);
}
