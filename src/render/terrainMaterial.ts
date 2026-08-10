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
 * Wavelengths of the three octaves of ground detail, in metres.
 *
 * Chosen around the 4 m cell rather than arbitrarily. The mottle is far coarser
 * than a cell, so it reads as damp ground and worn patches drifting across a
 * field without ever looking like data. The grain and the tooth are finer than a
 * cell, which is the point: nearest filtering magnifies a cell into a flat
 * 4 m square of colour, and standing on one is where the ground looks most like
 * painted cardboard. Detail below the cell size breaks that up close without
 * touching what the map says.
 */
const MOTTLE_M = 34;
const GRAIN_M = 2.6;
const TOOTH_M = 0.85;

/**
 * Brightness swing of each octave, as a fraction.
 *
 * These are peak-to-peak on noise whose standard deviation is about 0.21, so the
 * variation the eye actually gets is nearer a fifth of the number written here.
 * The first pass at this used a third of these values on the reasoning that
 * subtle was safer, and the ground came back indistinguishable from flat colour
 * in a screenshot.
 */
const MOTTLE_STRENGTH = 0.15;
const GRAIN_STRENGTH = 0.24;
const TOOTH_STRENGTH = 0.17;

/**
 * Distances over which the two fine octaves fade out, in metres.
 *
 * They are procedural, so there is no mip chain to filter them: past the point
 * where a wavelength falls below a pixel they alias, and the aliasing crawls as
 * the player walks. Fading them leaves the mottle — which is coarse enough to
 * survive — doing the work at distance, which is also where the crisp cell edges
 * are meant to read as a data product.
 */
const DETAIL_NEAR_M = 45;
const DETAIL_FAR_M = 170;

/**
 * How hard the darker half of the detail warms towards bare soil.
 *
 * A gain on a swing that only ever reaches about 0.16, so it takes a number
 * well above 1 to be visible at all; 4 saturates the tint in the deepest
 * hollows and leaves most of the ground barely touched.
 */
const SOIL_TINT_GAIN = 4;

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
  /** The grid the textures are on, so detail can be sized in metres. */
  readonly spec: GridSpec;
}

export function createTerrainMaterial(options: TerrainMaterialOptions): TerrainMaterial {
  const uOverlay = { value: options.overlay };
  const uOverlayMix = { value: 0 };

  const material = new THREE.MeshToonMaterial({
    map: options.landCover,
    gradientMap: options.gradientMap,
  });

  // `vMapUv` runs 0..1 across the catchment, so this converts it to metres and
  // every wavelength above can be written as the distance it actually is.
  const extentM = options.spec.width * options.spec.cellSize;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOverlay = uOverlay;
    shader.uniforms.uOverlayMix = uOverlayMix;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform sampler2D uOverlay;
        uniform float uOverlayMix;

        // Value noise, hashed rather than sampled: a texture lookup would need a
        // texture to author, ship and bind, and the ground only needs something
        // stationary and band-limited to break its own flatness.
        //
        // The multiply is by a small constant and the fract comes first, which
        // is the part that matters. The finest octave has a 0.85 m wavelength
        // and the catchment is 1024 m across, so its lattice coordinate reaches
        // about 1200 — and hashing that by multiplying up to five figures first
        // spends the whole float32 mantissa before the fract, collapsing 3600
        // lattice cells at the far corner onto 235 distinct values. The far
        // corner of the map then tiles visibly.
        float cwHash(vec2 cell) {
          vec3 p = fract(vec3(cell.xyx) * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float cwNoise(vec2 p) {
          vec2 cell = floor(p);
          vec2 f = fract(p);
          // Smoothstep weights, so the lattice does not show as a square grid of
          // creases — which, on ground already drawn in 4 m squares, would read
          // as a second and wrong grid.
          vec2 w = f * f * (3.0 - 2.0 * f);
          float a = cwHash(cell);
          float b = cwHash(cell + vec2(1.0, 0.0));
          float c = cwHash(cell + vec2(0.0, 1.0));
          float d = cwHash(cell + vec2(1.0, 1.0));
          return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
        }`,
      )
      // Ground detail first, then the overlay on top of it: the risk map is the
      // one layer that has to stay legible, and grain applied over it would put
      // noise on the only thing in the frame that is meant to be read as a
      // number. Both sit after map_fragment and before lighting, so the toon
      // ramp still shades them — the map is painted onto the landscape, not
      // floating above it.
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
        {
          vec2 cwGround = vMapUv * ${extentM.toFixed(1)};
          float cwMottle = cwNoise(cwGround / ${MOTTLE_M.toFixed(2)});
          float cwGrain = cwNoise(cwGround / ${GRAIN_M.toFixed(2)});
          float cwTooth = cwNoise(cwGround / ${TOOTH_M.toFixed(2)});

          float cwNear = 1.0 - smoothstep(${DETAIL_NEAR_M.toFixed(1)}, ${DETAIL_FAR_M.toFixed(1)}, length(vViewPosition));
          float cwDetail = (cwMottle - 0.5) * ${MOTTLE_STRENGTH.toFixed(3)}
                         + (cwGrain - 0.5) * ${GRAIN_STRENGTH.toFixed(3)} * cwNear
                         + (cwTooth - 0.5) * ${TOOTH_STRENGTH.toFixed(3)} * cwNear;

          diffuseColor.rgb *= 1.0 + cwDetail;
          // The darker half warms rather than simply dimming, so a hollow reads
          // as soil showing through the sward instead of as shadow the sun has
          // no reason to be casting there.
          diffuseColor.rgb = mix(
            diffuseColor.rgb,
            diffuseColor.rgb * vec3(1.08, 0.97, 0.86),
            min(1.0, max(-cwDetail, 0.0) * ${SOIL_TINT_GAIN.toFixed(1)})
          );
        }

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
