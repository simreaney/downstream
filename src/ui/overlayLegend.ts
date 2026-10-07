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

import { onLocaleChange, t } from "../i18n";
import { LAYER_STYLE, type LayerKey } from "../worker/overlayPack";
import { LUTS } from "../worker/ramps";
import { escapeHtml, kbd, keyLabel } from "./keys";

/** A risk layer's translated name and one-line description. */
export function layerText(layer: Exclude<LayerKey, "none">): { label: string; description: string } {
  return { label: t(`layer.${layer}`), description: t(`layer.${layer}.description`) };
}

/** "M next layer · N off", with the keys as this keyboard prints them. */
export function layerKeyHint(): string {
  return `${kbd(keyLabel("KeyM"))} ${escapeHtml(t("hint.nextLayer"))} &middot; ${kbd(keyLabel("KeyN"))} ${escapeHtml(t("hint.off"))}`;
}

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
    <div class="legend__ends"><span id="legend-lower"></span><span id="legend-higher"></span></div>
    <div class="legend__hint" id="legend-hint"></div>
  </div>
`;

export function createOverlayLegend(root: HTMLElement): OverlayLegend {
  root.insertAdjacentHTML("beforeend", MARKUP);

  const panel = root.querySelector("#legend") as HTMLElement;
  const title = root.querySelector("#legend-title") as HTMLElement;
  const description = root.querySelector("#legend-description") as HTMLElement;
  const ramp = root.querySelector("#legend-ramp") as HTMLElement;
  const lower = root.querySelector("#legend-lower") as HTMLElement;
  const higher = root.querySelector("#legend-higher") as HTMLElement;
  const hint = root.querySelector("#legend-hint") as HTMLElement;

  let shown: LayerKey = "none";

  const show = (layer: LayerKey): void => {
    shown = layer;
    if (layer === "none") {
      panel.hidden = true;
      return;
    }
    const text = layerText(layer);
    title.textContent = text.label;
    description.textContent = text.description;
    ramp.style.background = rampGradient(LAYER_STYLE[layer].ramp);
    panel.hidden = false;
  };

  const relabel = (): void => {
    lower.textContent = t("legend.lower");
    higher.textContent = t("legend.higher");
    hint.innerHTML = layerKeyHint();
    show(shown);
  };
  relabel();
  const stopLabelling = onLocaleChange(relabel);

  return {
    show,

    dispose() {
      stopLabelling();
      panel.remove();
    },
  };
}
