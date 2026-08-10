/**
 * The SCIMAP pipeline: terrain in, risk layers out.
 *
 * Ordering here is the canonical one from the reference implementation, and the
 * dependencies are strict — slope needs the filled DEM, TWI needs slope and FD8
 * area, the Network Index needs TWI and the channel mask, source risk needs both
 * normalised halves, and in-channel risk routes source risk through the same FD8
 * fractions the area came from.
 *
 * Every array lives in one `ScimapArrays` object owned by the worker and reused
 * across recomputes, so a placement allocates nothing. The split between what is
 * rebuilt and what is cached is the whole reason the overlay can update live;
 * `incremental.ts` owns that decision, and this module owns the cold path.
 */

import { cellAreaM2, type GridSpec } from "../core/grid";
import type { Bounds, StretchBounds } from "../core/normalise";
import type { ProgressCallback } from "../worker/protocol";
import { channelThresholdCells } from "./constants";
import { accumulateD8, buildDownstreamIndex } from "./d8";
import {
  computeErosionRisk,
  computeSourceRisk,
  deriveErosionBounds,
  normaliseErosion,
} from "./erosion";
import { accumulate, buildFd8Table, type Fd8Table } from "./fd8";
import { fillDepressions } from "./fill";
import {
  computeInChannelRisk,
  createInChannelScratch,
  deriveInChannelBounds,
  normaliseInChannel,
  type InChannelScratch,
} from "./inChannel";
import { buildRiskWeight } from "./landcover";
import {
  deriveConnectivityBounds,
  networkIndexSweep,
  normaliseConnectivity,
} from "./networkIndex";
import { generateRainfall, scaleRainfall } from "./rainfall";
import { computeDerivatives } from "./slope";
import { extractChannelMask } from "./streams";
import { applyConnectivityBreaks, computeTwi, type ConnectivityBreak } from "./twi";

/** Every raster the model owns. Allocated once, mutated in place thereafter. */
export interface ScimapArrays {
  readonly spec: GridSpec;
  readonly outlet: number;

  /** Hydrologically filled elevation. Player features never modify this. */
  readonly dem: Float64Array;
  readonly slopeDeg: Float64Array;
  readonly curvature: Float64Array;

  readonly table: Fd8Table;
  readonly downstream: Int32Array;
  /** FD8 upslope area in cells — feeds wetness and erosion. */
  readonly accum: Float64Array;
  /** D8 upslope area in cells — defines the channel network. */
  readonly d8Accum: Float64Array;
  readonly channelMask: Uint8Array;

  readonly rainfallScaled: Float64Array;
  readonly landCover: Uint8Array;
  readonly riskWeight: Float64Array;

  /** Baseline wetness, before any intervention. */
  readonly twi: Float64Array;
  /** Wetness after connectivity breaks — what the sweep actually reads. */
  readonly twiEffective: Float64Array;
  readonly networkIndex: Float64Array;

  readonly connectivity: Float64Array;
  readonly erosionRaw: Float64Array;
  readonly erosion: Float64Array;
  readonly sourceRisk: Float64Array;
  readonly inChannelRaw: Float64Array;
  readonly inChannel: Float64Array;

  readonly scratch: InChannelScratch;
}

export interface ScimapConfig {
  readonly channelThresholdCells: number;
}

export function defaultConfig(spec: GridSpec): ScimapConfig {
  return { channelThresholdCells: channelThresholdCells(spec.cellSize) };
}

export interface ScimapResult {
  readonly arrays: ScimapArrays;
  readonly bounds: StretchBounds;
}

/**
 * Supplies land cover once the pipeline has computed what it depends on.
 *
 * Land cover follows slope and elevation — arable on the workable ground,
 * moorland on the tops — and slope is not known until the DEM has been filled
 * and differentiated. Taking a callback rather than a finished array means the
 * caller does not have to duplicate the fill and the derivatives just to answer
 * the question.
 */
export type LandCoverFactory = (dem: Float64Array, slopeDeg: Float64Array) => Uint8Array;

/**
 * Build every layer from a freshly generated catchment.
 *
 * `dem` is filled in place. The returned stretch bounds are the frozen baseline
 * for the whole session and must be persisted with the save; see
 * `core/normalise.ts` for why re-deriving them later silently zeroes the score.
 */
export function runFullScimap(
  dem: Float64Array,
  landCoverFor: LandCoverFactory,
  spec: GridSpec,
  outlet: number,
  onProgress?: ProgressCallback,
): ScimapResult {
  const n = spec.width * spec.height;
  const area = cellAreaM2(spec);
  const config = defaultConfig(spec);

  onProgress?.(34, "2.1 Removing depressions…");
  fillDepressions(dem, spec, outlet);

  onProgress?.(38, "2.2 Measuring slope and curvature…");
  const { slopeDeg, curvature } = computeDerivatives(dem, spec);

  onProgress?.(42, "2.3 Partitioning flow…");
  const table = buildFd8Table(dem, spec);
  const downstream = buildDownstreamIndex(dem, spec);

  onProgress?.(48, "2.4 Accumulating upslope area…");
  const accum = accumulate(table, spec);
  const d8Accum = accumulateD8(downstream, table.order);
  const channelMask = extractChannelMask(d8Accum, config.channelThresholdCells);

  onProgress?.(54, "2.5 Weighting rainfall…");
  const rainfallScaled = scaleRainfall(generateRainfall(dem));

  onProgress?.(58, "2.6 Computing wetness…");
  const twi = computeTwi(accum, slopeDeg, rainfallScaled);
  assertFinite(twi, "twi");
  const twiEffective = Float64Array.from(twi);

  onProgress?.(62, "2.7 Tracing flow paths to the channel network…");
  const networkIndex = networkIndexSweep(twiEffective, downstream, table.order, channelMask);

  onProgress?.(68, "2.8 Freezing the baseline…");
  const connectivityBounds = deriveConnectivityBounds(networkIndex);
  const connectivity = normaliseConnectivity(networkIndex, connectivityBounds);

  const landCover = landCoverFor(dem, slopeDeg);
  const riskWeight = buildRiskWeight(landCover);
  const erosionRaw = computeErosionRisk(accum, slopeDeg, riskWeight, area);
  const erosionBounds = deriveErosionBounds(erosionRaw);
  const erosion = normaliseErosion(erosionRaw, erosionBounds);

  const sourceRisk = computeSourceRisk(erosion, connectivity);

  const scratch = createInChannelScratch(n);
  const inChannelRaw = computeInChannelRisk(
    sourceRisk,
    rainfallScaled,
    table,
    spec,
    scratch,
  );
  const inChannelBounds = deriveInChannelBounds(inChannelRaw, channelMask);
  const inChannel = normaliseInChannel(inChannelRaw, inChannelBounds);

  onProgress?.(72, "2.9 Risk layers ready.");

  return {
    arrays: {
      spec,
      outlet,
      dem,
      slopeDeg,
      curvature,
      table,
      downstream,
      accum,
      d8Accum,
      channelMask,
      rainfallScaled,
      landCover,
      riskWeight,
      twi,
      twiEffective,
      networkIndex,
      connectivity,
      erosionRaw,
      erosion,
      sourceRisk,
      inChannelRaw,
      inChannel,
      scratch,
    },
    bounds: {
      erosion: erosionBounds,
      connectivity: connectivityBounds,
      inChannel: inChannelBounds,
    },
  };
}

/**
 * Guard the assumption the Network Index sweep relies on.
 *
 * The sweep and the reference's pointer-doubling solver agree everywhere except
 * where a NaN sits mid flow path, and there they legitimately differ — doubling
 * can leap over a NoData cell that a sequential walk stops at. Rather than pick
 * a winner for a case with no principled answer, the pipeline guarantees it
 * cannot arise. The generated catchment has no NoData, so this should never
 * fire; if it does, something upstream has produced a non-finite slope or area
 * and every layer below is meaningless.
 */
function assertFinite(values: Float64Array, name: string): void {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`${name} is not finite at cell ${i} — check slope and accumulation`);
    }
  }
}

/**
 * Re-solve connectivity and everything downstream of it.
 *
 * This is the path a pond, a leaky dam or a riparian tree takes. The DEM, the
 * FD8 fraction table, the sweep order and the channel network are all untouched,
 * so the expensive half of the pipeline is skipped entirely.
 */
export function recomputeFromTwi(
  arrays: ScimapArrays,
  bounds: StretchBounds,
  breaks: readonly ConnectivityBreak[],
): void {
  const { twi, twiEffective, downstream, table, channelMask } = arrays;

  // Rebuild from the pristine baseline every time rather than accumulating
  // clamps, so removing a feature restores the catchment exactly.
  twiEffective.set(twi);
  applyConnectivityBreaks(twiEffective, breaks);

  networkIndexSweep(
    twiEffective,
    downstream,
    table.order,
    channelMask,
    undefined,
    arrays.networkIndex,
  );
  normaliseConnectivity(arrays.networkIndex, bounds.connectivity, arrays.connectivity);

  recomputeFromWeights(arrays, bounds);
}

/**
 * Re-solve the source term and everything downstream of it.
 *
 * Taken when a tree is planted outside the riparian zone: land cover changed, so
 * erodibility changed, but hydrological connectivity did not.
 */
export function recomputeFromWeights(arrays: ScimapArrays, bounds: StretchBounds): void {
  const { spec, accum, slopeDeg, riskWeight, connectivity, rainfallScaled, table } = arrays;
  const area = cellAreaM2(spec);

  computeErosionRisk(accum, slopeDeg, riskWeight, area, arrays.erosionRaw);
  normaliseErosion(arrays.erosionRaw, bounds.erosion, arrays.erosion);
  computeSourceRisk(arrays.erosion, connectivity, arrays.sourceRisk);

  computeInChannelRisk(
    arrays.sourceRisk,
    rainfallScaled,
    table,
    spec,
    arrays.scratch,
    arrays.inChannelRaw,
  );
  normaliseInChannel(arrays.inChannelRaw, bounds.inChannel, arrays.inChannel);
}

export type { Bounds };
