/**
 * Village and fishery siting.
 *
 * The village is one of the game's two receptors and the thing a player most
 * expects to find, so "every catchment has one" is a guarantee, not a
 * tendency. It used to hold only while the valley floor had ground under 9
 * degrees near one fixed point on the trunk.
 */

import { describe, expect, it } from "vitest";
import type { GridSpec } from "../../src/core/grid";
import { chooseSites, COTTAGE_COUNT } from "../../src/terrain/sites";

const SPEC: GridSpec = { width: 48, height: 48, cellSize: 4 };
const CHANNEL_COL = 24;

/** A straight trunk up column 24, draining to an outlet on row 0. */
function trunkValley(slope: number) {
  const n = SPEC.width * SPEC.height;
  const downstream = new Int32Array(n).fill(-1);
  const d8Accum = new Float64Array(n).fill(1);
  const channelMask = new Uint8Array(n);
  const slopeDeg = new Float64Array(n).fill(slope);

  for (let row = 0; row < SPEC.height; row++) {
    const cell = row * SPEC.width + CHANNEL_COL;
    channelMask[cell] = 1;
    downstream[cell] = row === 0 ? -1 : cell - SPEC.width;
    d8Accum[cell] = SPEC.height - row;
  }
  return { outlet: CHANNEL_COL, downstream, d8Accum, slopeDeg, channelMask };
}

function site(slope: number) {
  const valley = trunkValley(slope);
  return {
    valley,
    sites: chooseSites(
      SPEC,
      valley.outlet,
      valley.downstream,
      valley.d8Accum,
      valley.slopeDeg,
      valley.channelMask,
    ),
  };
}

const rowOf = (cell: number): number => (cell / SPEC.width) | 0;
const colOf = (cell: number): number => cell % SPEC.width;

describe("chooseSites", () => {
  it("builds the whole village on gentle ground", () => {
    expect(site(3).sites.cottageCells).toHaveLength(COTTAGE_COUNT);
  });

  it("still builds the whole village where every slope is steep", () => {
    // 20 degrees everywhere: the old 9-degree rule found no plot at all.
    expect(site(20).sites.cottageCells).toHaveLength(COTTAGE_COUNT);
  });

  it("keeps cottages off the channel and its banks, apart, and clear of the green", () => {
    const { sites } = site(4);
    const cells = sites.cottageCells;

    for (const cell of cells) {
      // Off the channel and not beside it: the render ground there is a bed.
      expect(Math.abs(colOf(cell) - CHANNEL_COL)).toBeGreaterThan(1);
      // The green around the village centre stays open.
      const fromCentre = Math.max(
        Math.abs(rowOf(cell) - rowOf(sites.villageCell)),
        Math.abs(colOf(cell) - colOf(sites.villageCell)),
      );
      expect(fromCentre).toBeGreaterThan(1);
    }

    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const distance = Math.hypot(rowOf(cells[i]) - rowOf(cells[j]), colOf(cells[i]) - colOf(cells[j]));
        expect(distance).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("puts the village upstream of the fishery, and the fishery on the channel", () => {
    const { sites, valley } = site(4);
    expect(valley.channelMask[sites.fisheryCell]).toBe(1);
    expect(rowOf(sites.villageCell)).toBeGreaterThan(rowOf(sites.fisheryCell));
  });
});
