/**
 * The gamepad stick's radial deadzone.
 *
 * `createInput` itself reaches for `window` and `navigator.getGamepads()`, so
 * it is DOM glue rather than logic — exercised in the browser, not here. What
 * is worth pinning down in isolation is the rescale math: get it wrong and a
 * stick either dead-strips its outer travel (never reaching full speed) or
 * keeps drifting the player near centre (never truly at rest).
 */

import { describe, expect, it } from "vitest";
import { applyDeadzone } from "../../src/player/input";

describe("applyDeadzone", () => {
  it("zeroes a stick resting within the deadzone", () => {
    expect(applyDeadzone(0, 0)).toEqual([0, 0]);
    expect(applyDeadzone(0.1, 0.05)).toEqual([0, 0]);
  });

  it("passes full deflection through unchanged", () => {
    const [x, y] = applyDeadzone(1, 0);
    expect(x).toBeCloseTo(1, 5);
    expect(y).toBeCloseTo(0, 5);
  });

  it("rescales just past the deadzone edge to just above zero, not a jump", () => {
    const [x] = applyDeadzone(0.151, 0);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.05);
  });

  it("preserves direction for a diagonal push", () => {
    const [x, y] = applyDeadzone(0.6, 0.6);
    expect(x).toBeCloseTo(y, 10);
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(1);
  });
});
