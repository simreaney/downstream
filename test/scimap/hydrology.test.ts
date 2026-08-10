/**
 * The static hydrology layers: fill, slope, FD8 partitioning, accumulation and
 * channel extraction.
 *
 * Mass balance is the assertion that matters most. FD8 splits every cell's flow
 * eight ways and sums it downslope, so a partitioning bug — fractions that do
 * not sum to one, a neighbour written to the wrong index, a sweep order that
 * visits a cell before its inflow is complete — shows up as area appearing or
 * vanishing. Nothing else downstream can detect it: the risk map would simply be
 * wrong in a way that still looks like a risk map.
 */

import { describe, expect, it } from "vitest";
import type { GridSpec } from "../../src/core/grid";
import { nanExtent } from "../../src/core/stats";
import {
  FD8_MASS_TOLERANCE,
  accumulate,
  accumulatePair,
  buildFd8Table,
} from "../../src/scimap/fd8";
import { accumulateD8, buildDownstreamIndex } from "../../src/scimap/d8";
import { fillDepressions } from "../../src/scimap/fill";
import { computeDerivatives } from "../../src/scimap/slope";
import { countChannelAdjacent, extractChannelMask, traceStreams } from "../../src/scimap/streams";
import { channelThresholdCells } from "../../src/scimap/constants";
import { generateTerrain } from "../../src/terrain/generate";

const SPEC: GridSpec = { width: 96, height: 96, cellSize: 4 };

function buildCatchment(seed: number, spec = SPEC) {
  const terrain = generateTerrain(seed, { spec, erosion: { droplets: 6000 } });
  fillDepressions(terrain.dem, spec, terrain.outlet);
  const table = buildFd8Table(terrain.dem, spec);
  const accum = accumulate(table, spec);
  const downstream = buildDownstreamIndex(terrain.dem, spec);
  const d8Accum = accumulateD8(downstream, table.order);
  const threshold = channelThresholdCells(spec.cellSize);
  return { terrain, spec, table, accum, downstream, d8Accum, threshold };
}

describe("computeDerivatives", () => {
  it("returns slope in degrees, matching a known plane", () => {
    // A 45-degree plane: one cell of rise per cell of run.
    const spec: GridSpec = { width: 8, height: 8, cellSize: 4 };
    const dem = new Float64Array(64);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) dem[row * 8 + col] = col * 4;
    }

    const { slopeDeg, curvature } = computeDerivatives(dem, spec);
    const centre = 3 * 8 + 3;
    expect(slopeDeg[centre]).toBeCloseTo(45, 6);
    // A plane has no curvature.
    expect(curvature[centre]).toBeCloseTo(0, 9);
  });

  it("reports a flat surface as zero slope", () => {
    const spec: GridSpec = { width: 8, height: 8, cellSize: 4 };
    const { slopeDeg } = computeDerivatives(new Float64Array(64).fill(17), spec);
    expect(Array.from(slopeDeg).every((s) => s === 0)).toBe(true);
  });

  it("signs curvature negative in a hollow and positive on a nose", () => {
    const spec: GridSpec = { width: 9, height: 9, cellSize: 4 };
    const bowl = new Float64Array(81);
    const dome = new Float64Array(81);

    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const dr = row - 4;
        const dc = col - 4;
        const r2 = dr * dr + dc * dc;
        bowl[row * 9 + col] = r2 * 0.5;
        dome[row * 9 + col] = -r2 * 0.5;
      }
    }

    const centre = 4 * 9 + 4;
    expect(computeDerivatives(bowl, spec).curvature[centre]).toBeLessThan(0);
    expect(computeDerivatives(dome, spec).curvature[centre]).toBeGreaterThan(0);
  });

  it("keeps slope inside [0, 90] on real terrain", () => {
    const { terrain } = buildCatchment(31337);
    const { slopeDeg } = computeDerivatives(terrain.dem, SPEC);
    const { min, max, count } = nanExtent(slopeDeg);

    expect(count).toBe(slopeDeg.length);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(90);
  });
});

describe("buildFd8Table", () => {
  it("gives every cell fractions summing to one, or to zero at a terminus", () => {
    const { terrain, table } = buildCatchment(11);

    for (let cell = 0; cell < terrain.dem.length; cell++) {
      let sum = 0;
      for (let k = 0; k < 8; k++) sum += table.fractions[cell * 8 + k];

      if (cell === terrain.outlet) {
        // The outlet is the global minimum, so nothing leaves it.
        expect(sum).toBe(0);
      } else {
        expect(sum).toBeCloseTo(1, 5);
      }
    }
  });

  it("orders the sweep so a cell is never visited before its inflow", () => {
    const { terrain, table } = buildCatchment(29);
    const position = new Int32Array(terrain.dem.length);
    for (let i = 0; i < table.order.length; i++) position[table.order[i]] = i;

    // Descending elevation order is a topological order of the flow graph,
    // because after an epsilon fill every downslope neighbour is strictly lower.
    for (let cell = 0; cell < terrain.dem.length; cell++) {
      for (let k = 0; k < 8; k++) {
        if (table.fractions[cell * 8 + k] === 0) continue;
        const row = Math.floor(cell / SPEC.width) + [-1, -1, 0, 1, 1, 1, 0, -1][k];
        const col = (cell % SPEC.width) + [0, 1, 1, 1, 0, -1, -1, -1][k];
        const neighbour = row * SPEC.width + col;
        expect(position[cell]).toBeLessThan(position[neighbour]);
      }
    }
  });
});

describe("accumulate", () => {
  it("conserves mass: the outlet receives the whole catchment", () => {
    const { terrain, accum } = buildCatchment(104);
    const n = terrain.dem.length;

    // Every cell contributes itself plus everything upslope, and the only exit
    // is the outlet, so it must carry all n cells — to within the Float32
    // fraction-table tolerance documented on FD8_MASS_TOLERANCE.
    expect(Math.abs(accum[terrain.outlet] - n) / n).toBeLessThan(FD8_MASS_TOLERANCE);
  });

  it("conserves a weighted payload too", () => {
    const { terrain, table, spec } = buildCatchment(555);
    const weights = new Float64Array(terrain.dem.length);
    for (let i = 0; i < weights.length; i++) weights[i] = (i % 7) * 0.5;

    let total = 0;
    for (const w of weights) total += w;

    const routed = accumulate(table, spec, weights);
    expect(Math.abs(routed[terrain.outlet] - total) / total).toBeLessThan(FD8_MASS_TOLERANCE);
  });

  it("gives every cell at least its own contribution", () => {
    const { accum } = buildCatchment(3);
    expect(Array.from(accum).every((a) => a >= 1 - 1e-9)).toBe(true);
  });

  it("accumulatePair matches two separate accumulations exactly", () => {
    const { terrain, table, spec } = buildCatchment(9001);
    const n = terrain.dem.length;

    const a = new Float64Array(n);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = (i % 5) * 0.25;
      b[i] = 1 + (i % 3);
    }

    const separateA = accumulate(table, spec, a);
    const separateB = accumulate(table, spec, b);

    const pairA = new Float64Array(n);
    const pairB = new Float64Array(n);
    accumulatePair(table, spec, a, b, pairA, pairB);

    for (let i = 0; i < n; i++) {
      expect(pairA[i]).toBe(separateA[i]);
      expect(pairB[i]).toBe(separateB[i]);
    }
  });
});

describe("channel extraction", () => {
  it("produces a network connected all the way to the outlet", () => {
    const { terrain, downstream, d8Accum, threshold } = buildCatchment(20260809);
    const mask = extractChannelMask(d8Accum, threshold);

    expect(mask[terrain.outlet]).toBe(1);

    let channelCells = 0;
    for (const flag of mask) channelCells += flag;

    // A plausible drainage density: a real network occupies a small but not
    // negligible share of the catchment.
    const fraction = channelCells / mask.length;
    expect(fraction).toBeGreaterThan(0.01);
    expect(fraction).toBeLessThan(0.2);

    // Connectivity is the property that thresholding alone does not give,
    // because FD8 accumulation can fall along a D8 path. Every channel cell must
    // drain into another channel cell, or be the outlet.
    for (let cell = 0; cell < mask.length; cell++) {
      if (!mask[cell] || cell === terrain.outlet) continue;
      expect(mask[downstream[cell]]).toBe(1);
    }
  });

  it("is connected by construction, because D8 area never falls downstream", () => {
    // This is the invariant that lets extractChannelMask be a bare threshold.
    // FD8 area does not have it — asserted alongside, so the two are not
    // silently swapped at a call site later.
    const { downstream, accum, d8Accum } = buildCatchment(20260809);

    let fd8Drops = 0;
    for (let cell = 0; cell < d8Accum.length; cell++) {
      const next = downstream[cell];
      if (next < 0) continue;
      expect(d8Accum[next]).toBeGreaterThanOrEqual(d8Accum[cell]);
      if (accum[next] < accum[cell]) fd8Drops++;
    }

    expect(fd8Drops).toBeGreaterThan(0);
  });

  it("traces polylines covering every channel cell", () => {
    const { downstream, d8Accum, threshold } = buildCatchment(4242);
    const mask = extractChannelMask(d8Accum, threshold);
    const polylines = traceStreams(mask, downstream, d8Accum);

    expect(polylines.length).toBeGreaterThan(0);

    const covered = new Uint8Array(mask.length);
    for (const line of polylines) {
      expect(line.cells.length).toBeGreaterThanOrEqual(2);
      for (const cell of line.cells) {
        expect(mask[cell]).toBe(1);
        covered[cell] = 1;
      }
      // Contributing area is NOT monotonic downstream — FD8 spreads flow while
      // the traced path follows single-direction D8, so a reach can shed area to
      // a neighbour it does not follow. The river mesh smooths width along the
      // reach for that reason. All that is asserted here is that the values are
      // real areas.
      for (const area of line.accum) expect(area).toBeGreaterThan(0);
    }

    for (let cell = 0; cell < mask.length; cell++) {
      if (mask[cell]) expect(covered[cell]).toBe(1);
    }
  });

  it("counts a riparian edge of plausible size", () => {
    const { d8Accum, threshold } = buildCatchment(777);
    const mask = extractChannelMask(d8Accum, threshold);
    const adjacent = countChannelAdjacent(mask, SPEC);

    let channelCells = 0;
    for (const flag of mask) channelCells += flag;

    // The bank is a fringe around the network, so it is the same order of
    // magnitude as the network itself.
    expect(adjacent).toBeGreaterThan(channelCells * 0.5);
    expect(adjacent).toBeLessThan(channelCells * 6);
  });
});
