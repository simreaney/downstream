/**
 * The prop contract.
 *
 * Everything placeable in the world — trees, rocks, dams, buildings, the player
 * — is built here from three.js primitives, with no binary assets and no loader.
 * The repo stays small, deploys as static files, and every prop is a handful of
 * numbers that can be tuned without opening a modelling package.
 *
 * The indirection exists so that stays a choice rather than a commitment. A prop
 * is requested by id and returns geometry-plus-material parts; nothing that
 * places a tree knows how the tree was made. Swapping one factory for a GLTF
 * loader later touches that factory and nothing else.
 *
 * A prop is a *list* of parts rather than one mesh because instancing needs one
 * geometry-material pair per draw call. A tree is a trunk part and a canopy
 * part, drawn as two InstancedMeshes sharing the same per-instance transforms —
 * two draw calls for four thousand trees.
 */

import * as THREE from "three";
import type { CurvatureUniforms } from "../render/curvature";
import { applyCurvature } from "../render/curvature";
import { applyOcclusionFade, type OcclusionFade } from "../render/occlusionFade";
import { applySoftFinish, bakeSoftAo } from "../render/softFinish";

export interface PropPart {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
}

export interface PropAsset {
  readonly parts: readonly PropPart[];
  /** Approximate radius in metres, for spacing and targeting. */
  readonly radius: number;
  /** Approximate height in metres. */
  readonly height: number;
}

/** Shared resources every prop factory needs. */
export interface PropContext {
  readonly curvature: CurvatureUniforms;
  readonly gradientMap: THREE.Texture;
  /** Sight line along which props dither away so the player stays visible. */
  readonly fade: OcclusionFade;
  /**
   * Toon material for a flat colour, shared between props that use it.
   *
   * Reads vertex colours, which carry the occlusion `part()` bakes — so any
   * geometry drawn with one of these must go through `part()` or
   * `bakeSoftAo`, or it renders black.
   */
  material(colour: number): THREE.Material;
}

export type PropFactory = (context: PropContext) => PropAsset;

/**
 * Build a prop context with a material cache.
 *
 * Materials are cached by colour because three compiles one program per
 * material, and a few hundred trees each with their own would mean a few hundred
 * compilations at load. Instance colour handles the variation instead.
 */
export function createPropContext(
  curvature: CurvatureUniforms,
  gradientMap: THREE.Texture,
  fade: OcclusionFade,
): PropContext {
  const cache = new Map<number, THREE.Material>();

  return {
    curvature,
    gradientMap,
    fade,
    material(colour) {
      const existing = cache.get(colour);
      if (existing) return existing;

      const material = new THREE.MeshToonMaterial({
        color: colour,
        gradientMap,
        vertexColors: true,
      });
      applySoftFinish(material, "prop");
      applyOcclusionFade(material, fade);
      // Props are bent by the same rule as the ground they stand on, or they
      // would float above it at distance. A distinct variant name keeps their
      // compiled program separate from the terrain's, which also injects the
      // risk overlay.
      applyCurvature(material, curvature, "prop");
      cache.set(colour, material);
      return material;
    },
  };
}

/**
 * A geometry-material pair, with soft occlusion baked into the geometry.
 *
 * Assumes the geometry's origin is where the prop meets the ground, which is
 * true of every factory in this directory.
 */
export function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: { castShadow?: boolean; receiveShadow?: boolean } = {},
): PropPart {
  return {
    geometry: bakeSoftAo(geometry),
    material,
    castShadow: options.castShadow ?? true,
    receiveShadow: options.receiveShadow ?? true,
  };
}
