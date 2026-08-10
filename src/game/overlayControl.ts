/**
 * Which risk layer is on screen, and how it gets there.
 *
 * Three responsibilities that have to stay together: the cycle order on the M
 * key, the cross-fade so a layer change is a dissolve rather than a jump cut,
 * and returning spent overlay buffers to the worker's pool.
 *
 * The cross-fade matters more than it sounds. The overlay is a flat wash of
 * colour over the whole catchment, and snapping it on hides the terrain
 * instantly — the player loses their bearings and has to re-find where they
 * were. A quarter-second dissolve keeps the landscape and the data registered
 * against each other while one becomes the other.
 */

import { approach } from "../core/clamp";
import type { LayerKey } from "../worker/overlayPack";
import type { SimClient } from "../worker/client";

/**
 * Cycle order.
 *
 * Source risk comes first because it is the layer the player acts on — where
 * erodible ground is also connected. The two halves that produce it follow, so
 * pressing M again answers "why is it high there?", and in-channel risk last
 * because it is the consequence rather than the cause.
 */
export const LAYER_CYCLE: readonly LayerKey[] = [
  "sourceRisk",
  "connectivity",
  "erosion",
  "inChannel",
];

/** How strongly the risk map washes out the land-cover colour when fully on. */
const FULL_MIX = 0.88;

/** Seconds to close roughly 63% of the gap; a dissolve, not a jump cut. */
const FADE_TAU = 0.09;

export interface OverlayControlOptions {
  readonly sim: SimClient;
  readonly setMix: (value: number) => void;
  readonly setOverlay: (rgba: Uint8Array<ArrayBuffer>) => void;
  readonly onLayerChange: (layer: LayerKey) => void;
}

export interface OverlayControl {
  readonly layer: LayerKey;
  next(): void;
  off(): void;
  /** Adopt a freshly recomputed overlay, recycling the one it replaces. */
  adopt(rgba: Uint8Array<ArrayBuffer>): void;
  update(dt: number): void;
}

export function createOverlayControl(options: OverlayControlOptions): OverlayControl {
  const { sim, setMix, setOverlay, onLayerChange } = options;

  let layer: LayerKey = "none";
  let target = 0;
  let current = 0;
  let inFlight: Promise<unknown> | null = null;
  let live: Uint8Array<ArrayBuffer> | null = null;

  const applyMix = (): void => setMix(current);
  applyMix();

  /** Hand the previous buffer back so the worker can pack into it again. */
  const swap = (rgba: Uint8Array<ArrayBuffer>): void => {
    const previous = live;
    live = rgba;
    setOverlay(rgba);
    // Only after the texture points at the new array, because releasing
    // transfers the buffer away and detaches it.
    if (previous && previous.buffer !== rgba.buffer) sim.release(previous.buffer);
  };

  const request = (next: LayerKey): void => {
    layer = next;
    onLayerChange(next);
    target = next === "none" ? 0 : FULL_MIX;

    if (next === "none") return;

    // The worker repacks rather than the main thread holding four textures: one
    // 256 KB buffer round-trips in well under a frame, and keeping a single
    // texture means a placement never has to update more than one of them.
    inFlight = sim
      .setLayer(next)
      .then((result) => swap(result.overlay))
      .catch((error: unknown) => console.error("overlay layer change failed", error))
      .finally(() => {
        inFlight = null;
      });
  };

  return {
    get layer() {
      return layer;
    },

    next() {
      // Skip while a change is still resolving, or fast presses queue up
      // repacks the player will never see.
      if (inFlight) return;
      const index = LAYER_CYCLE.indexOf(layer);
      request(LAYER_CYCLE[(index + 1) % LAYER_CYCLE.length]);
    },

    off() {
      if (layer === "none") return;
      layer = "none";
      onLayerChange("none");
      target = 0;
    },

    adopt(rgba) {
      swap(rgba);
    },

    update(dt) {
      if (current === target) return;
      current = approach(current, target, FADE_TAU, dt);
      if (Math.abs(current - target) < 0.002) current = target;
      applyMix();
    },
  };
}
