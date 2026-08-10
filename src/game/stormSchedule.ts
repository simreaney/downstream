/**
 * Storms that arrive on their own.
 *
 * The manual key runs a *named design event* — "show me the 1-in-30" — which is
 * a test the player chooses to run. Scheduled storms are the other half: weather
 * that happens whether or not the catchment is ready, drawn from the same Gumbel
 * distribution the design events come from.
 *
 * The two answer different questions and the game needs both. A design event
 * lets the player check their work against a stated standard; scheduled weather
 * is what makes that work matter, because most events are modest and the
 * occasional large one arrives without being asked for.
 *
 * Depths are *sampled*, so most scheduled storms are small. That is the point —
 * a catchment that only ever sees its design event has never been tested by the
 * ordinary run of weather, and a player who has watched twenty small storms pass
 * harmlessly has earned the moment when a big one does not.
 */

import { createRng, splitSeed, type Rng } from "../core/rng";
import { fitGumbel, sampleStormDepth, type Gumbel } from "../sim/gumbel";

/** Real seconds per game day. */
export const DAY_SECONDS = 90;

/** Game days between scheduled storms, before jitter. */
const MEAN_INTERVAL_DAYS = 3;
const INTERVAL_JITTER_DAYS = 1.5;

/**
 * Grace period before the first scheduled storm, in game days.
 *
 * Long enough that a new player has walked the catchment, read the map and
 * planted something before the weather turns up to judge it.
 */
const FIRST_STORM_DAYS = 4;

/**
 * Depth below which a scheduled storm is skipped rather than played, in mm.
 *
 * Sampling means roughly half of all draws are drizzle. Running the full
 * twenty-second playback for a storm that moves nothing would train the player
 * to ignore storms, so small ones pass unremarked — the day simply goes by.
 */
const MIN_INTERESTING_DEPTH_MM = 14;

export interface ScheduledStorm {
  readonly index: number;
  readonly depthMm: number;
}

export interface StormSchedule {
  /** Game days elapsed. */
  readonly days: number;
  /** Advance the clock; returns a storm if one is due. */
  tick(dt: number): ScheduledStorm | null;
  /** Push the next storm back, e.g. while one is already playing. */
  defer(days: number): void;
}

export function createStormSchedule(seed: number): StormSchedule {
  const gumbel: Gumbel = fitGumbel();
  const rng: Rng = createRng(splitSeed(seed, "weather"));

  let days = 0;
  let nextAt = FIRST_STORM_DAYS;
  let index = 0;

  const scheduleNext = (): void => {
    nextAt =
      days + MEAN_INTERVAL_DAYS + rng.range(-INTERVAL_JITTER_DAYS, INTERVAL_JITTER_DAYS);
  };

  return {
    get days() {
      return days;
    },

    tick(dt) {
      days += dt / DAY_SECONDS;
      if (days < nextAt) return null;

      const depthMm = sampleStormDepth(gumbel, rng);
      scheduleNext();

      // Drizzle passes without ceremony. The clock has still moved on, so the
      // player is not owed an event for having waited.
      if (depthMm < MIN_INTERESTING_DEPTH_MM) return null;

      return { index: index++, depthMm };
    },

    defer(byDays) {
      nextAt = Math.max(nextAt, days + byDays);
    },
  };
}
