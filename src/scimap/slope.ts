/**
 * Slope and profile curvature from the filled DEM.
 *
 * Slope is returned in **degrees**, not radians and not a gradient ratio. That
 * is not a stylistic choice: the reference TWI expression clamps slope to
 * [0, 89] and adds an epsilon of 0.001 before taking a tangent, and both of
 * those constants only mean what they are supposed to mean if the input is in
 * degrees. Feeding radians in would leave the pipeline running happily and every
 * wetness value wrong.
 *
 * Both layers come out of one fused 3x3 pass. They are always wanted together —
 * slope drives TWI and the erosion risk, curvature decides whether a cell is a
 * hollow that can hold a pond — and sharing the neighbourhood fetch roughly
 * halves the memory traffic of computing them separately.
 */

import type { GridSpec } from "../core/grid";

export interface SurfaceDerivatives {
  /** Slope in degrees, 0 to 90. */
  readonly slopeDeg: Float64Array;
  /**
   * Profile curvature, positive on convex noses and negative in concave
   * hollows, in units of 1/m. Used only for pond siting.
   */
  readonly curvature: Float64Array;
}

/**
 * Horn's method for slope: a 3x3 Sobel-like kernel weighting the four cardinal
 * neighbours double.
 *
 * Preferred over a simple two-cell difference because it averages across the
 * neighbourhood, which suppresses the residual cell-scale noise that survives
 * the terrain smoothing pass. Flow *direction* still uses raw pairwise drops —
 * see d8.ts — because there the comparison must be between actual neighbours.
 */
export function computeDerivatives(
  dem: Float64Array,
  spec: GridSpec,
  out?: SurfaceDerivatives,
): SurfaceDerivatives {
  const { width, height, cellSize } = spec;
  const n = width * height;

  const slopeDeg = out?.slopeDeg?.length === n ? out.slopeDeg : new Float64Array(n);
  const curvature = out?.curvature?.length === n ? out.curvature : new Float64Array(n);

  const toDegrees = 180 / Math.PI;
  const invCellSq = 1 / (cellSize * cellSize);

  for (let row = 0; row < height; row++) {
    // Clamp at the border rather than skipping, so edge cells get a real slope
    // instead of a zero that would read as a perfectly flat, maximally wet ring.
    const rUp = Math.max(row - 1, 0);
    const rDown = Math.min(row + 1, height - 1);

    for (let col = 0; col < width; col++) {
      const cLeft = Math.max(col - 1, 0);
      const cRight = Math.min(col + 1, width - 1);

      const upRow = rUp * width;
      const midRow = row * width;
      const downRow = rDown * width;

      const z1 = dem[upRow + cLeft];
      const z2 = dem[upRow + col];
      const z3 = dem[upRow + cRight];
      const z4 = dem[midRow + cLeft];
      const z5 = dem[midRow + col];
      const z6 = dem[midRow + cRight];
      const z7 = dem[downRow + cLeft];
      const z8 = dem[downRow + col];
      const z9 = dem[downRow + cRight];

      const dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * cellSize);
      const dzdy = ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / (8 * cellSize);

      const index = midRow + col;
      slopeDeg[index] = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * toDegrees;

      // Zevenbergen-Thorne second derivatives, negated to follow the GIS sign
      // convention (as ArcGIS and friends report it): negative is upwardly
      // concave — a hollow, where water converges and a pond has a bowl to sit
      // in — and positive is a convex nose that sheds it. The raw Laplacian has
      // the opposite sign, so dropping the negation here would invert every pond
      // siting rule while leaving the magnitudes looking entirely reasonable.
      const d2x = (z4 - 2 * z5 + z6) * invCellSq;
      const d2y = (z2 - 2 * z5 + z8) * invCellSq;
      curvature[index] = -(d2x + d2y);
    }
  }

  return { slopeDeg, curvature };
}
