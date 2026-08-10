/**
 * Catchment-scale summaries the score is built from.
 *
 * Computed in the worker, where the arrays live, and sent across as a handful of
 * numbers rather than shipping layers the main thread would only reduce anyway.
 *
 * The habitat measures are the interesting ones. Woodland *area* is easy to
 * score and says almost nothing — a hundred trees scattered across a hillside
 * count the same as a hundred in a continuous streamside band, while doing a
 * fraction of the good. So the corridor measure looks for continuity along the
 * watercourse, which is what the ecology depends on and what the buffer model
 * already rewards hydrologically. The two halves of the game then agree about
 * what good work looks like.
 */

import { LandCover } from "./constants";
import { type GridSpec, N8_DCOL, N8_DROW } from "../core/grid";
import { nanMean } from "../core/stats";

export interface CatchmentMetrics {
  readonly meanSourceRisk: number;
  readonly meanConnectivity: number;
  readonly inChannelAtOutlet: number;
  readonly inChannelAtFishery: number;

  readonly woodlandFraction: number;
  /** Channel cells, and how many have woodland on at least one bank. */
  readonly channelCells: number;
  readonly bufferedChannelCells: number;
  /** Longest unbroken run of buffered channel, in cells. */
  readonly longestBufferRun: number;
  readonly pondCount: number;
}

export interface MetricsInput {
  readonly spec: GridSpec;
  readonly sourceRisk: Float64Array;
  readonly connectivity: Float64Array;
  readonly inChannel: Float64Array;
  readonly landCover: Uint8Array;
  readonly channelMask: Uint8Array;
  readonly downstream: Int32Array;
  readonly outlet: number;
  readonly fisheryCell: number;
  /** Cells occupied by one pond, so pond area can be read back as a count. */
  readonly cellsPerPond: number;
}

/** Channel cells with woodland on at least one bank. */
function markBuffered(
  spec: GridSpec,
  landCover: Uint8Array,
  channelMask: Uint8Array,
): Uint8Array {
  const { width, height } = spec;
  const buffered = new Uint8Array(width * height);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      if (!channelMask[cell]) continue;

      for (let k = 0; k < 8; k++) {
        const nRow = row + N8_DROW[k];
        const nCol = col + N8_DCOL[k];
        if (nRow < 0 || nRow >= height || nCol < 0 || nCol >= width) continue;
        if (landCover[nRow * width + nCol] === LandCover.Woodland) {
          buffered[cell] = 1;
          break;
        }
      }
    }
  }
  return buffered;
}

/**
 * Longest unbroken run of buffered channel, following flow downstream.
 *
 * A gap resets the count, which is the whole point: a buffer with holes in it is
 * a buffer with holes in it, for the water and for anything trying to move along
 * the corridor. Memoised so the network is walked once rather than once per
 * starting cell.
 */
function longestBufferedRun(
  channelMask: Uint8Array,
  downstream: Int32Array,
  buffered: Uint8Array,
): number {
  const n = channelMask.length;
  const runFrom = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  let longest = 0;

  for (let start = 0; start < n; start++) {
    if (!channelMask[start] || !buffered[start] || runFrom[start] >= 0) continue;

    stack.length = 0;
    let cell = start;

    // Descend while the run continues and the answer is not already known.
    while (cell >= 0 && channelMask[cell] && buffered[cell] && runFrom[cell] < 0) {
      stack.push(cell);
      cell = downstream[cell];
    }

    let carried =
      cell >= 0 && channelMask[cell] && buffered[cell] ? Math.max(0, runFrom[cell]) : 0;

    for (let i = stack.length - 1; i >= 0; i--) {
      carried += 1;
      runFrom[stack[i]] = carried;
      if (carried > longest) longest = carried;
    }
  }
  return longest;
}

export function computeMetrics(input: MetricsInput): CatchmentMetrics {
  const { spec, landCover, channelMask, downstream } = input;

  let woodland = 0;
  let water = 0;
  let channelCells = 0;

  for (let cell = 0; cell < landCover.length; cell++) {
    if (landCover[cell] === LandCover.Woodland) woodland++;
    else if (landCover[cell] === LandCover.Water) water++;
    if (channelMask[cell]) channelCells++;
  }

  const buffered = markBuffered(spec, landCover, channelMask);
  let bufferedChannelCells = 0;
  for (const flag of buffered) bufferedChannelCells += flag;

  return {
    meanSourceRisk: nanMean(input.sourceRisk),
    meanConnectivity: nanMean(input.connectivity),
    inChannelAtOutlet: input.inChannel[input.outlet],
    inChannelAtFishery: input.inChannel[input.fisheryCell],
    woodlandFraction: woodland / landCover.length,
    channelCells,
    bufferedChannelCells,
    longestBufferRun: longestBufferedRun(channelMask, downstream, buffered),
    // Ponds are recorded as water cells; report features rather than area.
    pondCount: input.cellsPerPond > 0 ? Math.round(water / input.cellsPerPond) : 0,
  };
}
