/**
 * The shading fields baked from the terrain.
 *
 * Unlike the rest of the render layer, this one *is* checkable against arrays:
 * it is a pure function of the DEM and the accumulation grid, and the picture it
 * produces is only as good as the numbers underneath. The cases that matter are
 * the ones where being subtly wrong still looks plausible — an openness field
 * that is upside down shades ridges instead of hollows and reads, at a glance,
 * merely like a different art direction.
 */

import { describe, expect, it } from "vitest";
import type { GridSpec } from "../../src/core/grid";
import { bakeTerrainData } from "../../src/render/terrainData";
import { channelThresholdCells } from "../../src/scimap/constants";

const SPEC: GridSpec = { width: 64, height: 64, cellSize: 4 };
const CELLS = SPEC.width * SPEC.height;

const cellAt = (col: number, row: number): number => row * SPEC.width + col;

/** Openness, read back out of the red channel as 0..1. */
function opennessAt(data: Uint8Array, col: number, row: number): number {
  return data[cellAt(col, row) * 4] / 255;
}

/** Wetness, read back out of the green channel as 0..1. */
function wetnessAt(data: Uint8Array, col: number, row: number): number {
  return data[cellAt(col, row) * 4 + 1] / 255;
}

function bake(dem: Float32Array, accum = new Float32Array(CELLS).fill(1)): Uint8Array {
  const baked = bakeTerrainData(dem, accum, SPEC);
  return baked.texture.image.data as Uint8Array;
}

describe("bakeTerrainData", () => {
  it("leaves flat ground fully open", () => {
    const data = bake(new Float32Array(CELLS).fill(20));
    expect(opennessAt(data, 32, 32)).toBe(1);
  });

  it("shades a hollow and leaves the ridge above it alone", () => {
    // A valley running north-south: elevation rises with distance from the
    // middle column, so column 32 is the floor and the edges are the divides.
    const dem = new Float32Array(CELLS);
    for (let row = 0; row < SPEC.height; row++) {
      for (let col = 0; col < SPEC.width; col++) {
        dem[cellAt(col, row)] = Math.abs(col - 32) * 3;
      }
    }

    const data = bake(dem);
    const floor = opennessAt(data, 32, 32);
    const side = opennessAt(data, 24, 32);
    const divide = opennessAt(data, 2, 32);

    expect(floor).toBeLessThan(side);
    expect(side).toBeLessThan(divide);
    // The point of the field is that the difference survives being written to
    // eight bits and stretched — a valley floor that comes back a shade under
    // its own divide is one the player cannot see.
    expect(divide - floor).toBeGreaterThan(0.25);
  });

  it("does not occlude the catchment edge against its own border", () => {
    // Off the grid is open sky. Clamping to the edge cell instead would ring the
    // whole map in false shade, which reads as a vignette nobody drew.
    const data = bake(new Float32Array(CELLS).fill(20));
    expect(opennessAt(data, 0, 0)).toBe(1);
    expect(opennessAt(data, SPEC.width - 1, SPEC.height - 1)).toBe(1);
  });

  it("ramps wetness from dry hillslope to the channel threshold", () => {
    const dem = new Float32Array(CELLS).fill(20);
    const accum = new Float32Array(CELLS).fill(1);

    const threshold = channelThresholdCells(SPEC.cellSize);
    accum[cellAt(10, 10)] = 1; // a hilltop, draining only itself
    accum[cellAt(20, 20)] = threshold / 4; // a hollow gathering a few fields
    accum[cellAt(30, 30)] = threshold; // a channel head
    accum[cellAt(40, 40)] = threshold * 50; // the trunk

    const data = bake(dem, accum);

    expect(wetnessAt(data, 10, 10)).toBe(0);
    expect(wetnessAt(data, 20, 20)).toBeGreaterThan(0);
    expect(wetnessAt(data, 20, 20)).toBeLessThan(1);
    expect(wetnessAt(data, 30, 30)).toBe(1);
    // Clamped, not wrapped: the trunk carries fifty times the channel threshold
    // and must not come back as dry ground.
    expect(wetnessAt(data, 40, 40)).toBe(1);
  });
});
