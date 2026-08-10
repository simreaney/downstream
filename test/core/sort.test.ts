/**
 * The radix sort must agree with a comparator sort exactly, because it replaces
 * one everywhere it matters. Ties may be ordered differently between the two —
 * neither is stable in a way the hydrology relies on — so the tests compare the
 * sorted *values*, and separately assert that the output is a permutation.
 */

import { describe, expect, it } from "vitest";
import { createRng } from "../../src/core/rng";
import { sortIndicesByValue, sortResolution } from "../../src/core/sort";
import { nanExtent } from "../../src/core/stats";

/**
 * Assert the ordering the sort actually promises: monotonic to within the key
 * resolution, and a true permutation of the input indices. Pairs closer together
 * than the resolution share a key and may swap, which no caller can observe —
 * see the module comment in src/core/sort.ts.
 */
function assertSortedBy(values: Float64Array, order: Int32Array, descending: boolean): void {
  expect(order).toHaveLength(values.length);

  const seen = new Uint8Array(values.length);
  for (const index of order) seen[index] = 1;
  expect(seen.every((v) => v === 1)).toBe(true);

  const { min, max } = nanExtent(values);
  const tolerance = sortResolution(min, max);

  for (let i = 1; i < order.length; i++) {
    const prev = values[order[i - 1]];
    const curr = values[order[i]];
    if (descending) expect(prev).toBeGreaterThanOrEqual(curr - tolerance);
    else expect(prev).toBeLessThanOrEqual(curr + tolerance);
  }
}

describe("sortIndicesByValue", () => {
  it("matches a comparator sort on 100k random values", () => {
    const rng = createRng(4242);
    const n = 100_000;
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = rng.range(-250, 1200);

    const ascending = sortIndicesByValue(values, false);
    assertSortedBy(values, ascending, false);

    // Values are equal to a comparator sort to within the key resolution.
    const reference = Array.from(values).sort((a, b) => a - b);
    const tolerance = sortResolution(-250, 1200);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(values[ascending[i]] - reference[i])).toBeLessThanOrEqual(tolerance);
    }
  });

  it("sorts descending", () => {
    const rng = createRng(7);
    const values = new Float64Array(5000);
    for (let i = 0; i < values.length; i++) values[i] = rng.gaussian() * 100;

    assertSortedBy(values, sortIndicesByValue(values, true), true);
  });

  it("resolves the fill epsilon exactly over a realistic catchment relief", () => {
    // The guarantee the hydrology depends on. Every flow-connected pair differs
    // by at least FILL_EPSILON (1e-6 m) after priority-flood, so as long as the
    // key resolution is finer than that across the catchment's full relief, the
    // sweep order is exactly right. Here: 300 m of relief with epsilon-separated
    // cells riding on top of it.
    const relief = 300;
    const epsilon = 1e-6;
    const n = 4000;

    const values = new Float64Array(n + 2);
    values[0] = 0;
    values[n + 1] = relief;
    for (let i = 0; i < n; i++) values[i + 1] = relief / 2 + i * epsilon;

    expect(sortResolution(0, relief)).toBeLessThan(epsilon);

    const order = sortIndicesByValue(values, false);
    expect(order[0]).toBe(0);
    expect(order[n + 1]).toBe(n + 1);
    for (let i = 0; i < n; i++) expect(order[i + 1]).toBe(i + 1);
  });

  it("handles constant and single-element input", () => {
    const constant = new Float64Array(64).fill(12.5);
    assertSortedBy(constant, sortIndicesByValue(constant, false), false);

    const single = Float64Array.from([3]);
    expect(Array.from(sortIndicesByValue(single, true))).toEqual([0]);
  });

  it("reuses caller-supplied buffers", () => {
    const values = Float64Array.from([3, 1, 2]);
    const out = new Int32Array(3);
    const scratch = new Int32Array(3);
    const keys = new Uint32Array(3);

    const result = sortIndicesByValue(values, false, out, scratch, keys);
    // Four passes swap an even number of times, so the result lands in `out`.
    expect(result).toBe(out);
    expect(Array.from(result)).toEqual([1, 2, 0]);
  });
});
