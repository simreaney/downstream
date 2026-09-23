/**
 * Playing a storm back.
 *
 * The worker computes the whole event in one go — a few seconds of routing —
 * and returns quantised depth snapshots plus both hydrographs. This plays that
 * back over roughly twenty seconds of wall clock, advancing the flood plane, the
 * chart and the sky together.
 *
 * Precomputing rather than streaming is a deliberate choice. A streamed storm
 * would have to hold the worker for its whole duration, which blocks the
 * recompute the player triggers the moment they see where the water goes; and a
 * dropped frame mid-storm would leave the flood plane stuck. Playback from a
 * finished result is interruptible, replayable and always smooth.
 */

import type { WorldScene } from "../render/scene";
import type { Sky } from "../render/sky";
import type { HydrographChart } from "../ui/hydrographChart";
import type { StormPlayback } from "../worker/client";

/** Wall-clock seconds a storm takes to play back. */
const PLAYBACK_SECONDS = 20;

/** Fraction of playback spent with the sky darkened. */
const RAIN_FRACTION = 0.55;

export interface StormPlayer {
  readonly running: boolean;
  /**
   * How hard it is raining, 0 to 1: up with the rain, down through the
   * recession, 0 between storms. The sky follows it here; the caller drives
   * the rain sound and the water's cloudiness from it, so each of those has a
   * single owner.
   */
  readonly storminess: number;
  start(playback: StormPlayback): void;
  update(dt: number): void;
  stop(): void;
}

export interface StormPlayerOptions {
  readonly scene: WorldScene;
  readonly sky: Sky;
  readonly chart: HydrographChart;
  readonly onFinished: (playback: StormPlayback) => void;
}

export function createStormPlayer(options: StormPlayerOptions): StormPlayer {
  const { scene, sky, chart } = options;

  let active: StormPlayback | null = null;
  let elapsed = 0;
  let storminess = 0;

  const finish = (): void => {
    const finished = active;
    active = null;
    scene.flood.clear();
    storminess = 0;
    sky.setStorminess(0);
    scene.water.setFlowRate(1);
    if (finished) options.onFinished(finished);
  };

  return {
    get running() {
      return active !== null;
    },

    get storminess() {
      return storminess;
    },

    start(playback) {
      active = playback;
      elapsed = 0;
      chart.show(
        `Storm — ${playback.depthMm.toFixed(0)} mm, about 1 in ${Math.round(
          playback.returnPeriodDays,
        )} days`,
      );
    },

    update(dt) {
      if (!active) return;
      elapsed += dt;

      const progress = Math.min(1, elapsed / PLAYBACK_SECONDS);

      scene.flood.setFrame(
        active.depthFrames,
        active.frameCount,
        progress * (active.frameCount - 1),
        active.depthScaleM,
      );

      chart.draw(
        { q: active.q, peakQ: active.peakQ, tPeakSeconds: active.tPeakSeconds },
        { q: active.baselineQ, peakQ: active.baselinePeakQ, tPeakSeconds: active.baselineTPeakSeconds },
        active.stepSeconds,
        progress,
      );

      // The sky darkens while it is raining and clears through the recession,
      // so the visual state tracks the hyetograph rather than the hydrograph —
      // the rain stops well before the river peaks, which is itself worth seeing.
      storminess =
        progress < RAIN_FRACTION
          ? Math.min(1, progress / (RAIN_FRACTION * 0.3))
          : Math.max(0, 1 - (progress - RAIN_FRACTION) / (1 - RAIN_FRACTION));
      sky.setStorminess(storminess);

      // The river's surface runs faster with discharge, so it follows the
      // hydrograph rather than the rain: it keeps quickening after the sky has
      // cleared, and settles back only on the recession.
      const step = Math.min(active.q.length - 1, Math.floor(progress * (active.q.length - 1)));
      const relative = active.peakQ > 0 ? active.q[step] / active.peakQ : 0;
      scene.water.setFlowRate(1 + 1.8 * Math.max(0, relative));

      if (progress >= 1) finish();
    },

    stop() {
      if (active) finish();
    },
  };
}
