/**
 * Catchment health, as three bars and a headline.
 *
 * Three bars rather than one number, because the three tools act on different
 * processes and a single figure would hide that. A player who has only planted
 * sees Water Quality climbing while Flood Risk sits still, which is the point.
 *
 * Each bar carries a trend arrow when it moves, because most changes are small —
 * one tree in a square kilometre moves a percentage point at most, and without
 * the arrow the player cannot tell whether their last action did anything at
 * all. The arrow is the difference between a score and feedback.
 */

import type { Scores } from "../game/scoring";

const BARS: { key: keyof Scores; label: string; hint: string }[] = [
  { key: "waterQuality", label: "Water quality", hint: "sediment reaching the fishery" },
  { key: "floodRisk", label: "Flood risk", hint: "peak flow at the village" },
  { key: "habitat", label: "Habitat", hint: "continuous riverside cover" },
];

const MARKUP = `
  <div class="score" id="score">
    <div class="score__head">
      <span>Catchment health</span>
      <strong id="score-overall">0</strong>
    </div>
    <div id="score-bars"></div>
  </div>
`;

export interface ScorePanel {
  set(scores: Scores): void;
  dispose(): void;
}

export function createScorePanel(root: HTMLElement): ScorePanel {
  root.insertAdjacentHTML("beforeend", MARKUP);

  const overall = root.querySelector("#score-overall") as HTMLElement;
  const container = root.querySelector("#score-bars") as HTMLElement;

  container.innerHTML = BARS.map(
    (bar) => `
    <div class="score__row" title="${bar.hint}">
      <span class="score__label">${bar.label}</span>
      <span class="score__track"><i id="score-${bar.key}"></i></span>
      <span class="score__value" id="score-${bar.key}-value">0</span>
      <span class="score__trend" id="score-${bar.key}-trend"></span>
    </div>`,
  ).join("");

  const previous = new Map<string, number>();
  let trendTimer = 0;

  return {
    set(scores) {
      overall.textContent = String(Math.round(scores.overall));

      for (const bar of BARS) {
        const value = scores[bar.key];
        const fill = root.querySelector(`#score-${bar.key}`) as HTMLElement;
        const label = root.querySelector(`#score-${bar.key}-value`) as HTMLElement;
        const trend = root.querySelector(`#score-${bar.key}-trend`) as HTMLElement;

        fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
        label.textContent = String(Math.round(value));

        const was = previous.get(bar.key);
        // A tenth of a point is below what the rounded number can show, so
        // anything smaller would be an arrow pointing at no visible change.
        if (was !== undefined && Math.abs(value - was) > 0.1) {
          trend.textContent = value > was ? "▲" : "▼";
          trend.className = `score__trend score__trend--${value > was ? "up" : "down"}`;
        }
        previous.set(bar.key, value);
      }

      window.clearTimeout(trendTimer);
      trendTimer = window.setTimeout(() => {
        for (const bar of BARS) {
          const trend = root.querySelector(`#score-${bar.key}-trend`) as HTMLElement;
          trend.textContent = "";
        }
      }, 3200);
    },

    dispose() {
      window.clearTimeout(trendTimer);
      (root.querySelector("#score") as HTMLElement | null)?.remove();
    },
  };
}
