/**
 * Pack a normalised risk layer into RGBA bytes for upload as a DataTexture.
 *
 * Packing happens in the worker, not on the main thread, for two reasons. The
 * layer arrays never leave the worker at all — only 256 KB of finished pixels
 * crosses per recompute, instead of half a megabyte of Float64 — and the main
 * thread's only job becomes `texture.needsUpdate = true`, which keeps the
 * placement frame clear of work that would show up as a hitch.
 *
 * Alpha carries "is there data here", which the terrain shader multiplies by its
 * own fade factor. That is what lets in-channel risk be drawn on the river alone
 * without a second texture or a branch in the shader.
 */

import { LUTS, type RampName } from "./ramps";

/** Which layer the overlay is currently showing. */
export type LayerKey = "none" | "connectivity" | "erosion" | "sourceRisk" | "inChannel";

/** Ramp and masking behaviour per layer. */
export const LAYER_STYLE: Record<
  Exclude<LayerKey, "none">,
  { ramp: RampName; channelOnly: boolean; label: string; description: string }
> = {
  connectivity: {
    ramp: "viridis",
    channelOnly: false,
    label: "Connectivity",
    description: "How reliably runoff here reaches a watercourse",
  },
  erosion: {
    ramp: "magma",
    channelOnly: false,
    label: "Erosion risk",
    description: "Sediment this ground can supply, given its cover and steepness",
  },
  sourceRisk: {
    ramp: "plasma",
    channelOnly: false,
    label: "Source risk",
    description: "Erodible AND connected — the places worth fixing",
  },
  inChannel: {
    ramp: "plasma",
    channelOnly: true,
    label: "In-channel risk",
    description: "Sediment concentration the river is actually carrying",
  },
};

/**
 * Write `layer` into `rgba` through the given ramp.
 *
 * Values are assumed already normalised to [0, 1] against the frozen baseline
 * bounds. Non-finite cells are written fully transparent so NoData reads as
 * absent rather than as a real zero at the bottom of the ramp.
 */
export function packOverlay(
  layer: Float64Array,
  ramp: RampName,
  rgba: Uint8Array,
  mask?: Uint8Array,
): void {
  const lut = LUTS[ramp];

  for (let i = 0; i < layer.length; i++) {
    const out = i * 4;
    const value = layer[i];

    if (!Number.isFinite(value) || (mask && !mask[i])) {
      rgba[out] = 0;
      rgba[out + 1] = 0;
      rgba[out + 2] = 0;
      rgba[out + 3] = 0;
      continue;
    }

    const index = (value <= 0 ? 0 : value >= 1 ? 255 : (value * 255 + 0.5) | 0) * 3;
    rgba[out] = lut[index];
    rgba[out + 1] = lut[index + 1];
    rgba[out + 2] = lut[index + 2];
    rgba[out + 3] = 255;
  }
}
