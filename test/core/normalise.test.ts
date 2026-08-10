/**
 * The frozen-bounds property, stated as a test.
 *
 * The last case here is the whole reason the game normalises the way it does:
 * under live percentiles, improving the worst cells makes untouched cells look
 * worse. If that assertion ever flips, the feedback loop is broken.
 */

import { describe, expect, it } from "vitest";
import { applyStretch, deriveBounds } from "../../src/core/normalise";

describe("deriveBounds", () => {
  it("returns the 5th and 95th percentiles", () => {
    const values = new Float64Array(101);
    for (let i = 0; i < 101; i++) values[i] = i;
    expect(deriveBounds(values)).toEqual([5, 95]);
  });

  it("widens a degenerate span rather than returning a zero divisor", () => {
    const [lo, hi] = deriveBounds(new Float64Array(50).fill(3));
    expect(lo).toBe(3);
    expect(hi).toBe(4);
  });

  it("falls back to [0, 1] when nothing is finite", () => {
    expect(deriveBounds(new Float64Array(10).fill(NaN))).toEqual([0, 1]);
  });
});

describe("applyStretch", () => {
  it("maps the bounds to 0 and 1 and clips outside them", () => {
    const values = Float64Array.from([-10, 0, 5, 10, 20]);
    const out = new Float64Array(5);
    applyStretch(values, [0, 10], out);
    expect(Array.from(out)).toEqual([0, 0, 0.5, 1, 1]);
  });

  it("propagates NaN and mask exclusions rather than emitting a real zero", () => {
    const values = Float64Array.from([1, NaN, 3]);
    const mask = Uint8Array.from([1, 1, 0]);
    const out = new Float64Array(3);
    applyStretch(values, [0, 4], out, mask);

    expect(out[0]).toBe(0.25);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(Number.isNaN(out[2])).toBe(true);
  });

  it("can write in place", () => {
    const values = Float64Array.from([2, 4, 6]);
    applyStretch(values, [2, 6], values);
    expect(Array.from(values)).toEqual([0, 0.5, 1]);
  });

  it("keeps untouched cells fixed when bounds are frozen", () => {
    // Baseline catchment: one very bad cell, the rest moderate.
    const baseline = Float64Array.from([0.1, 0.2, 0.3, 0.4, 10.0]);
    const bounds = deriveBounds(baseline);

    const before = new Float64Array(5);
    applyStretch(baseline, bounds, before);

    // The player remediates the worst cell. Nothing else changed.
    const after = Float64Array.from([0.1, 0.2, 0.3, 0.4, 0.0]);
    const afterStretched = new Float64Array(5);
    applyStretch(after, bounds, afterStretched);

    // Frozen bounds: the improved cell falls, everything else is untouched.
    expect(afterStretched[4]).toBeLessThan(before[4]);
    for (let i = 0; i < 4; i++) expect(afterStretched[i]).toBe(before[i]);

    // Live bounds: the same improvement pushes untouched cells UP, which is the
    // documented relative-product behaviour and the thing the game cannot use.
    const live = new Float64Array(5);
    applyStretch(after, deriveBounds(after), live);
    expect(live[3]).toBeGreaterThan(before[3]);
  });
});
