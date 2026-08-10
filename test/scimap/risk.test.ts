/**
 * The risk core: TWI, the Network Index, and the products built on them.
 *
 * The Network Index is checked three ways, because it is the piece most likely
 * to be subtly wrong while looking entirely reasonable. It is verified against a
 * brute-force walk of the recurrence on random graphs, against a direct port of
 * the reference's pointer-doubling solver on real terrain, and for the
 * structural properties it must have (a break caps everything upslope of it).
 */

import { describe, expect, it } from "vitest";
import { GRID } from "../../src/config";
import type { GridSpec } from "../../src/core/grid";
import { cellAreaM2 } from "../../src/core/grid";
import { createRng } from "../../src/core/rng";
import { nanMean } from "../../src/core/stats";
import { deriveBounds } from "../../src/core/normalise";
import { channelThresholdCells } from "../../src/scimap/constants";
import { accumulateD8, buildDownstreamIndex } from "../../src/scimap/d8";
import {
  computeErosionRisk,
  computeSourceRisk,
  deriveErosionBounds,
  normaliseErosion,
} from "../../src/scimap/erosion";
import { accumulate, buildFd8Table } from "../../src/scimap/fd8";
import { fillDepressions } from "../../src/scimap/fill";
import {
  computeInChannelRisk,
  createInChannelScratch,
} from "../../src/scimap/inChannel";
import {
  deriveConnectivityBounds,
  networkIndexSweep,
  normaliseConnectivity,
} from "../../src/scimap/networkIndex";
import { generateRainfall, scaleRainfall } from "../../src/scimap/rainfall";
import { computeDerivatives } from "../../src/scimap/slope";
import { extractChannelMask } from "../../src/scimap/streams";
import { applyConnectivityBreaks, computeTwi, storageBreakTwi } from "../../src/scimap/twi";
import { generateTerrain } from "../../src/terrain/generate";

const SPEC: GridSpec = { width: 96, height: 96, cellSize: 4 };

/** Everything the risk layers need, built once per seed. */
function buildCatchment(seed: number, spec = SPEC) {
  const terrain = generateTerrain(seed, { spec, erosion: { droplets: 6000 } });
  fillDepressions(terrain.dem, spec, terrain.outlet);

  const { slopeDeg, curvature } = computeDerivatives(terrain.dem, spec);
  const table = buildFd8Table(terrain.dem, spec);
  const accum = accumulate(table, spec);
  const downstream = buildDownstreamIndex(terrain.dem, spec);
  const d8Accum = accumulateD8(downstream, table.order);
  const channelMask = extractChannelMask(d8Accum, channelThresholdCells(spec.cellSize));

  const rain = scaleRainfall(generateRainfall(terrain.dem));
  const twi = computeTwi(accum, slopeDeg, rain);

  return {
    terrain,
    spec,
    slopeDeg,
    curvature,
    table,
    accum,
    downstream,
    channelMask,
    rain,
    twi,
  };
}

/**
 * The recurrence, unrolled literally: walk downstream taking the running
 * minimum, stopping at and including the first channel cell.
 */
function bruteForceNetworkIndex(
  twi: Float64Array,
  downstream: Int32Array,
  channelMask: Uint8Array,
  start: number,
): number {
  let value = twi[start];
  let cell = start;

  for (let step = 0; step <= twi.length; step++) {
    const next = downstream[cell];
    if (next < 0) break;
    const candidate = twi[next];
    if (Number.isFinite(candidate) && candidate < value) value = candidate;
    if (channelMask[next]) break;
    cell = next;
  }
  return value;
}

/**
 * Direct port of the reference implementation's pointer-doubling solver, kept
 * here purely as an independent oracle. If the linear sweep ever disagrees with
 * this on real terrain, the sweep's correctness argument has been broken.
 */
function pointerDoublingNetworkIndex(
  twi: Float64Array,
  downstream: Int32Array,
  channelMask: Uint8Array,
): Float64Array {
  const n = twi.length;
  let val = new Float64Array(n).fill(NaN);
  let nxt = new Int32Array(n).fill(-1);
  let done = new Uint8Array(n);

  for (let cell = 0; cell < n; cell++) {
    let value = twi[cell];
    const next = downstream[cell];
    if (next < 0) {
      val[cell] = value;
      done[cell] = 1;
    } else if (channelMask[next]) {
      const candidate = twi[next];
      if (Number.isFinite(candidate) && candidate < value) value = candidate;
      val[cell] = value;
      done[cell] = 1;
    } else {
      val[cell] = value;
      nxt[cell] = next;
    }
  }

  const maxRounds = Math.max(1, Math.ceil(Math.log2(Math.max(n, 2))) + 2);
  for (let round = 0; round < maxRounds; round++) {
    let anyActive = false;
    for (let i = 0; i < n; i++) {
      if (!done[i]) {
        anyActive = true;
        break;
      }
    }
    if (!anyActive) break;

    const newVal = val.slice();
    const newNxt = nxt.slice();
    const newDone = done.slice();

    for (let cell = 0; cell < n; cell++) {
      if (done[cell]) continue;
      const j = nxt[cell];
      if (j < 0) {
        newDone[cell] = 1;
        continue;
      }
      let value = val[cell];
      const candidate = val[j];
      if (Number.isFinite(candidate) && candidate < value) value = candidate;
      newVal[cell] = value;
      newNxt[cell] = nxt[j];
      newDone[cell] = done[j];
    }

    val = newVal;
    nxt = newNxt;
    done = newDone;
  }
  return val;
}

describe("computeTwi", () => {
  it("reproduces the reference expression exactly", () => {
    // Hand-evaluated from ln(|a| * rain + 1) - ln(tan(slopeRad + 0.001) + 0.001)
    // with slope in DEGREES.
    const accum = Float64Array.from([100]);
    const slope = Float64Array.from([5]);
    const rain = Float64Array.from([1]);

    const slopeRad = (5 * Math.PI) / 180;
    const expected = Math.log(101) - Math.log(Math.tan(slopeRad + 0.001) + 0.001);

    expect(computeTwi(accum, slope, rain)[0]).toBe(expected);
  });

  it("stays finite on a perfectly flat cell", () => {
    // Without the two epsilon guards this divides by zero.
    const value = computeTwi(
      Float64Array.from([5000]),
      Float64Array.from([0]),
      Float64Array.from([1]),
    )[0];
    expect(Number.isFinite(value)).toBe(true);
  });

  it("stays finite on a ridge with no contributing area", () => {
    // The `+ 1.0` inside the log is what makes this finite.
    const value = computeTwi(
      Float64Array.from([0]),
      Float64Array.from([30]),
      Float64Array.from([1]),
    )[0];
    expect(Number.isFinite(value)).toBe(true);
  });

  it("clamps slope rather than letting tan diverge at 90 degrees", () => {
    const value = computeTwi(
      Float64Array.from([10]),
      Float64Array.from([90]),
      Float64Array.from([1]),
    )[0];
    expect(Number.isFinite(value)).toBe(true);
  });

  it("is wetter with more area and drier on steeper ground", () => {
    const rain = Float64Array.from([1, 1]);
    const wetter = computeTwi(
      Float64Array.from([1000, 10]),
      Float64Array.from([5, 5]),
      rain,
    );
    expect(wetter[0]).toBeGreaterThan(wetter[1]);

    const steeper = computeTwi(
      Float64Array.from([100, 100]),
      Float64Array.from([2, 25]),
      rain,
    );
    expect(steeper[0]).toBeGreaterThan(steeper[1]);
  });

  it("propagates NaN rather than inventing a value", () => {
    const value = computeTwi(
      Float64Array.from([NaN]),
      Float64Array.from([5]),
      Float64Array.from([1]),
    )[0];
    expect(Number.isNaN(value)).toBe(true);
  });
});

describe("networkIndexSweep", () => {
  it("matches a brute-force walk on 1000 random flow graphs", () => {
    const rng = createRng(1234);
    const spec: GridSpec = { width: 12, height: 12, cellSize: 4 };
    const n = spec.width * spec.height;

    for (let trial = 0; trial < 1000; trial++) {
      const dem = new Float64Array(n);
      for (let i = 0; i < n; i++) dem[i] = rng.range(0, 100);

      const downstream = buildDownstreamIndex(dem, spec);
      const order = new Int32Array(n);
      const sorted = Array.from({ length: n }, (_, i) => i).sort((a, b) => dem[b] - dem[a]);
      order.set(sorted);

      const twi = new Float64Array(n);
      for (let i = 0; i < n; i++) twi[i] = rng.range(-5, 15);

      const channelMask = new Uint8Array(n);
      for (let i = 0; i < n; i++) channelMask[i] = rng.chance(0.12) ? 1 : 0;

      const swept = networkIndexSweep(twi, downstream, order, channelMask);
      for (let cell = 0; cell < n; cell++) {
        expect(swept[cell]).toBe(bruteForceNetworkIndex(twi, downstream, channelMask, cell));
      }
    }
  });

  it("matches the reference pointer-doubling solver on real terrain", () => {
    const { twi, downstream, table, channelMask } = buildCatchment(20260809);

    const swept = networkIndexSweep(twi, downstream, table.order, channelMask);
    const doubled = pointerDoublingNetworkIndex(twi, downstream, channelMask);

    for (let cell = 0; cell < twi.length; cell++) {
      expect(swept[cell]).toBe(doubled[cell]);
    }
  });

  it("never exceeds the cell's own wetness", () => {
    const { twi, downstream, table, channelMask } = buildCatchment(4242);
    const ni = networkIndexSweep(twi, downstream, table.order, channelMask);

    // The index is a minimum along a path that starts at the cell itself.
    for (let cell = 0; cell < twi.length; cell++) {
      expect(ni[cell]).toBeLessThanOrEqual(twi[cell] + 1e-12);
    }
  });

  it("implements the recurrence literally where a NaN sits mid-path", () => {
    // A NaN blocks the running minimum, because `candidate < value` is false
    // whenever either side is NaN. So the NoData cell reports NaN and the cell
    // above it keeps its own wetness instead of inheriting the bottleneck from
    // further down. That is the recurrence applied exactly as written.
    //
    // Pointer doubling does NOT agree here, and the disagreement is documented
    // rather than reconciled. Doubling composes jumps of 1, 2, 4... cells, so it
    // can leap straight over the NoData cell and pick up the value beyond it —
    // giving 7 for cell 0 while still reporting NaN for the NoData cell itself.
    // That is an artefact of the solver, not a specification either version is
    // implementing, and neither answer is more principled than the other.
    //
    // It is also unreachable: the two agree cell for cell on real terrain (see
    // the test above), and `pipeline.ts` asserts TWI is finite everywhere inside
    // the valid mask, so a NaN never reaches this code in the game. Genuine
    // exclusions go through the `valid` mask, covered below.
    const spec: GridSpec = { width: 1, height: 4, cellSize: 4 };
    const dem = Float64Array.from([40, 30, 20, 10]);
    const downstream = buildDownstreamIndex(dem, spec);
    const order = Int32Array.from([0, 1, 2, 3]);
    const twi = Float64Array.from([9, NaN, 7, 8]);
    const channelMask = new Uint8Array(4);

    const ni = networkIndexSweep(twi, downstream, order, channelMask);

    expect(ni[3]).toBe(8);
    expect(ni[2]).toBe(7);
    expect(Number.isNaN(ni[1])).toBe(true);
    expect(ni[0]).toBe(9);

    // Pin the divergence so that it is a decision on record, not a surprise.
    expect(pointerDoublingNetworkIndex(twi, downstream, channelMask)[0]).toBe(7);
  });

  it("excludes masked cells without poisoning their neighbours", () => {
    const spec: GridSpec = { width: 1, height: 4, cellSize: 4 };
    const dem = Float64Array.from([40, 30, 20, 10]);
    const twi = Float64Array.from([9, 3, 7, 8]);
    const valid = Uint8Array.from([1, 0, 1, 1]);
    const downstream = buildDownstreamIndex(dem, spec, valid);
    const order = Int32Array.from([0, 1, 2, 3]);

    const ni = networkIndexSweep(twi, downstream, order, new Uint8Array(4), valid);

    // Cell 1 is outside the catchment, so cell 0 has no successor at all and
    // reports its own wetness. The excluded cell's low value never leaks in.
    expect(ni[0]).toBe(9);
    expect(Number.isNaN(ni[1])).toBe(true);
  });
});

describe("connectivity breaks", () => {
  it("caps the index for every cell upslope of the break", () => {
    const { twi, downstream, table, channelMask, accum, slopeDeg, rain } =
      buildCatchment(777);

    const before = networkIndexSweep(twi, downstream, table.order, channelMask);

    // Put a pond-sized break on a well-connected hillslope cell.
    let target = -1;
    for (let cell = 0; cell < accum.length; cell++) {
      if (channelMask[cell]) continue;
      if (accum[cell] > 60 && accum[cell] < 200 && slopeDeg[cell] < 6) {
        target = cell;
        break;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);

    const broken = Float64Array.from(twi);
    const breakValue = storageBreakTwi(accum[target], slopeDeg[target], rain[target], 312);
    expect(breakValue).toBeLessThan(twi[target]);

    applyConnectivityBreaks(broken, [{ cell: target, twi: breakValue }]);
    const after = networkIndexSweep(broken, downstream, table.order, channelMask);

    // Nothing anywhere may get better, and the broken cell itself must worsen.
    for (let cell = 0; cell < twi.length; cell++) {
      expect(after[cell]).toBeLessThanOrEqual(before[cell] + 1e-12);
    }
    expect(after[target]).toBeLessThan(before[target]);

    // Every cell that routes through the target must now be capped by it.
    let cappedUpslope = 0;
    for (let cell = 0; cell < twi.length; cell++) {
      let walker = cell;
      let routesThrough = false;
      for (let step = 0; step < 4096; step++) {
        if (walker === target) {
          routesThrough = true;
          break;
        }
        const next = downstream[walker];
        if (next < 0 || channelMask[walker]) break;
        walker = next;
      }
      if (!routesThrough) continue;
      cappedUpslope++;
      expect(after[cell]).toBeLessThanOrEqual(breakValue + 1e-12);
    }
    expect(cappedUpslope).toBeGreaterThan(1);
  });

  it("derives a bigger break from a bigger store", () => {
    const small = storageBreakTwi(500, 3, 1, 100);
    const large = storageBreakTwi(500, 3, 1, 400);
    expect(large).toBeLessThan(small);
  });

  it("never raises wetness, whatever it is handed", () => {
    const twi = Float64Array.from([5, 5, 5]);
    applyConnectivityBreaks(twi, [
      { cell: 0, twi: 9 },
      { cell: 1, twi: 2 },
      { cell: 2, twi: NaN },
    ]);
    expect(Array.from(twi)).toEqual([5, 2, 5]);
  });
});

describe("erosion and source risk", () => {
  it("scales linearly with the land-cover weight", () => {
    const accum = Float64Array.from([100, 100]);
    const slope = Float64Array.from([10, 10]);
    const weight = Float64Array.from([1.0, 0.2]);

    const risk = computeErosionRisk(accum, slope, weight, 16);
    expect(risk[1] / risk[0]).toBeCloseTo(0.2, 12);
  });

  it("is zero on flat ground however much drains through it", () => {
    const risk = computeErosionRisk(
      Float64Array.from([100_000]),
      Float64Array.from([0]),
      Float64Array.from([1]),
      16,
    );
    expect(risk[0]).toBe(0);
  });

  it("multiplies source risk, so either factor at zero delivers nothing", () => {
    const erosion = Float64Array.from([1, 0, 1, 0.5]);
    const connectivity = Float64Array.from([1, 1, 0, 0.5]);
    const source = computeSourceRisk(erosion, connectivity);
    expect(Array.from(source)).toEqual([1, 0, 0, 0.25]);
  });
});

describe("in-channel risk", () => {
  it("is a flow-weighted mean, bounded by the extremes it averages", () => {
    const { terrain, spec, table, rain } = buildCatchment(29);
    const n = terrain.dem.length;

    const sourceRisk = new Float64Array(n);
    for (let i = 0; i < n; i++) sourceRisk[i] = (i % 11) / 10;

    const scratch = createInChannelScratch(n);
    const inChannel = computeInChannelRisk(sourceRisk, rain, table, spec, scratch);

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const ratio = sourceRisk[i] / rain[i];
      if (ratio < lo) lo = ratio;
      if (ratio > hi) hi = ratio;
    }

    for (let i = 0; i < n; i++) {
      expect(inChannel[i]).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(inChannel[i]).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("carries an upstream improvement down to the outlet", () => {
    // The property the whole game rests on, and the one the shipped reference
    // form cannot deliver: an action taken upslope must change the water below.
    const { terrain, spec, table, rain, accum } = buildCatchment(104);
    const n = terrain.dem.length;

    const sourceRisk = new Float64Array(n).fill(0.8);
    const scratch = createInChannelScratch(n);
    const before = computeInChannelRisk(sourceRisk, rain, table, spec, scratch);

    // Remediate a patch well upslope of the outlet.
    let improved = 0;
    for (let cell = 0; cell < n && improved < 200; cell++) {
      if (accum[cell] > 20 && accum[cell] < 120) {
        sourceRisk[cell] = 0;
        improved++;
      }
    }
    expect(improved).toBeGreaterThan(0);

    const after = computeInChannelRisk(sourceRisk, rain, table, spec, scratch);
    expect(after[terrain.outlet]).toBeLessThan(before[terrain.outlet]);
  });

  it("reports a concentration, so uniform risk survives routing unchanged", () => {
    // With constant source risk and constant rainfall, every reach carries the
    // same concentration no matter how much area drains to it. A routed *load*
    // would grow downstream; a concentration must not.
    const { terrain, spec, table } = buildCatchment(11);
    const n = terrain.dem.length;

    const sourceRisk = new Float64Array(n).fill(0.4);
    const rain = new Float64Array(n).fill(1);
    const scratch = createInChannelScratch(n);
    const inChannel = computeInChannelRisk(sourceRisk, rain, table, spec, scratch);

    for (let i = 0; i < n; i++) expect(inChannel[i]).toBeCloseTo(0.4, 6);
  });
});

describe("full risk assembly", () => {
  it("produces layers in [0, 1] that respond to remediation", () => {
    const { terrain, spec, table, accum, slopeDeg, downstream, channelMask, twi } =
      buildCatchment(20260809);
    const n = terrain.dem.length;
    const area = cellAreaM2(spec);

    const weight = new Float64Array(n).fill(1.0);
    const ni = networkIndexSweep(twi, downstream, table.order, channelMask);

    const connBounds = deriveConnectivityBounds(ni);
    const connectivity = normaliseConnectivity(ni, connBounds);

    const erosionRaw = computeErosionRisk(accum, slopeDeg, weight, area);
    const erosionBounds = deriveErosionBounds(erosionRaw);
    const erosion = normaliseErosion(erosionRaw, erosionBounds);

    const source = computeSourceRisk(erosion, connectivity);

    for (const layer of [connectivity, erosion, source]) {
      for (let i = 0; i < n; i++) {
        expect(layer[i]).toBeGreaterThanOrEqual(0);
        expect(layer[i]).toBeLessThanOrEqual(1);
      }
    }

    // Plant everything: weights drop to woodland, and with the bounds frozen at
    // the baseline the whole map must fall.
    const planted = new Float64Array(n).fill(0.2);
    const erosionAfter = normaliseErosion(
      computeErosionRisk(accum, slopeDeg, planted, area),
      erosionBounds,
    );
    const sourceAfter = computeSourceRisk(erosionAfter, connectivity);

    expect(nanMean(sourceAfter)).toBeLessThan(nanMean(source));

    // And crucially, no cell anywhere gets worse — the property live percentile
    // re-derivation would destroy.
    for (let i = 0; i < n; i++) expect(sourceAfter[i]).toBeLessThanOrEqual(source[i] + 1e-12);
  });

  it("keeps connectivity high in valleys and low on divides", () => {
    const { terrain, table, downstream, channelMask, twi, accum } = buildCatchment(4242);
    const ni = networkIndexSweep(twi, downstream, table.order, channelMask);
    const connectivity = normaliseConnectivity(ni, deriveBounds(ni));

    let valleySum = 0;
    let valleyCount = 0;
    let divideSum = 0;
    let divideCount = 0;

    for (let cell = 0; cell < terrain.dem.length; cell++) {
      if (channelMask[cell]) continue;
      if (accum[cell] > 100) {
        valleySum += connectivity[cell];
        valleyCount++;
      } else if (accum[cell] < 3) {
        divideSum += connectivity[cell];
        divideCount++;
      }
    }

    expect(valleyCount).toBeGreaterThan(50);
    expect(divideCount).toBeGreaterThan(50);
    expect(valleySum / valleyCount).toBeGreaterThan(divideSum / divideCount);
  });
});

describe("rainfall", () => {
  it("normalises to a catchment mean of one", () => {
    const { terrain } = buildCatchment(3);
    const rain = scaleRainfall(generateRainfall(terrain.dem));
    expect(nanMean(rain)).toBeCloseTo(1, 12);
  });

  it("is wetter on high ground", () => {
    const dem = Float64Array.from([0, 50, 100, 150]);
    const rain = generateRainfall(dem);
    for (let i = 1; i < rain.length; i++) expect(rain[i]).toBeGreaterThan(rain[i - 1]);
  });
});

describe("grid scale", () => {
  it("matches the shipped grid to the risk core's assumptions", () => {
    // The channel threshold is expressed as an area; confirm it lands on the
    // intended cell count at the shipped resolution.
    expect(channelThresholdCells(GRID.cellSize)).toBe(1000);
  });
});
