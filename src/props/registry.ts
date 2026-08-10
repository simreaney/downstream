/**
 * Prop lookup by id, built once and shared.
 *
 * Memoised because the geometry for a tree is the same object for every tree in
 * the catchment — instancing depends on that being true. Asking for a prop twice
 * and getting two geometries would silently double the draw calls.
 */

import type { PropAsset, PropContext, PropFactory } from "./types";

export type PropId =
  | "treeBroadleaf"
  | "treeConifer"
  | "treeWillow"
  | "sapling"
  | "rock"
  | "dam"
  | "logPile"
  | "spade"
  | "cottageA"
  | "cottageB"
  | "fisheryHut"
  | "fish"
  | "player";

const factories = new Map<PropId, PropFactory>();
const built = new Map<PropId, PropAsset>();

export function registerProp(id: PropId, factory: PropFactory): void {
  factories.set(id, factory);
}

export function getProp(id: PropId, context: PropContext): PropAsset {
  const existing = built.get(id);
  if (existing) return existing;

  const factory = factories.get(id);
  if (!factory) throw new Error(`No prop registered for "${id}"`);

  const asset = factory(context);
  built.set(id, asset);
  return asset;
}

/** Drop built assets, e.g. when regenerating the catchment. */
export function clearProps(): void {
  for (const asset of built.values()) {
    for (const p of asset.parts) p.geometry.dispose();
  }
  built.clear();
}
