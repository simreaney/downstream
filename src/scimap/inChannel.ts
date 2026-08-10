/**
 * In-channel risk: the concentration of delivered sediment carried by each reach.
 *
 * ## Deliberate divergence from the shipped SCIMAP code
 *
 * The reference implementation (`geolibre_plugin/src/core/combine.ts`, lines
 * 80-87) computes
 *
 *     riskConcentration[i] = (sourceRisk[i] * catchmentArea[i])
 *                          / (catchmentArea[i] * rainfallScaled[i] + tiny)
 *
 * in which `catchmentArea` cancels algebraically, and `sourceRisk[i]` is the
 * cell's own local value — never integrated over anything upslope. What comes
 * out is `sourceRisk[i] / rainfallScaled[i]`: a purely local quantity wearing
 * the name of a routed one. The author labels these outputs "proxies", so this
 * is a known simplification rather than a defect, and for producing a relative
 * risk map it is defensible.
 *
 * It cannot work here. This game's entire proposition is that an action taken
 * upstream changes the water downstream — the river runs clearer past the
 * fishery because the player planted a buffer half a kilometre above it. Under
 * the local form, planting a field changes that field's colour and nothing else,
 * and the fishery never responds.
 *
 * So this uses the form the quantity is named for:
 *
 *     inChannel(x) = sum over upslope of (sourceRisk * cellArea)
 *                  / sum over upslope of (cellArea * rainfallScaled)
 *
 * Both sums are flow-accumulated through the *same* FD8 fractions, so the ratio
 * is a genuine flow-weighted mean of `sourceRisk / rainfallScaled` over
 * everything draining to x, and is bounded by that quantity's extremes over the
 * contributing area. Dividing by routed rainfall-weighted area rather than by
 * area alone is what makes it a concentration: a wet upland tributary carrying
 * the same sediment load as a dry one is the less polluted water.
 *
 * `cellArea` is constant on a regular grid and cancels from the ratio just as it
 * does in the reference. It is kept in the expressions for dimensional clarity,
 * and because a future variable-resolution grid would need it.
 */

import type { GridSpec } from "../core/grid";
import { cellAreaM2 } from "../core/grid";
import { applyStretch, deriveBounds, type Bounds } from "../core/normalise";
import { accumulatePair, type Fd8Table } from "./fd8";
import { STRETCH_HIGH, STRETCH_LOW } from "./constants";

/** Guard against dividing by a vanishing contributing area at ridge cells. */
const TINY = 1e-10;

export interface InChannelScratch {
  readonly loadWeights: Float64Array;
  readonly dilutionWeights: Float64Array;
  readonly routedLoad: Float64Array;
  readonly routedDilution: Float64Array;
}

export function createInChannelScratch(n: number): InChannelScratch {
  return {
    loadWeights: new Float64Array(n),
    dilutionWeights: new Float64Array(n),
    routedLoad: new Float64Array(n),
    routedDilution: new Float64Array(n),
  };
}

/**
 * Flow-weighted mean source risk delivered to every cell.
 *
 * Both accumulations share one sweep — see `accumulatePair` — because these
 * passes scatter into memory and are bandwidth-bound, so walking the grid twice
 * would cost close to twice as much for identical arithmetic.
 */
export function computeInChannelRisk(
  sourceRisk: Float64Array,
  rainfallScaled: Float64Array,
  table: Fd8Table,
  spec: GridSpec,
  scratch: InChannelScratch,
  out?: Float64Array,
): Float64Array {
  const n = sourceRisk.length;
  const area = cellAreaM2(spec);
  const result = out && out.length === n ? out : new Float64Array(n);

  const { loadWeights, dilutionWeights, routedLoad, routedDilution } = scratch;
  for (let i = 0; i < n; i++) {
    const risk = sourceRisk[i];
    const rain = rainfallScaled[i];
    loadWeights[i] = Number.isFinite(risk) ? risk * area : 0;
    dilutionWeights[i] = Number.isFinite(rain) ? area * rain : 0;
  }

  accumulatePair(table, spec, loadWeights, dilutionWeights, routedLoad, routedDilution);

  for (let i = 0; i < n; i++) {
    result[i] = routedLoad[i] / (routedDilution[i] + TINY);
  }
  return result;
}

/**
 * Derive the baseline in-channel stretch from channel cells only.
 *
 * Hillslope cells carry an in-channel value too — the ratio is defined
 * everywhere — but they are the overwhelming majority and would dominate the
 * percentiles, compressing the actual river's range into the bottom of the ramp
 * where none of its variation is visible.
 */
export function deriveInChannelBounds(
  inChannel: Float64Array,
  channelMask: Uint8Array,
): Bounds {
  return deriveBounds(inChannel, channelMask, STRETCH_LOW, STRETCH_HIGH);
}

/** In-channel risk rescaled to [0, 1] against the frozen baseline endpoints. */
export function normaliseInChannel(
  inChannel: Float64Array,
  bounds: Bounds,
  out?: Float64Array,
): Float64Array {
  const target =
    out && out.length === inChannel.length ? out : new Float64Array(inChannel.length);
  return applyStretch(inChannel, bounds, target);
}
