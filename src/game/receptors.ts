/**
 * The village and the fishery: what the score looks like from the ground.
 *
 * Numbers on a panel are a report; fish returning to a clearing pool is a
 * consequence. These two receptors turn the model's output into something the
 * player sees while walking past, which is the difference between being told
 * their catchment improved and watching it.
 *
 * Both respond with a **lag**. Clarity recovers over about a game day rather
 * than snapping to the new value, and the fish count has a hysteresis band so it
 * does not flicker while clarity hovers on a threshold. That damping is doing
 * real work: an instant response reads as a slider being dragged, while a slow
 * one reads as recovery, which is both truer to ecology and more satisfying.
 */

import { approach, clamp01, smoothstep } from "../core/clamp";
import type { Scores } from "./scoring";

export interface ReceptorState {
  /** 0 turbid, 1 clear. Drives the water shader and the fish. */
  readonly fisheryClarity: number;
  readonly fishCount: number;
  /** Peak depth from the last storm, decaying over a couple of game days. */
  readonly villageFloodDepthM: number;
  /** 0 unscathed, 1 sandbagged, 2 damaged. */
  readonly villageDamage: 0 | 1 | 2;
}

export const MAX_FISH = 26;

/** Seconds for clarity to close most of the gap to its target. */
const CLARITY_TAU = 90;
/** Seconds over which flood water drains from the village. */
const FLOOD_DRAIN_TAU = 45;

/** Depth at which the village is considered damaged, in metres. */
const DAMAGE_DEPTH_M = 0.35;
const SANDBAG_DEPTH_M = 0.1;

export function initialReceptors(): ReceptorState {
  return {
    fisheryClarity: 0,
    fishCount: 0,
    villageFloodDepthM: 0,
    villageDamage: 0,
  };
}

export function updateReceptors(
  previous: ReceptorState,
  scores: Scores,
  dt: number,
): ReceptorState {
  // Water quality is the target clarity, but the bottom of the range is not
  // zero: even a degraded catchment's river is water, not soup.
  const targetClarity = clamp01(0.12 + 0.88 * (scores.waterQuality / 100));
  const fisheryClarity = approach(previous.fisheryClarity, targetClarity, CLARITY_TAU, dt);

  // Fish need a threshold crossed, not a proportion — and a band around it, so a
  // clarity hovering at the edge does not make the shoal blink in and out.
  const lower = previous.fishCount > 0 ? 0.22 : 0.3;
  const population = smoothstep(lower, 0.92, fisheryClarity);
  const fishCount = Math.round(Math.pow(population, 1.4) * MAX_FISH);

  const villageFloodDepthM = approach(previous.villageFloodDepthM, 0, FLOOD_DRAIN_TAU, dt);
  const villageDamage: 0 | 1 | 2 =
    villageFloodDepthM > DAMAGE_DEPTH_M ? 2 : villageFloodDepthM > SANDBAG_DEPTH_M ? 1 : 0;

  return { fisheryClarity, fishCount, villageFloodDepthM, villageDamage };
}

/** Record a storm's effect on the village, to decay from over the next days. */
export function floodVillage(state: ReceptorState, depthM: number): ReceptorState {
  return { ...state, villageFloodDepthM: Math.max(state.villageFloodDepthM, depthM) };
}
