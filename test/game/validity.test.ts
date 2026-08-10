/**
 * Placement rules and the riparian buffer model.
 *
 * The buffer test is the important one. Its whole purpose is that a *continuous
 * band* reaching a watercourse breaks connectivity while the same number of
 * scattered trees does not — which is the single most useful thing the game
 * teaches, and a property no other part of the code would notice losing.
 */

import { describe, expect, it } from "vitest";
import type { GridSpec } from "../../src/core/grid";
import { LandCover } from "../../src/scimap/constants";
import { BUFFER_INTERCEPT_PER_CELL, computeBufferBreaks } from "../../src/scimap/buffer";
import { checkLeakyDam, checkPond, checkTree, type PlacementContext } from "../../src/game/validity";
import type { MainThreadArrays } from "../../src/worker/client";

const SPEC: GridSpec = { width: 32, height: 32, cellSize: 4 };
const N = SPEC.width * SPEC.height;

function arrays(overrides: Partial<Record<keyof MainThreadArrays, unknown>> = {}): MainThreadArrays {
  return {
    dem: new Float32Array(N),
    slopeDeg: new Float32Array(N).fill(2),
    curvature: new Float32Array(N).fill(-0.01),
    accum: new Float32Array(N).fill(100),
    channelMask: new Uint8Array(N),
    landCover: new Uint8Array(N).fill(LandCover.Arable),
    ...overrides,
  } as MainThreadArrays;
}

function context(overrides: Partial<PlacementContext> = {}): PlacementContext {
  return {
    arrays: arrays(),
    spec: SPEC,
    wood: 50,
    stone: 50,
    hasSpade: true,
    occupied: new Set<number>(),
    interventions: [],
    ...overrides,
  };
}

describe("pond placement", () => {
  it("accepts a gentle, connected hollow off the channel", () => {
    expect(checkPond(context(), 500).ok).toBe(true);
  });

  it("needs the spade, whatever else is true", () => {
    expect(checkPond(context({ hasSpade: false }), 500).reason).toBe("needSpade");
  });

  it("refuses the watercourse, and says why", () => {
    const channelMask = new Uint8Array(N);
    channelMask[500] = 1;
    const check = checkPond(context({ arrays: arrays({ channelMask }) }), 500);
    expect(check.reason).toBe("inChannel");
    expect(check.message).toMatch(/fish passage/);
  });

  it("refuses a ridge, where nothing drains through", () => {
    const accum = new Float32Array(N).fill(2);
    expect(checkPond(context({ arrays: arrays({ accum }) }), 500).reason).toBe("tooLittleUpslope");
  });

  it("refuses a convex nose, which sheds water instead of holding it", () => {
    const curvature = new Float32Array(N).fill(0.05);
    expect(checkPond(context({ arrays: arrays({ curvature }) }), 500).reason).toBe("notAHollow");
  });

  it("refuses ground too steep to impound water", () => {
    const slopeDeg = new Float32Array(N).fill(12);
    expect(checkPond(context({ arrays: arrays({ slopeDeg }) }), 500).reason).toBe("tooSteep");
  });

  it("reports the area it would intercept", () => {
    // 100 cells of 16 m² each.
    expect(checkPond(context(), 500).interceptedAreaM2).toBeCloseTo(1600, 6);
  });
});

describe("leaky dam placement", () => {
  const inChannel = (): MainThreadArrays => {
    const channelMask = new Uint8Array(N);
    channelMask[500] = 1;
    const accum = new Float32Array(N).fill(1500);
    return arrays({ channelMask, accum });
  };

  it("accepts a low-order channel reach", () => {
    expect(checkLeakyDam(context({ arrays: inChannel() }), 500).ok).toBe(true);
  });

  it("refuses dry land", () => {
    expect(checkLeakyDam(context(), 500).reason).toBe("notInChannel");
  });

  it("refuses a reach large enough to wash the barrier out", () => {
    const channelMask = new Uint8Array(N);
    channelMask[500] = 1;
    const accum = new Float32Array(N).fill(50_000);
    const check = checkLeakyDam(context({ arrays: arrays({ channelMask, accum }) }), 500);
    expect(check.reason).toBe("channelTooLarge");
  });

  it("enforces spacing between dams", () => {
    const check = checkLeakyDam(
      context({
        arrays: inChannel(),
        interventions: [{ kind: "dam", id: 1, cell: 500 + SPEC.width * 2, at: 0 }],
      }),
      500,
    );
    expect(check.reason).toBe("tooCloseToDam");
  });
});

describe("tree placement", () => {
  it("is permissive, because where it helps is the player's judgement", () => {
    const landCover = new Uint8Array(N).fill(LandCover.ExtensiveGrassland);
    // Legal even though this cover is one the model says is not worth planting.
    expect(checkTree(context({ arrays: arrays({ landCover }) }), 500).ok).toBe(true);
  });

  it("refuses ground that is already wooded", () => {
    const landCover = new Uint8Array(N).fill(LandCover.Woodland);
    expect(checkTree(context({ arrays: arrays({ landCover }) }), 500).reason).toBe("alreadyWooded");
  });

  it("refuses without wood in hand", () => {
    expect(checkTree(context({ wood: 0 }), 500).reason).toBe("needWood");
  });
});

describe("riparian buffer", () => {
  /**
   * A single column draining down to a channel at the bottom, so buffer width
   * along the flow path is exactly the number of woodland cells in the run.
   */
  function column(woodlandRows: number[]) {
    const landCover = new Uint8Array(N).fill(LandCover.Arable);
    const channelMask = new Uint8Array(N);
    const downstream = new Int32Array(N).fill(-1);
    const accum = new Float64Array(N).fill(200);

    const col = 8;
    for (let row = 0; row < SPEC.height - 1; row++) {
      downstream[row * SPEC.width + col] = (row + 1) * SPEC.width + col;
    }
    channelMask[(SPEC.height - 1) * SPEC.width + col] = 1;
    for (const row of woodlandRows) landCover[row * SPEC.width + col] = LandCover.Woodland;

    return { landCover, channelMask, downstream, accum, col };
  }

  it("credits a contiguous band by its width, with diminishing returns", () => {
    // The band must actually reach the channel at row 31. A band stopping one
    // row short is not a buffer, and the model is right to say so.
    const three = column([28, 29, 30]);
    const breaks = computeBufferBreaks(
      three.landCover,
      three.downstream,
      three.channelMask,
      three.accum,
    );

    const topCell = 28 * SPEC.width + three.col;
    const top = breaks.find((b) => b.cell === topCell);
    expect(top).toBeDefined();

    // Three cells of buffer: 1 - 0.75^3 = 0.578 of the through-flow.
    const expected = (1 - Math.pow(1 - BUFFER_INTERCEPT_PER_CELL, 3)) * 200;
    expect(top!.capacityCells).toBeCloseTo(expected, 6);
  });

  it("gives scattered trees far less than the same number in a band", () => {
    const band = column([28, 29, 30]);
    const scattered = column([10, 20, 30]);

    const sum = (c: ReturnType<typeof column>): number =>
      computeBufferBreaks(c.landCover, c.downstream, c.channelMask, c.accum).reduce(
        (total, b) => total + b.capacityCells,
        0,
      );

    // This is the lesson, asserted: continuity beats count.
    expect(sum(band)).toBeGreaterThan(sum(scattered) * 1.5);
  });

  it("ignores woodland that does not route to a watercourse", () => {
    // Same band as above, but with the flow path cut below it, so nothing it
    // intercepts reaches a channel — a copse on an interfluve is not a buffer.
    const c = column([28, 29, 30]);
    c.downstream[30 * SPEC.width + c.col] = -1;

    const breaks = computeBufferBreaks(c.landCover, c.downstream, c.channelMask, c.accum);
    expect(breaks).toHaveLength(0);
  });
});
