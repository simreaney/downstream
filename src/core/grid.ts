/**
 * Flat row-major grid primitives.
 *
 * Every raster in the game — elevation, slope, accumulation, TWI, risk, land
 * cover — is a `width * height` typed array indexed `row * width + col`. Nothing
 * is ever a nested array; the compute core walks these linearly hundreds of
 * thousands of times per placement and the allocation and pointer-chasing of
 * arrays-of-arrays would dominate the frame budget.
 *
 * NoData is NaN internally, converted to a sentinel only at serialisation.
 */

/** Grid extent and cell size. One instance describes the whole catchment. */
export interface GridSpec {
  readonly width: number;
  readonly height: number;
  /** Cell side length in metres. */
  readonly cellSize: number;
}

export function cellCount(spec: GridSpec): number {
  return spec.width * spec.height;
}

export function cellAreaM2(spec: GridSpec): number {
  return spec.cellSize * spec.cellSize;
}

export function idx(spec: GridSpec, row: number, col: number): number {
  return row * spec.width + col;
}

export function rowOf(spec: GridSpec, index: number): number {
  return (index / spec.width) | 0;
}

export function colOf(spec: GridSpec, index: number): number {
  return index % spec.width;
}

/**
 * The canonical eight-neighbour order: N, NE, E, SE, S, SW, W, NW.
 *
 * This order is load-bearing rather than arbitrary. It matches the reference
 * SCIMAP implementation's kernel exactly, which matters because steepest-descent
 * ties are broken by iteration order — two neighbours at identical gradient
 * resolve to whichever is visited first. Reordering this table would silently
 * change flow direction on flats and plateaux, and therefore change the Network
 * Index, without any test that compares against the reference noticing why.
 */
export const N8_DROW = new Int8Array([-1, -1, 0, 1, 1, 1, 0, -1]);
export const N8_DCOL = new Int8Array([0, 1, 1, 1, 0, -1, -1, -1]);

/** Centre-to-centre distance to each neighbour, in cell units (1 or sqrt(2)). */
export const N8_DIST = new Float64Array([
  1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2,
]);

/**
 * Contour length each neighbour direction drains across, as a fraction of the
 * cell side (Quinn et al. 1991: 0.5 for cardinals, 0.354 for diagonals).
 *
 * WhiteboxTools' FD8 uses its own internal contour lengths which are not
 * reproducible from the outside, so this is a documented approximation. We match
 * the reference on the parts that are specified — the exponent is held at
 * exactly 2.0 — and claim behavioural parity, never bit-parity.
 */
export const N8_CONTOUR = new Float64Array([
  0.5, 0.354, 0.5, 0.354, 0.5, 0.354, 0.5, 0.354,
]);

/** True when (row, col) is inside the grid. */
export function inBounds(spec: GridSpec, row: number, col: number): boolean {
  return row >= 0 && row < spec.height && col >= 0 && col < spec.width;
}

/** True when the cell lies on the outer ring of the grid. */
export function isBorder(spec: GridSpec, index: number): boolean {
  const row = rowOf(spec, index);
  const col = colOf(spec, index);
  return row === 0 || col === 0 || row === spec.height - 1 || col === spec.width - 1;
}

/** Set every cell outside `mask` to NaN, in place. */
export function applyMask(data: Float64Array, mask: Uint8Array): Float64Array {
  for (let i = 0; i < data.length; i++) {
    if (!mask[i]) data[i] = NaN;
  }
  return data;
}

/** Validity mask: finite values only. */
export function finiteMask(data: ArrayLike<number>): Uint8Array {
  const mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) mask[i] = Number.isFinite(data[i]) ? 1 : 0;
  return mask;
}
