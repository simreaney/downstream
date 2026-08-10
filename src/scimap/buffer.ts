/**
 * Riparian buffer interception.
 *
 * A buffer strip works by intercepting flow that crosses it, so its effect
 * scales with **width along the flow path**, not with area. One woodland cell
 * beside a stream slows a little of what passes; three cells in a row slow much
 * more of it. Scattered single trees, however many, do almost nothing.
 *
 * That distinction is the single most useful thing the player can learn here,
 * and it is why this is modelled explicitly rather than folded into the land
 * cover weight. Planting changes erodibility wherever it happens — that is the
 * source term — but only a *continuous band* reaching the watercourse breaks
 * hydrological connectivity, which is the pathway term.
 *
 * For a cell whose downstream path crosses `w` consecutive woodland cells before
 * reaching a channel, the fraction of flow intercepted is
 *
 *     f = 1 - (1 - p)^w,   p = BUFFER_INTERCEPT_PER_CELL
 *
 * so one cell takes 25%, two 44%, three 58%, five 76%. Diminishing returns, as
 * observed. That fraction becomes an effective storage capacity, and the
 * resulting TWI clamp propagates upslope for free through the min recurrence.
 */

import { LandCover } from "./constants";

/** Fraction of through-flow a single cell of buffer intercepts. */
export const BUFFER_INTERCEPT_PER_CELL = 0.25;

/** Cells of buffer beyond which extra width is not credited. */
const MAX_BUFFER_WIDTH = 8;

export interface BufferBreak {
  readonly cell: number;
  /** Upslope area, in cells, this buffer takes out of circulation. */
  readonly capacityCells: number;
}

/**
 * Find woodland cells that form a buffer between the hillslope and a channel,
 * and compute how much flow each intercepts.
 *
 * Only cells whose *own* downstream path reaches a channel through an unbroken
 * run of woodland qualify. A wood on an interfluve, however large, is not a
 * buffer — nothing routes through it to a watercourse.
 */
export function computeBufferBreaks(
  landCover: Uint8Array,
  downstream: Int32Array,
  channelMask: Uint8Array,
  accum: Float64Array,
): BufferBreak[] {
  const breaks: BufferBreak[] = [];

  for (let cell = 0; cell < landCover.length; cell++) {
    if (landCover[cell] !== LandCover.Woodland) continue;
    if (channelMask[cell]) continue;

    // Walk downstream counting consecutive woodland until the channel. Bail the
    // moment the run is broken: a gap in the strip is a gap in the buffer, which
    // is exactly the lesson.
    let width = 1;
    let walker = downstream[cell];
    let reachesChannel = false;

    for (let step = 0; step < MAX_BUFFER_WIDTH; step++) {
      if (walker < 0) break;
      if (channelMask[walker]) {
        reachesChannel = true;
        break;
      }
      if (landCover[walker] !== LandCover.Woodland) break;
      width++;
      walker = downstream[walker];
    }

    if (!reachesChannel) continue;

    const intercepted = 1 - Math.pow(1 - BUFFER_INTERCEPT_PER_CELL, width);
    const capacityCells = intercepted * Math.abs(accum[cell]);
    if (capacityCells > 0) breaks.push({ cell, capacityCells });
  }

  return breaks;
}
