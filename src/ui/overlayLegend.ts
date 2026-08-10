/**
 * The risk map's legend.
 *
 * A colour ramp painted over terrain is not a risk map until the player knows
 * what the colours mean and which of the four layers they are looking at. The
 * legend carries the layer's name, a one-line statement of what it measures, and
 * the ramp itself with its ends labelled.
 *
 * The ends say "lower" and "higher" rather than numbers, and that is honest
 * rather than lazy: SCIMAP is a relative risk product with no physical units,
 * and printing "0.62" would invite a precision the model does not claim. What
 * the player needs is the ordering and the pattern.
 */

import { LAYER_STYLE, type LayerKey } from "../worker/overlayPack";
import { LUTS } from "../worker/ramps";

/** CSS gradient string sampled from the same lookup the overlay is packed with. */
export function rampGradient(ramp: keyof typeof LUTS): string {
  const lut = LUTS[ramp];
  const stops: string[] = [];
  const steps = 12;

  for (let i = 0; i <= steps; i++) {
    const index = Math.round((i / steps) * 255) * 3;
    const percent = Math.round((i / steps) * 100);
    stops.push(`rgb(${lut[index]},${lut[index + 1]},${lut[index + 2]}) ${percent}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export interface OverlayLegend {
  show(layer: LayerKey): void;
  dispose(): void;
}

const MARKUP = `
  <div class="legend" id="legend" hidden>
    <div class="legend__title" id="legend-title"></div>
    <div class="legend__description" id="legend-description"></div>
    <div class="legend__ramp" id="legend-ramp"></div>
    <div class="legend__ends"><span>lower</span><span>higher</span></div>
    <div class="legend__hint"><kbd>M</kbd> next layer &middot; <kbd>N</kbd> off</div>
  </div>
`;

export function createOverlayLegend(root: HTMLElement): OverlayLegend {
  root.insertAdjacentHTML("beforeend", MARKUP);

  const panel = root.querySelector("#legend") as HTMLElement;
  const title = root.querySelector("#legend-title") as HTMLElement;
  const description = root.querySelector("#legend-description") as HTMLElement;
  const ramp = root.querySelector("#legend-ramp") as HTMLElement;

  return {
    show(layer) {
      if (layer === "none") {
        panel.hidden = true;
        return;
      }
      const style = LAYER_STYLE[layer];
      title.textContent = style.label;
      description.textContent = style.description;
      ramp.style.background = rampGradient(style.ramp);
      panel.hidden = false;
    },

    dispose() {
      panel.remove();
    },
  };
}
