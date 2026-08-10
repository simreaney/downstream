/**
 * The heap drives priority-flood, where popping out of order silently produces a
 * DEM that still looks filled but routes water wrongly.
 */

import { describe, expect, it } from "vitest";
import { MinHeap } from "../../src/core/heap";
import { createRng } from "../../src/core/rng";

describe("MinHeap", () => {
  it("pops payloads in ascending key order", () => {
    const heap = new MinHeap(16);
    const pairs: [number, number][] = [
      [5.5, 105],
      [1.25, 101],
      [9, 109],
      [1.25, 102],
      [-3, 100],
    ];
    for (const [key, value] of pairs) heap.push(key, value);

    const keysOut: number[] = [];
    while (!heap.isEmpty) {
      keysOut.push(heap.peekKey());
      heap.pop();
    }
    expect(keysOut).toEqual([-3, 1.25, 1.25, 5.5, 9]);
  });

  it("matches a sorted reference on 20k random keys", () => {
    const rng = createRng(808);
    const n = 20_000;
    const heap = new MinHeap(n);
    const keys: number[] = [];

    for (let i = 0; i < n; i++) {
      const key = rng.range(-1000, 1000);
      keys.push(key);
      heap.push(key, i);
    }
    keys.sort((a, b) => a - b);

    for (let i = 0; i < n; i++) {
      expect(heap.peekKey()).toBeCloseTo(keys[i], 12);
      heap.pop();
    }
    expect(heap.isEmpty).toBe(true);
  });

  it("tracks size and clears", () => {
    const heap = new MinHeap(4);
    heap.push(1, 1);
    heap.push(2, 2);
    expect(heap.size).toBe(2);
    heap.clear();
    expect(heap.isEmpty).toBe(true);
    expect(Number.isNaN(heap.peekKey())).toBe(true);
    expect(heap.pop()).toBe(-1);
  });

  it("throws rather than reallocating past capacity in a hot path", () => {
    const heap = new MinHeap(2);
    heap.push(1, 1);
    heap.push(2, 2);
    expect(() => heap.push(3, 3)).toThrow(RangeError);
  });
});
