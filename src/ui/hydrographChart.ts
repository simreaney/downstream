/**
 * The hydrograph: this storm against the storm that would have happened.
 *
 * A solid line for the catchment as the player has built it, dashed for the
 * counterfactual — the same rainfall over the same terrain with every pond, dam
 * and planting removed. Both are computed from this event, so the comparison is
 * a measurement rather than a memory of some earlier, differently sized storm.
 *
 * This is the artefact that makes the flood half of the game legible, and the
 * one most likely to be scrutinised by someone who knows what a hydrograph
 * should look like. So it reports what the literature reports: peak discharge
 * and time to peak.
 */

import type { Hydrograph } from "../sim/storm";

const MARKUP = `
  <div class="hydrograph" id="hydrograph" hidden>
    <div class="hydrograph__head">
      <div class="hydrograph__heading">
        <span id="hydrograph-title">Storm</span>
        <span class="hydrograph__stat" id="hydrograph-stat"></span>
      </div>
      <button class="hydrograph__close" id="hydrograph-close" type="button" aria-label="Close">&times;</button>
    </div>
    <canvas id="hydrograph-canvas" width="440" height="150"></canvas>
    <div class="hydrograph__key">
      <span><i class="hydrograph__swatch"></i>with your work</span>
      <span><i class="hydrograph__swatch hydrograph__swatch--dashed"></i>without</span>
    </div>
  </div>
`;

export interface HydrographChart {
  show(title: string): void;
  /** Draw up to `progress` of the way through the run, for live playback. */
  draw(current: Hydrograph, baseline: Hydrograph, stepSeconds: number, progress: number): void;
  hide(): void;
  dispose(): void;
}

export function createHydrographChart(root: HTMLElement): HydrographChart {
  root.insertAdjacentHTML("beforeend", MARKUP);

  const panel = root.querySelector("#hydrograph") as HTMLElement;
  const title = root.querySelector("#hydrograph-title") as HTMLElement;
  const stat = root.querySelector("#hydrograph-stat") as HTMLElement;
  const closeButton = root.querySelector("#hydrograph-close") as HTMLButtonElement;
  const canvas = root.querySelector("#hydrograph-canvas") as HTMLCanvasElement;
  const context = canvas.getContext("2d");

  // Draw at device resolution so the lines are not soft on a retina display.
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.width;
  const height = canvas.height;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context?.scale(ratio, ratio);

  const plot = (
    ctx: CanvasRenderingContext2D,
    series: Float32Array,
    upTo: number,
    peak: number,
    dashed: boolean,
  ): void => {
    const padding = { left: 34, right: 8, top: 8, bottom: 20 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    ctx.beginPath();
    ctx.setLineDash(dashed ? [4, 4] : []);
    ctx.lineWidth = dashed ? 1.5 : 2.2;
    ctx.strokeStyle = dashed ? "rgba(61,50,38,0.45)" : "#2f7d5c";

    for (let step = 0; step <= upTo && step < series.length; step++) {
      const x = padding.left + (step / (series.length - 1)) * plotWidth;
      const y = padding.top + plotHeight * (1 - series[step] / peak);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const api: HydrographChart = {
    show(text) {
      title.textContent = text;
      panel.hidden = false;
    },

    draw(current, baseline, stepSeconds, progress) {
      if (!context) return;
      const padding = { left: 34, right: 8, top: 8, bottom: 20 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;

      context.clearRect(0, 0, width, height);

      // Both series share one scale, or the comparison is meaningless.
      const peak = Math.max(current.peakQ, baseline.peakQ) * 1.12 || 1;

      context.strokeStyle = "rgba(61,50,38,0.18)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(padding.left, padding.top);
      context.lineTo(padding.left, padding.top + plotHeight);
      context.lineTo(padding.left + plotWidth, padding.top + plotHeight);
      context.stroke();

      context.fillStyle = "rgba(61,50,38,0.55)";
      context.font = "10px system-ui, sans-serif";
      context.textAlign = "right";
      context.fillText(peak.toFixed(1), padding.left - 4, padding.top + 8);
      context.fillText("0", padding.left - 4, padding.top + plotHeight);
      context.textAlign = "center";
      const hours = ((current.q.length - 1) * stepSeconds) / 3600;
      context.fillText(`${hours.toFixed(0)} h`, padding.left + plotWidth, height - 6);
      context.textAlign = "left";
      context.fillText("m³/s", padding.left - 30, padding.top - 1);

      const upTo = Math.floor(progress * (current.q.length - 1));
      plot(context, baseline.q, upTo, peak, true);
      plot(context, current.q, upTo, peak, false);

      // Only claim a reduction once the run has passed both peaks, or the
      // headline figure flickers while the rising limbs are still climbing.
      const settled = progress >= 0.999;
      if (settled && baseline.peakQ > 0) {
        const cut = (1 - current.peakQ / baseline.peakQ) * 100;
        const delay = (current.tPeakSeconds - baseline.tPeakSeconds) / 60;
        stat.textContent =
          cut > 0.5
            ? `peak −${cut.toFixed(0)}%${delay > 1 ? `, ${delay.toFixed(0)} min later` : ""}`
            : "no measurable change";
      } else {
        stat.textContent = "";
      }
    },

    hide() {
      panel.hidden = true;
    },

    dispose() {
      panel.remove();
    },
  };

  closeButton.addEventListener("click", () => api.hide());

  return api;
}
