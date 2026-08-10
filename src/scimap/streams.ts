/**
 * Channel network extraction and vectorisation.
 *
 * A cell becomes a channel once enough area drains through it. The threshold is
 * a genuine modelling choice rather than a display setting: it decides where the
 * Network Index trace terminates, and therefore what "connected to the river"
 * means everywhere in the catchment. It also decides where the player may build
 * a leaky dam and where they may not build a pond.
 */

import { type GridSpec, N8_DCOL, N8_DROW } from "../core/grid";

/**
 * Cells whose upslope contributing area reaches the channel threshold.
 *
 * `accum` must be the **D8** accumulation, not the FD8 area that feeds TWI. That
 * requirement is what keeps this function a single threshold rather than
 * something more elaborate, and it is worth spelling out why.
 *
 * D8 accumulation is monotonically non-decreasing along a D8 flow path — a cell
 * passes its entire load to its one successor, which also collects everything
 * else draining into it. So thresholding it yields a network that is already a
 * connected tree running to the outlet, with no gaps to repair.
 *
 * Threshold FD8 accumulation instead and neither property holds: flow splits
 * across up to eight neighbours, so a cell can carry more area than the successor
 * it drains to. The network then comes out both fragmented (breaking the traced
 * polylines, so the rendered river vanishes and reappears down its own length)
 * and, on the near-flat valley floors left by epsilon filling, tens of cells
 * wide — a marsh rather than a watercourse.
 */
export function extractChannelMask(
  accum: Float64Array,
  threshold: number,
  valid?: Uint8Array,
  out?: Uint8Array,
): Uint8Array {
  const n = accum.length;
  const mask = out && out.length === n ? out : new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    mask[i] = (!valid || valid[i]) && Math.abs(accum[i]) >= threshold ? 1 : 0;
  }
  return mask;
}

/** One traced reach: a run of channel cells from a head or junction downstream. */
export interface StreamPolyline {
  /** Cell indices along the reach, ordered downstream. */
  readonly cells: Int32Array;
  /** Upslope area in cells at each vertex, for width and risk shading. */
  readonly accum: Float64Array;
}

/**
 * Trace the channel network into polylines by walking the D8 successor map.
 *
 * Reaches are cut at confluences so the river mesh can taper each one
 * independently: a tributary joining a trunk should not inherit the trunk's
 * width. Walking starts from channel heads — channel cells with no channel cell
 * flowing into them — and from every junction, which between them cover the
 * network exactly once.
 */
export function traceStreams(
  channelMask: Uint8Array,
  downstream: Int32Array,
  accum: Float64Array,
): StreamPolyline[] {
  const n = channelMask.length;

  // Count channel inflows per cell to find heads and confluences.
  const inflow = new Int32Array(n);
  for (let cell = 0; cell < n; cell++) {
    if (!channelMask[cell]) continue;
    const next = downstream[cell];
    if (next >= 0 && channelMask[next]) inflow[next]++;
  }

  const visited = new Uint8Array(n);
  const polylines: StreamPolyline[] = [];
  const buffer: number[] = [];

  const traceFrom = (start: number): void => {
    buffer.length = 0;
    let cell = start;

    for (;;) {
      buffer.push(cell);
      visited[cell] = 1;

      const next = downstream[cell];
      if (next < 0 || !channelMask[next]) break;

      // Stop at a confluence: it starts its own reach, so both tributaries end
      // cleanly at the junction vertex rather than overlapping through it.
      if (inflow[next] > 1) {
        buffer.push(next);
        break;
      }
      if (visited[next]) {
        buffer.push(next);
        break;
      }
      cell = next;
    }

    if (buffer.length < 2) return;
    polylines.push({
      cells: Int32Array.from(buffer),
      accum: Float64Array.from(buffer, (index) => accum[index]),
    });
  };

  for (let cell = 0; cell < n; cell++) {
    if (channelMask[cell] && inflow[cell] === 0) traceFrom(cell);
  }
  for (let cell = 0; cell < n; cell++) {
    if (channelMask[cell] && inflow[cell] > 1 && !visited[cell]) traceFrom(cell);
  }

  // Anything still unvisited is a loop the successor map should not contain, but
  // covering it keeps the rendered network complete if one ever appears.
  for (let cell = 0; cell < n; cell++) {
    if (channelMask[cell] && !visited[cell]) traceFrom(cell);
  }

  return polylines;
}

/** Number of channel cells adjacent to a non-channel cell — the riparian edge. */
export function countChannelAdjacent(channelMask: Uint8Array, spec: GridSpec): number {
  const { width, height } = spec;
  let count = 0;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      if (channelMask[cell]) continue;

      for (let k = 0; k < 8; k++) {
        const nRow = row + N8_DROW[k];
        const nCol = col + N8_DCOL[k];
        if (nRow < 0 || nRow >= height || nCol < 0 || nCol >= width) continue;
        if (channelMask[nRow * width + nCol]) {
          count++;
          break;
        }
      }
    }
  }
  return count;
}
