/**
 * Worker handlers, exercised without a worker environment.
 *
 * The overlay is the only thing the player ever actually sees of the model, so
 * these check that it tracks the layer it claims to and responds to
 * interventions — a stale or mislabelled overlay would make every other
 * guarantee in the project invisible.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { CELL_COUNT } from "../../src/config";
import {
  handleGenerate,
  handleRecompute,
  handleRelease,
  handleSetLayer,
  resetWorkerState,
} from "../../src/worker/handlers";
import { LAYER_STYLE } from "../../src/worker/overlayPack";
import { buildLut, MAGMA, VIRIDIS } from "../../src/worker/ramps";
import { LandCover } from "../../src/scimap/constants";
import { isWorthPlanting, plantingDelta } from "../../src/scimap/landcover";
import { createWorld } from "../../src/world";

describe("ramps", () => {
  it("expands stops to a monotonic 256-entry lookup", () => {
    for (const stops of [MAGMA, VIRIDIS]) {
      const lut = buildLut(stops);
      expect(lut.length).toBe(768);

      // Endpoints land exactly on the first and last stop.
      expect([lut[0], lut[1], lut[2]]).toEqual([...stops[0]]);
      expect([lut[765], lut[766], lut[767]]).toEqual([...stops[stops.length - 1]]);

      // Perceptual ramps must climb in luminance, or the eye reads the turns as
      // features in the data.
      const luminance = (i: number) =>
        0.2126 * lut[i * 3] + 0.7152 * lut[i * 3 + 1] + 0.0722 * lut[i * 3 + 2];
      expect(luminance(255)).toBeGreaterThan(luminance(0));
      for (let i = 8; i < 256; i += 8) {
        expect(luminance(i)).toBeGreaterThan(luminance(i - 8) - 12);
      }
    }
  });
});

describe("worker handlers", () => {
  // The handlers keep their arrays private, so the test rebuilds the same
  // deterministic catchment to find out what is where.
  const reference = createWorld(20260809);
  const landCoverOf = (cell: number) => reference.arrays.landCover[cell];

  beforeEach(() => {
    resetWorkerState();
  });

  it("refuses to recompute before a catchment exists", () => {
    expect(() => handleRecompute("sourceRisk", [], [])).toThrow(/generated/);
  });

  it("generates a catchment with a packed overlay and traced reaches", () => {
    const result = handleGenerate(20260809, "sourceRisk");

    expect(result.overlay.byteLength).toBe(CELL_COUNT * 4);
    expect(result.reaches.length).toBeGreaterThan(10);
    expect(result.metrics.meanSourceRisk).toBeGreaterThan(0);
    expect(result.metrics.woodlandFraction).toBeGreaterThan(0);

    // Fully opaque everywhere, because source risk covers the whole catchment.
    const rgba = new Uint8Array(result.overlay);
    for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(255);
  }, 60_000);

  it("masks in-channel risk to the river and leaves the hillslopes clear", () => {
    handleGenerate(20260809, "sourceRisk");
    expect(LAYER_STYLE.inChannel.channelOnly).toBe(true);

    const overlay = new Uint8Array(handleSetLayer("inChannel"));
    let opaque = 0;
    for (let i = 3; i < overlay.length; i += 4) if (overlay[i] === 255) opaque++;

    // The river is a small fraction of the catchment, not none of it.
    expect(opaque).toBeGreaterThan(100);
    expect(opaque / CELL_COUNT).toBeLessThan(0.15);
  }, 60_000);

  it("clears the overlay for the 'none' layer", () => {
    handleGenerate(20260809, "sourceRisk");
    const overlay = new Uint8Array(handleSetLayer("none"));
    expect(overlay.every((byte) => byte === 0)).toBe(true);
  }, 60_000);

  it("moves the overlay and the metrics when arable is planted", () => {
    const generated = handleGenerate(20260809, "sourceRisk");
    const before = generated.metrics;

    // Plant arable specifically. Blanket-planting whatever happens to be in the
    // first N cells does not reliably improve anything, because woodland (0.2)
    // is *more* erodible than extensive grassland (0.15) in this weight table —
    // see EROSION_WEIGHTS. Arable at 1.0 is the unambiguous case, and the one
    // the player is actually being pointed at.
    const edits = [];
    for (let cell = 0; cell < CELL_COUNT && edits.length < 2000; cell++) {
      if (landCoverOf(cell) === LandCover.Arable) {
        edits.push({ cell, cover: LandCover.Woodland });
      }
    }
    expect(edits.length).toBeGreaterThan(500);

    const after = handleRecompute("sourceRisk", [], edits);
    expect(after.metrics.meanSourceRisk).toBeLessThan(before.meanSourceRisk);
    expect(after.metrics.woodlandFraction).toBeGreaterThan(before.woodlandFraction);
    expect(after.reachRisk.length).toBeGreaterThan(0);
  }, 60_000);

  it("reports which way planting moves the source term, in both directions", () => {
    // Pinning the quirk rather than hiding it: the shipped weight table really
    // does make woodland more erodible than extensive grassland. The game
    // reports the direction and allows the change either way.
    expect(isWorthPlanting(LandCover.Arable)).toBe(true);
    expect(isWorthPlanting(LandCover.ImprovedGrassland)).toBe(true);
    expect(isWorthPlanting(LandCover.ExtensiveGrassland)).toBe(false);

    expect(plantingDelta(LandCover.Arable)).toBeLessThan(0);
    expect(plantingDelta(LandCover.ExtensiveGrassland)).toBeGreaterThan(0);
    expect(plantingDelta(LandCover.Woodland)).toBe(0);
  });

  it("reuses released buffers rather than allocating per placement", () => {
    const generated = handleGenerate(20260809, "sourceRisk");
    handleRelease([generated.overlay]);

    const next = handleRecompute("sourceRisk", [], []);
    expect(next.overlay).toBe(generated.overlay);
  }, 60_000);
});
