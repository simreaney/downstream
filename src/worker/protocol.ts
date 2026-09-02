/**
 * The main thread <-> simulation worker message contract.
 *
 * Ownership rule, which the whole design depends on: the worker owns the
 * canonical SCIMAP arrays and the main thread never sees them. What crosses this
 * boundary is only what rendering and placement validation need, and every
 * ArrayBuffer that crosses goes in the transfer list, so a message is a move and
 * not a copy. If a buffer is ever read on both sides after a post, that is a
 * bug — the sender's reference is detached.
 *
 * The main thread does keep its own copies of a handful of layers, because
 * `game/validity.ts` has to answer "can I build here?" every frame while the
 * placement ghost follows the player, and a worker round trip per frame would
 * make the ghost lag the character. Those layers (elevation, slope, curvature,
 * contributing area, the channel mask and land cover) change rarely and are
 * re-sent when they do.
 */

import type { StretchBounds } from "../core/normalise";
import type { GridSpec } from "../core/grid";
import type { LayerKey } from "./overlayPack";

/** Progress reporting matches the signature used across the SCIMAP codebase. */
export type ProgressCallback = (progress: number, message?: string) => void;

/**
 * A storage feature's connectivity break, as capacity rather than as wetness.
 *
 * The main thread sends what it knows — this cell holds runoff from this much
 * upslope area — and the worker converts it to an effective TWI. Deriving the
 * wetness here would mean shipping the rainfall field across the boundary and
 * duplicating the TWI expression on both sides, which is exactly the kind of
 * split that lets the two drift apart.
 */
export interface BreakDto {
  readonly cell: number;
  readonly capacityCells: number;
}

/** Land-cover edits to apply before recomputing. */
export interface CoverEditDto {
  readonly cell: number;
  readonly cover: number;
}

/**
 * `Omit` over a union collapses it to the common keys, which would silently drop
 * every request-specific field. Distributing it across the members keeps each
 * variant intact so `send()` still type-checks its payload.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type SimRequest =
  | { type: "ping"; jobId: number }
  | {
      type: "generate";
      jobId: number;
      seed: number;
      layer: LayerKey;
      /** Catchment extent to generate at. Undefined means the shipped default. */
      spec?: GridSpec;
    }
  | {
      type: "recompute";
      jobId: number;
      layer: LayerKey;
      breaks: readonly BreakDto[];
      coverEdits: readonly CoverEditDto[];
    }
  | { type: "setLayer"; jobId: number; layer: LayerKey }
  | {
      type: "storm";
      jobId: number;
      /**
       * Rainfall depth to route, in millimetres.
       *
       * A depth rather than a return period, because storms now arrive two ways:
       * the player asks for a named design event, or the weather samples one.
       * Both end up as a depth, so that is what crosses the boundary, and the
       * worker labels it on the way back.
       */
      depthMm: number;
      breaks: readonly BreakDto[];
      damCells: readonly number[];
      pondCells: readonly number[];
    }
  | { type: "release"; buffers: ArrayBuffer[] };

/** Summary statistics the HUD and scoring read, small enough to clone freely. */
export interface CatchmentMetricsDto {
  readonly meanSourceRisk: number;
  readonly meanConnectivity: number;
  readonly inChannelAtOutlet: number;
  readonly inChannelAtFishery: number;
  readonly woodlandFraction: number;
  readonly channelCells: number;
  readonly bufferedChannelCells: number;
  readonly longestBufferRun: number;
  readonly pondCount: number;
}

/** Where the receptors and settlements sit, chosen from the hydrology. */
export interface SitesDto {
  readonly fisheryCell: number;
  readonly villageCell: number;
  readonly cottageCells: number[];
  readonly poolCells: number[];
}

/** A traced river reach, flattened for transfer. */
export interface ReachDto {
  readonly cells: Int32Array;
  readonly accum: Float64Array;
}

export type SimResponse =
  | { type: "pong"; jobId: number }
  | { type: "progress"; jobId: number; progress: number; message?: string }
  | {
      type: "generated";
      jobId: number;
      seed: number;
      /** The extent this catchment was actually generated at. */
      spec: GridSpec;
      outlet: number;
      /** Elevation for the terrain mesh and ground following. */
      dem: ArrayBuffer;
      slopeDeg: ArrayBuffer;
      curvature: ArrayBuffer;
      accum: ArrayBuffer;
      channelMask: ArrayBuffer;
      landCover: ArrayBuffer;
      overlay: ArrayBuffer;
      reaches: ReachDto[];
      sites: SitesDto;
      bounds: StretchBounds;
      /** Metrics for the pristine catchment: the score's frozen denominator. */
      baseline: CatchmentMetricsDto;
      metrics: CatchmentMetricsDto;
    }
  | {
      type: "recomputed";
      jobId: number;
      overlay: ArrayBuffer;
      /** In-channel risk per river vertex, driving the silt colour of the water. */
      reachRisk: ArrayBuffer;
      metrics: CatchmentMetricsDto;
    }
  | {
      type: "storm";
      jobId: number;
      depthMm: number;
      returnPeriodDays: number;
      /** Discharge series, one value per step, for both runs. */
      q: ArrayBuffer;
      baselineQ: ArrayBuffer;
      /** Quantised water depth over the whole grid, `frameCount` snapshots. */
      depthFrames: ArrayBuffer;
      frameCount: number;
      depthScaleM: number;
      stepSeconds: number;
      peakQ: number;
      baselinePeakQ: number;
      tPeakSeconds: number;
      baselineTPeakSeconds: number;
    }
  | { type: "error"; jobId: number; message: string };
