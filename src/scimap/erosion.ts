/**
 * Erosion risk: the source term of the SCIMAP product.
 *
 * `A * tan(beta)` is a stream-power proxy — the more area draining through a
 * place and the steeper it is, the more energy is available to detach and move
 * material. Multiplying by the land cover's relative erodibility turns available
 * energy into expected yield: the same slope under woodland and under bare
 * arable have very different sediment supply.
 *
 * This is the half of the model the player attacks by planting. Connectivity,
 * the other half, is what ponds and dams attack.
 */

import { clamp } from "../core/clamp";
import { applyStretch, deriveBounds, type Bounds } from "../core/normalise";
import { STRETCH_HIGH, STRETCH_LOW } from "./constants";

const DEG_TO_RAD = Math.PI / 180;

/**
 * Raw erosion risk, before normalisation.
 *
 * `riskWeight` is the per-cell land-cover erodibility. Slope is clamped to 89
 * degrees for the same reason as in the TWI: tan() is unbounded at 90 and a
 * single vertical cell would otherwise dominate the percentile stretch and
 * flatten every real signal in the catchment to nothing.
 */
export function computeErosionRisk(
  accum: Float64Array,
  slopeDeg: Float64Array,
  riskWeight: Float64Array,
  cellAreaM2: number,
  out?: Float64Array,
): Float64Array {
  const n = accum.length;
  const risk = out && out.length === n ? out : new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const a = accum[i];
    const s = slopeDeg[i];
    const w = riskWeight[i];
    if (!Number.isFinite(a) || !Number.isFinite(s) || !Number.isFinite(w)) {
      risk[i] = NaN;
      continue;
    }
    const value = Math.abs(a) * cellAreaM2 * Math.tan(clamp(s, 0, 89) * DEG_TO_RAD) * w;
    risk[i] = Number.isFinite(value) ? value : NaN;
  }
  return risk;
}

/** Derive the baseline erosion stretch. Catchment generation only. */
export function deriveErosionBounds(risk: Float64Array, valid?: Uint8Array): Bounds {
  return deriveBounds(risk, valid, STRETCH_LOW, STRETCH_HIGH);
}

/** Erosion risk rescaled to [0, 1] against the frozen baseline endpoints. */
export function normaliseErosion(
  risk: Float64Array,
  bounds: Bounds,
  out?: Float64Array,
  valid?: Uint8Array,
): Float64Array {
  const target = out && out.length === risk.length ? out : new Float64Array(risk.length);
  return applyStretch(risk, bounds, target, valid);
}

/**
 * Source risk: normalised erosion times normalised connectivity.
 *
 * Purely multiplicative, and that is the whole argument of SCIMAP in one line.
 * A highly erodible field that is hydrologically disconnected delivers nothing;
 * a perfectly connected woodland has nothing to deliver. Only the product
 * matters, which is why the player has two different kinds of tool and why
 * neither alone finishes the job.
 */
export function computeSourceRisk(
  erosionNormalised: Float64Array,
  connectivityNormalised: Float64Array,
  out?: Float64Array,
): Float64Array {
  const n = erosionNormalised.length;
  const source = out && out.length === n ? out : new Float64Array(n);
  for (let i = 0; i < n; i++) source[i] = erosionNormalised[i] * connectivityNormalised[i];
  return source;
}
