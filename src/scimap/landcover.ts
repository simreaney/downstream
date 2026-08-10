/**
 * Land cover to risk weights.
 *
 * The land-cover array is the player's half of the model: planting a tree writes
 * one byte here, and everything from the erosion term to the score follows from
 * it. Keeping the weight lookup as a plain table indexed by class means a
 * placement is a single array write plus a single weight write, with no
 * recomputation of anything that did not change.
 */

import { EROSION_WEIGHTS, LandCover, RUNOFF_WEIGHTS } from "./constants";

/** Flat lookup indexed by class id, so hot loops avoid an object property read. */
function buildLookup(weights: Readonly<Record<LandCover, number>>): Float64Array {
  const table = new Float64Array(16);
  for (const [key, value] of Object.entries(weights)) table[Number(key)] = value;
  return table;
}

export const EROSION_WEIGHT_LUT = buildLookup(EROSION_WEIGHTS);
export const RUNOFF_WEIGHT_LUT = buildLookup(RUNOFF_WEIGHTS);

/** Per-cell erodibility from the land-cover classes. */
export function buildRiskWeight(
  landCover: Uint8Array,
  out?: Float64Array,
): Float64Array {
  const n = landCover.length;
  const weights = out && out.length === n ? out : new Float64Array(n);
  for (let i = 0; i < n; i++) weights[i] = EROSION_WEIGHT_LUT[landCover[i]];
  return weights;
}

/** Per-cell runoff generation potential. Not the same concept as erodibility. */
export function buildRunoffWeight(
  landCover: Uint8Array,
  out?: Float64Array,
): Float64Array {
  const n = landCover.length;
  const weights = out && out.length === n ? out : new Float64Array(n);
  for (let i = 0; i < n; i++) weights[i] = RUNOFF_WEIGHT_LUT[landCover[i]];
  return weights;
}

/** Land covers a player may plant over. */
export function isPlantable(cover: LandCover): boolean {
  return (
    cover === LandCover.Arable ||
    cover === LandCover.ImprovedGrassland ||
    cover === LandCover.ExtensiveGrassland ||
    cover === LandCover.Moorland
  );
}

/**
 * Which way the erosion source term moves if this cover is planted.
 *
 * Negative means planting lowers erodibility here, positive means it raises it.
 * Both happen: woodland is 0.2 and extensive grassland is 0.15, so planting
 * rough grazing genuinely makes the modelled source term slightly worse, while
 * arable at 1.0 improves fivefold.
 *
 * **Land use may be changed in any direction.** This is reported, never
 * enforced. A player who plants a hillside of rough grazing and watches the map
 * fail to improve has learned something real about targeting — and a change that
 * makes the model worse is still a legitimate thing to try and see. Blocking it
 * would substitute the game's judgement for the player's, which is precisely
 * what the risk map exists to avoid.
 */
export function plantingDelta(cover: LandCover): number {
  return EROSION_WEIGHT_LUT[LandCover.Woodland] - EROSION_WEIGHT_LUT[cover];
}

/** Convenience: does planting here lower the source term? */
export function isWorthPlanting(cover: LandCover): boolean {
  return plantingDelta(cover) < 0;
}
