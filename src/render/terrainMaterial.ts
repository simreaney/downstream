/**
 * Terrain surface: land-cover colour, toon shading, and the risk overlay on top.
 *
 * Built on `MeshToonMaterial` rather than a custom ShaderMaterial so that three's
 * lighting, shadow mapping, fog and gradient-map quantisation all keep working —
 * a hand-written shader would mean reimplementing every one of them to get a
 * colour ramp composited over the surface.
 *
 * Both the base colour and the overlay are 256x256 nearest-filtered DataTextures
 * on the grid the model computes in. That is a deliberate look as well as a
 * cheap one: crisp cell edges read as a data product rather than a painting, and
 * blocky fields are squarely in the Animal Crossing register. Linear filtering
 * would blend adjacent land-cover classes into colours that belong to neither.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import { LandCover } from "../scimap/constants";
import { applyCurvature, type CurvatureUniforms } from "./curvature";

/**
 * Warm, saturated, low-contrast — the Animal Crossing palette.
 *
 * Arable is the odd one out and deliberately so: it is drawn as tilled earth
 * rather than as a crop, because it is the cover carrying five times the
 * erodibility of anything else and the player needs to pick it out at a glance,
 * from a hilltop, without turning the risk overlay on.
 */
export const COVER_COLOURS: Record<LandCover, [number, number, number]> = {
  [LandCover.Woodland]: [0x46, 0x7d, 0x40],
  [LandCover.Arable]: [0xbd, 0xa2, 0x74],
  [LandCover.ImprovedGrassland]: [0x8d, 0xb8, 0x5e],
  [LandCover.ExtensiveGrassland]: [0x9e, 0xb0, 0x74],
  [LandCover.Moorland]: [0x96, 0x8c, 0x72],
  [LandCover.Urban]: [0xbc, 0xac, 0x9c],
  [LandCover.Water]: [0x5a, 0xa9, 0xd6],
};

/**
 * Per-cell brightness jitter, as a fraction.
 *
 * Flat colour over a whole field reads as a texture-less plane once the toon
 * ramp has already flattened the shading. A few percent of deterministic
 * variation gives the surface some tooth without reading as noise.
 */
const JITTER = 0.028;

export function createLandCoverTexture(
  landCover: Uint8Array,
  spec: GridSpec,
): THREE.DataTexture {
  const data = new Uint8Array(landCover.length * 4);

  for (let i = 0; i < landCover.length; i++) {
    const colour = COVER_COLOURS[landCover[i] as LandCover] ?? COVER_COLOURS[LandCover.Moorland];

    // Hash the cell index rather than sampling noise, so the jitter is stable
    // across a reload and costs nothing to regenerate after a planting.
    let hash = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    hash ^= hash >>> 13;
    const jitter = 1 + (((hash >>> 8) & 0xff) / 255 - 0.5) * 2 * JITTER;

    data[i * 4] = Math.min(255, colour[0] * jitter);
    data[i * 4 + 1] = Math.min(255, colour[1] * jitter);
    data[i * 4 + 2] = Math.min(255, colour[2] * jitter);
    data[i * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, spec.width, spec.height, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Rewrite the colours of cells whose land cover changed, without reallocating. */
export function updateLandCoverTexture(
  texture: THREE.DataTexture,
  landCover: Uint8Array,
  cells: readonly number[],
): void {
  const data = texture.image.data as Uint8Array;
  for (const cell of cells) {
    const colour = COVER_COLOURS[landCover[cell] as LandCover];
    if (!colour) continue;
    data[cell * 4] = colour[0];
    data[cell * 4 + 1] = colour[1];
    data[cell * 4 + 2] = colour[2];
  }
  texture.needsUpdate = true;
}

/** The risk overlay texture the worker packs into. */
export function createOverlayTexture(rgba: Uint8Array, spec: GridSpec): THREE.DataTexture {
  const texture = new THREE.DataTexture(rgba, spec.width, spec.height, THREE.RGBAFormat);
  // Nearest, so the risk map reads as discrete cells of data rather than a
  // smeared gradient. This is the one place blockiness is the point.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export interface TerrainMaterial {
  readonly material: THREE.MeshToonMaterial;
  /** 0 hides the risk overlay, 1 shows it fully. Animated on the M key. */
  setOverlayMix(value: number): void;
  swapOverlay(texture: THREE.Texture): void;
}

export interface TerrainMaterialOptions {
  readonly landCover: THREE.Texture;
  readonly overlay: THREE.Texture;
  readonly gradientMap: THREE.Texture;
  readonly curvature: CurvatureUniforms;
}

export function createTerrainMaterial(options: TerrainMaterialOptions): TerrainMaterial {
  const uOverlay = { value: options.overlay };
  const uOverlayMix = { value: 0 };

  const material = new THREE.MeshToonMaterial({
    map: options.landCover,
    gradientMap: options.gradientMap,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOverlay = uOverlay;
    shader.uniforms.uOverlayMix = uOverlayMix;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform sampler2D uOverlay;
        uniform float uOverlayMix;`,
      )
      // After map_fragment so the overlay sits on top of the land-cover colour,
      // and before lighting so it is still shaded by the toon ramp — the risk
      // map should be painted onto the landscape, not floating above it.
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
        vec4 cwOverlay = texture2D(uOverlay, vMapUv);
        diffuseColor.rgb = mix(diffuseColor.rgb, cwOverlay.rgb, cwOverlay.a * uOverlayMix);`,
      );
  };

  applyCurvature(material, options.curvature, "terrain-overlay");

  return {
    material,
    setOverlayMix(value) {
      uOverlayMix.value = value;
    },
    swapOverlay(texture) {
      uOverlay.value = texture;
    },
  };
}
