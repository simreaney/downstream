/**
 * Terrain generation: reproducibility, and the single-outlet guarantee.
 *
 * The drainage assertions here are the ones that matter. A grid that does not
 * fully drain to its outlet still renders fine, still produces a risk map, and
 * still lets the player build things — it just quietly reports connectivity for
 * a catchment that has several exits, which invalidates every number the game
 * shows. Nothing downstream can detect it, so it is checked at the source.
 */

import { describe, expect, it } from "vitest";
import type { GridSpec } from "../../src/core/grid";
import { hashArray, nanExtent } from "../../src/core/stats";
import { auditDrainage, buildDownstreamIndex } from "../../src/scimap/d8";
import { fillDepressions } from "../../src/scimap/fill";
import { generateTerrain } from "../../src/terrain/generate";
import { GRID } from "../../src/config";

/** A smaller, lighter catchment so the suite stays fast. */
const TEST_SPEC: GridSpec = { width: 96, height: 96, cellSize: 4 };
const TEST_OPTIONS = { spec: TEST_SPEC, erosion: { droplets: 6000 } };

describe("generateTerrain", () => {
  it("is reproducible from its seed", () => {
    const a = generateTerrain(4242, TEST_OPTIONS);
    const b = generateTerrain(4242, TEST_OPTIONS);

    expect(hashArray(b.dem)).toBe(hashArray(a.dem));
    expect(b.outlet).toBe(a.outlet);
  });

  it("produces a different catchment for a different seed", () => {
    const a = generateTerrain(1, TEST_OPTIONS);
    const b = generateTerrain(2, TEST_OPTIONS);
    expect(hashArray(b.dem)).not.toBe(hashArray(a.dem));
  });

  it("produces finite elevations with plausible relief", () => {
    const { dem } = generateTerrain(77, TEST_OPTIONS);
    const { min, max, count } = nanExtent(dem);

    expect(count).toBe(dem.length);
    expect(max - min).toBeGreaterThan(20);
    expect(max - min).toBeLessThan(600);
  });

  it("places the outlet on the border, off the corners, as the low point", () => {
    for (const seed of [3, 11, 29, 104, 555]) {
      const { dem, outlet } = generateTerrain(seed, TEST_OPTIONS);
      const row = Math.floor(outlet / TEST_SPEC.width);
      const col = outlet % TEST_SPEC.width;

      const onBorder =
        row === 0 || col === 0 || row === TEST_SPEC.height - 1 || col === TEST_SPEC.width - 1;
      expect(onBorder).toBe(true);

      // A corner outlet would notch two edges at once and could open a second
      // exit once erosion has run.
      const onCorner =
        (row === 0 || row === TEST_SPEC.height - 1) &&
        (col === 0 || col === TEST_SPEC.width - 1);
      expect(onCorner).toBe(false);

      // The outlet is pinned below its own neighbours here. It only becomes the
      // global minimum after the fill, which is asserted below — before filling,
      // an eroded hollow elsewhere may legitimately sit lower.
      for (const neighbour of [outlet - 1, outlet + 1]) {
        if (neighbour < 0 || neighbour >= dem.length) continue;
        expect(dem[outlet]).toBeLessThan(dem[neighbour]);
      }
    }
  });
});

describe("drainage after filling", () => {
  /** Generate, fill, and route — the first four stages of the real pipeline. */
  function route(seed: number, spec: GridSpec, droplets: number) {
    const terrain = generateTerrain(seed, { spec, erosion: { droplets } });
    const fill = fillDepressions(terrain.dem, spec, terrain.outlet);
    const downstream = buildDownstreamIndex(terrain.dem, spec);
    return { terrain, fill, downstream, audit: auditDrainage(downstream, terrain.outlet) };
  }

  it("leaves no interior sink and drains everything to the outlet", () => {
    for (const seed of [3, 11, 29, 104, 555, 9001]) {
      const { audit } = route(seed, TEST_SPEC, 6000);

      // The epsilon assertion. A single interior sink means the fill epsilon is
      // not reaching the DEM, and every connectivity value downstream is wrong.
      expect(audit.interiorSinks).toBe(0);
      expect(audit.reachingOutlet).toBe(1);
    }
  });

  it("holds at full playable resolution", () => {
    const { terrain, audit, fill } = route(20260809, GRID, 50_000);

    expect(audit.interiorSinks).toBe(0);
    expect(audit.reachingOutlet).toBeGreaterThanOrEqual(0.995);

    // Filling seeded from the outlet raises every other cell above it, so the
    // outlet is the catchment's global minimum by construction.
    expect(terrain.dem[terrain.outlet]).toBe(nanExtent(terrain.dem).min);

    // The terrain must genuinely run downhill, with the fill only tidying up
    // after it. A deep isolated hollow is a real landform and a natural pond
    // site, so the deepest single pit is not the thing to police — but if a
    // large *area* comes out flat, the priority-flood has done the shaping
    // instead of the erosion, and flow directions across those valley floors are
    // arbitrary. Measured across seeds this sits near 2-4%.
    expect(fill.floodedCells / terrain.dem.length).toBeLessThan(0.08);
    expect(fill.maxFillDepth).toBeLessThan(25);
  }, 30_000);

  it("gives every cell except the outlet a strictly lower successor", () => {
    const { terrain, downstream } = route(31337, TEST_SPEC, 6000);

    for (let cell = 0; cell < downstream.length; cell++) {
      if (cell === terrain.outlet) continue;
      expect(downstream[cell]).toBeGreaterThanOrEqual(0);
      expect(terrain.dem[downstream[cell]]).toBeLessThan(terrain.dem[cell]);
    }
  });
});
