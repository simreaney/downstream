/**
 * Scheduled weather.
 *
 * Two properties matter. Storms must be reproducible from the seed, or a
 * reloaded save gets different weather and the score stops comparing like with
 * like. And the schedule must sample rather than repeat a design event, so most
 * storms are modest and the occasional large one is genuinely a surprise.
 */

import { describe, expect, it } from "vitest";
import { createStormSchedule, DAY_SECONDS } from "../../src/game/stormSchedule";

/** Advance a schedule and collect every storm it produces. */
function run(seed: number, days: number) {
  const schedule = createStormSchedule(seed);
  const storms: { index: number; depthMm: number; day: number }[] = [];

  const step = DAY_SECONDS / 20;
  const ticks = Math.floor(days * 20);
  for (let i = 0; i < ticks; i++) {
    const due = schedule.tick(step);
    if (due) storms.push({ ...due, day: schedule.days });
  }
  return storms;
}

describe("createStormSchedule", () => {
  it("is reproducible from the seed", () => {
    expect(run(4242, 120)).toEqual(run(4242, 120));
  });

  it("gives different weather to different catchments", () => {
    expect(run(1, 120)).not.toEqual(run(2, 120));
  });

  it("leaves a grace period before the first storm", () => {
    const storms = run(20260809, 120);
    expect(storms.length).toBeGreaterThan(0);
    // Long enough to walk the catchment, read the map and plant something.
    expect(storms[0].day).toBeGreaterThan(3);
  });

  it("arrives repeatedly over a long session", () => {
    const storms = run(777, 200);
    expect(storms.length).toBeGreaterThan(15);
  });

  it("samples depths rather than repeating one design event", () => {
    const depths = run(31337, 400).map((storm) => storm.depthMm);
    expect(depths.length).toBeGreaterThan(20);

    // Nearly all distinct rather than exactly all: continuous samples do
    // occasionally collide at three decimal places, and the property under test
    // is "sampled from a distribution", not "no two values ever round alike".
    const unique = new Set(depths.map((d) => d.toFixed(3)));
    expect(unique.size).toBeGreaterThan(depths.length * 0.9);

    // Skewed: many modest events, a few large ones. That asymmetry is the whole
    // reason the schedule samples instead of firing the design storm on a timer.
    const sorted = [...depths].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(sorted[sorted.length - 1]).toBeGreaterThan(median * 1.4);
  });

  it("skips drizzle rather than playing a storm that moves nothing", () => {
    // Every storm that surfaces is worth the twenty-second playback.
    for (const storm of run(99, 400)) {
      expect(storm.depthMm).toBeGreaterThanOrEqual(14);
    }
  });

  it("can be deferred while one is already playing", () => {
    const schedule = createStormSchedule(20260809);

    // Run up to just before the first storm, then push it back.
    let first: ReturnType<typeof schedule.tick> = null;
    for (let i = 0; i < 200 && !first; i++) first = schedule.tick(DAY_SECONDS / 4);
    expect(first).not.toBeNull();

    schedule.defer(10);
    const dayAtDefer = schedule.days;

    let next: ReturnType<typeof schedule.tick> = null;
    for (let i = 0; i < 400 && !next; i++) next = schedule.tick(DAY_SECONDS / 4);
    expect(schedule.days - dayAtDefer).toBeGreaterThan(9);
  });
});
