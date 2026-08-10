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

  const finish = (): void => {
    const finished = active;
    active = null;
    scene.flood.clear();
    sky.setStorminess(0);
    scene.water.setTurbidity(0);
    if (finished) options.onFinished(finished);
  };

  return {
    get running() {
      return active !== null;
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
        {
          q: active.q,
          turbidity: active.q,
          peakQ: active.peakQ,
          tPeakSeconds: active.tPeakSeconds,
          volumeM3: 0,
        },
        {
          q: active.baselineQ,
          turbidity: active.baselineQ,
          peakQ: active.baselinePeakQ,
          tPeakSeconds: active.baselineTPeakSeconds,
          volumeM3: 0,
        },
        active.stepSeconds,
        progress,
      );

      // The sky darkens while it is raining and clears through the recession,
      // so the visual state tracks the hyetograph rather than the hydrograph —
      // the rain stops well before the river peaks, which is itself worth seeing.
      const storminess =
        progress < RAIN_FRACTION
          ? Math.min(1, progress / (RAIN_FRACTION * 0.3))
          : Math.max(0, 1 - (progress - RAIN_FRACTION) / (1 - RAIN_FRACTION));
      sky.setStorminess(storminess);
      scene.water.setTurbidity(storminess * 0.6);

      if (progress >= 1) finish();
    },

    stop() {
      if (active) finish();
    },
  };
}
