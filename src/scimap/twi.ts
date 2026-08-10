/**
 * Topographic Wetness Index, and the connectivity breaks the player's storage
 * features impose on it.
 *
 * The TWI expression is transcribed from the reference implementation without
 * simplification, including details that look like they could be tidied and
 * cannot:
 *
 *  - Slope arrives in **degrees** and is clamped to [0, 89] before conversion.
 *    The clamp is what stops tan() reaching its singularity and stamping
 *    infinities across cliff faces.
 *  - The `+ 0.001` inside the tangent and the `+ 0.001` outside it are two
 *    different guards, and both are load-bearing: together they floor the
 *    denominator near 0.002 so a perfectly flat cell yields a large but finite
 *    wetness rather than a division by zero.
 *  - The `+ 1.0` inside the logarithm keeps ridge cells, where contributing area
 *    is nearly zero, finite.
 *  - Area is the raw FD8 accumulation in **cells**. It is never divided by
 *    contour width to form a specific catchment area and never converted to
 *    square metres. Doing either would shift every wetness value by a constant
 *    and quietly rescale the whole risk map.
 *  - The two logarithms are kept separate rather than folded into log(a/b).
 *    Folding is algebraically identical and marginally faster, but it changes
 *    the floating-point result in the last bits, and this is the expression a
 *    parity check against the QGIS plugin would compare.
 */

import { clamp } from "../core/clamp";

const DEG_TO_RAD = Math.PI / 180;

/**
 * Rainfall-weighted topographic wetness index.
 *
 * `rainfallScaled` is rainfall divided by its own catchment mean, so it is a
 * dimensionless multiplier near 1. Passing an array of ones gives the purely
 * topographic TWI, which is what the reference's standalone Network Index tool
 * computes.
 */
export function computeTwi(
  accum: Float64Array,
  slopeDeg: Float64Array,
  rainfallScaled: Float64Array,
  out?: Float64Array,
): Float64Array {
  const n = slopeDeg.length;
  const twi = out && out.length === n ? out : new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const s = slopeDeg[i];
    const a = accum[i];
    const r = rainfallScaled[i];
    if (!Number.isFinite(s) || !Number.isFinite(a) || !Number.isFinite(r)) {
      twi[i] = NaN;
      continue;
    }

    const slopeRad = clamp(s, 0, 89) * DEG_TO_RAD;
    const wetInput = Math.abs(a) * Math.max(r, 1e-6) + 1.0;
    const tanTerm = Math.tan(slopeRad + 0.001) + 0.001;
    if (wetInput <= 0 || tanTerm <= 0) {
      twi[i] = NaN;
      continue;
    }

    twi[i] = Math.log(wetInput) - Math.log(tanTerm);
  }
  return twi;
}

/**
 * Design runoff depth used to convert a feature's storage volume into the
 * upslope area whose runoff it can intercept, in metres.
 *
 * 20 mm is roughly the runoff a 1-in-30 event generates off arable land, so a
 * feature is rated by the area it can take out of circulation during the kind of
 * event that actually moves sediment.
 */
export const DESIGN_RUNOFF_DEPTH_M = 0.02;

/** Upslope area, in cells, whose design-storm runoff a given storage can hold. */
export function capacityCells(storageM3: number, cellAreaM2: number): number {
  return storageM3 / (DESIGN_RUNOFF_DEPTH_M * cellAreaM2);
}

/**
 * The TWI a cell effectively presents once a storage feature sits on it.
 *
 * Rather than inventing a magic number for "how much does a pond help", the
 * break is derived from the feature's own capacity. If it can hold the runoff
 * from `capacity` cells' worth of area, then the area still routing past it is
 * `max(0, accum - capacity)`, and re-evaluating the wetness expression with that
 * reduced area gives the value the cell now presents to everything upslope.
 *
 * The result is necessarily less than or equal to the original, and that is
 * precisely what licenses applying it as a single clamped write. The Network
 * Index is a *minimum* along the flow path, so lowering one cell's TWI caps the
 * index for every cell upslope that routes through it — exactly, with no
 * re-routing and no propagation step, for the cost of one array element.
 *
 * Note the direction. The operation is `min(existing, break)`: impose a *lower*
 * value. Inverting it would make ponds and dams increase apparent connectivity
 * while still producing a plausible-looking map, which is why nothing here is
 * called a "floor".
 */
export function storageBreakTwi(
  accum: number,
  slopeDeg: number,
  rainfallScaled: number,
  capacity: number,
): number {
  const remaining = Math.max(0, Math.abs(accum) - capacity);
  const slopeRad = clamp(slopeDeg, 0, 89) * DEG_TO_RAD;
  const wetInput = remaining * Math.max(rainfallScaled, 1e-6) + 1.0;
  const tanTerm = Math.tan(slopeRad + 0.001) + 0.001;
  return Math.log(wetInput) - Math.log(tanTerm);
}

/** A connectivity break: a cell, and the wetness it is held down to. */
export interface ConnectivityBreak {
  readonly cell: number;
  readonly twi: number;
}

/**
 * Clamp the given cells' wetness down, in place.
 *
 * Applied to the effective TWI just before the Network Index sweep, never to the
 * baseline TWI, so removing a feature restores the catchment exactly.
 */
export function applyConnectivityBreaks(
  twi: Float64Array,
  breaks: readonly ConnectivityBreak[],
): void {
  for (const { cell, twi: value } of breaks) {
    if (!Number.isFinite(value)) continue;
    if (value < twi[cell]) twi[cell] = value;
  }
}
