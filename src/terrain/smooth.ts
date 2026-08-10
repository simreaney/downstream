/**
 * A single narrow Gaussian pass over the eroded DEM.
 *
 * This step is not optional and not cosmetic. Droplet erosion writes through a
 * bilinear deposition kernel, which leaves cell-scale speckle of a few
 * millimetres. That is invisible in the rendered terrain and catastrophic for
 * the hydrology: slope is a finite difference over neighbouring cells, so
 * millimetre noise on a gentle 0.5% valley floor swamps the real gradient. Slope
 * feeds the TWI denominator and the erosion risk's tan(beta) term, and
 * steepest-descent flow direction is decided by comparing neighbour gradients —
 * so speckle scatters flow directions on exactly the flat valley bottoms where
 * connectivity matters most.
 *
 * Sigma is kept below one cell. Larger would also erase the real valley detail
 * that the erosion pass just spent a second carving.
 */

import type { GridSpec } from "../core/grid";

export const DEFAULT_SIGMA_CELLS = 0.6;

/** Separable Gaussian blur of `dem` in place. Edges clamp rather than darken. */
export function smooth(dem: Float64Array, spec: GridSpec, sigma = DEFAULT_SIGMA_CELLS): void {
  if (sigma <= 0) return;

  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  const twoSigmaSq = 2 * sigma * sigma;
  let total = 0;

  for (let i = -radius; i <= radius; i++) {
    const weight = Math.exp(-(i * i) / twoSigmaSq);
    kernel[i + radius] = weight;
    total += weight;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;

  const { width, height } = spec;
  const scratch = new Float64Array(dem.length);

  // Horizontal pass.
  for (let row = 0; row < height; row++) {
    const rowStart = row * width;
    for (let col = 0; col < width; col++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const c = Math.min(Math.max(col + k, 0), width - 1);
        sum += dem[rowStart + c] * kernel[k + radius];
      }
      scratch[rowStart + col] = sum;
    }
  }

  // Vertical pass.
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const r = Math.min(Math.max(row + k, 0), height - 1);
        sum += scratch[r * width + col] * kernel[k + radius];
      }
      dem[row * width + col] = sum;
    }
  }
}
