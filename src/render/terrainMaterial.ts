/**
 * Terrain surface: land-cover colour, toon shading, and the risk overlay on top.
 *
 * Built on `MeshToonMaterial` rather than a custom ShaderMaterial so that three's
 * lighting, shadow mapping, fog and gradient-map quantisation all keep working —
 * a hand-written shader would mean reimplementing every one of them to get a
 * colour ramp composited over the surface.
 *
 * Both the base colour and the overlay are DataTextures on the grid the model
 * computes in, and they are filtered differently on purpose. The overlay is
 * nearest-sampled: it is the one layer meant to be read as data, and crisp
 * cells say so. The land cover is sampled *soft-nearest* — each cell is flat
 * colour across most of its width and blends to its neighbour only over a
 * narrow band at the edge. Plain nearest leaves hard 4 m staircases along every
 * field boundary, which is the one harsh edge left in an otherwise soft toy
 * world; plain linear smears classes into colours that belong to neither. The
 * narrow band keeps every field its own colour while rounding the steps off.
 */

import * as THREE from "three";
import { isLowPower } from "../config";
import type { GridSpec } from "../core/grid";
import { LandCover } from "../scimap/constants";
import { applyCurvature, type CurvatureUniforms } from "./curvature";
import { GLSL_NOISE } from "./glsl";
import { GROUND_PATTERN_APPLY, GROUND_PATTERN_FUNCTIONS } from "./groundPatterns";

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
const MOTTLE_STRENGTH = 0.13;
const GRAIN_STRENGTH = 0.16;
const TOOTH_STRENGTH = 0.1;

/**
 * Per-cover texture — furrows, tufts, flowers, heather; see `groundPatterns.ts`.
 *
 * Off on low-power devices: it is the heaviest part of a full-screen fragment
 * shader, and a phone is exactly where that matters.
 */
const GROUND_PATTERNS = !isLowPower();

/**
 * How hard the darker half of the detail warms towards bare soil.
 *
 * A gain on a swing that only ever reaches about 0.16, so it takes a number
 * well above 1 to be visible at all; 4 saturates the tint in the deepest
 * hollows and leaves most of the ground barely touched.
 */
const SOIL_TINT_GAIN = 3;

/**
 * Half-width of the blend band at a land-cover cell edge, as a fraction of a
 * cell. 0 is hard nearest, 0.5 is full bilinear.
 */
const COVER_EDGE_SOFTNESS = 0.2;

/**
 * Bright, slightly desaturated pastels — the soft toy-diorama palette. Every
 * class sits high in lightness so that, under the high-key lighting, the
 * landscape reads as sunny felt and painted wood rather than as terrain.
 *
 * Arable is the odd one out and deliberately so: it is drawn as tilled earth
 * rather than as a crop, because it is the cover carrying five times the
 * erodibility of anything else and the player needs to pick it out at a glance,
 * from a hilltop, without turning the risk overlay on.
 */
export const COVER_COLOURS: Record<LandCover, [number, number, number]> = {
  [LandCover.Woodland]: [0xa3, 0xcc, 0x8e],
  [LandCover.Arable]: [0xe6, 0xcb, 0x9c],
  [LandCover.ImprovedGrassland]: [0xc2, 0xe0, 0x96],
  [LandCover.ExtensiveGrassland]: [0xd2, 0xdc, 0xa2],
  [LandCover.Moorland]: [0xcb, 0xb8, 0xae],
  [LandCover.Urban]: [0xe4, 0xda, 0xcf],
  [LandCover.Water]: [0xa3, 0xd6, 0xe6],
};

/**
 * Per-cell brightness jitter, as a fraction.
 *
 * Flat colour over a whole field reads as a texture-less plane under soft,
 * even lighting that does little to model it. A few percent of deterministic
 * variation gives the surface some tooth without reading as noise.
 */
const JITTER = 0.028;

/**
 * What damp ground multiplies its colour by, at full wetness.
 *
 * Darker, and green rather than yellow — the red channel gives up the most and
 * the green the least, which is how wet grass differs from dry in the field
 * rather than simply being a shadow. It has to survive the high-key lighting
 * and pastel ground it sits in, so it is a stronger multiply than it looks: at a
 * channel head the corridor needs to be findable from a hundred metres away,
 * because finding one is a thing the game actually asks the player to do.
 */
const DAMP_TINT: [number, number, number] = [0.8, 0.92, 0.92];

/**
 * How much of its sky fill a fully enclosed hollow gives up.
 *
 * Applied to the indirect term only, which is the hemisphere light standing in
 * for sky and bounce — the quantity sky-view openness actually describes.
 */
const AO_INDIRECT = 0.7;

/**
 * How much of the *sun* the same hollow gives up.
 *
 * Not physical: direct sun is either blocked or it is not, and the shadow map
 * already answers that. But the shadow map only covers a region around the
 * player (60 m at the default zoom; see lighting.ts), so past that the
 * question goes unanswered and every distant hillside comes
 * back flat. A quarter of the occlusion term on direct light is enough to put
 * the landform back into the middle distance, and small enough not to read as
 * a second, softer sun.
 */
const AO_DIRECT = 0.32;

/**
 * What both terms fall to under the risk overlay.
 *
 * The overlay is the one layer meant to be read as a number. Shading a hollow
 * darker than a spur lays a second gradient over it that is not risk, and the
 * player has no way to tell the two apart.
 */
const AO_OVERLAY_RELIEF = 0.3;

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
  // Linear, because the shader does its own soft-nearest lookup on top; see
  // the note at the head of this file.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Which ground texture each cell wears: arable in red, improved grassland in
 * green, extensive grassland in blue, moorland in alpha.
 *
 * Weights rather than a class index because the shader samples it with the
 * same soft-nearest lookup as the colours, and weights blend meaningfully
 * across a field boundary where an index would pass through classes that are
 * on neither side of it.
 */
export function createCoverPatternTexture(landCover: Uint8Array, spec: GridSpec): THREE.DataTexture {
  const data = new Uint8Array(landCover.length * 4);
  for (let i = 0; i < landCover.length; i++) {
    const cover = landCover[i] as LandCover;
    data[i * 4] = cover === LandCover.Arable ? 255 : 0;
    data[i * 4 + 1] = cover === LandCover.ImprovedGrassland ? 255 : 0;
    data[i * 4 + 2] = cover === LandCover.ExtensiveGrassland ? 255 : 0;
    data[i * 4 + 3] = cover === LandCover.Moorland ? 255 : 0;
  }

  const texture = new THREE.DataTexture(data, spec.width, spec.height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // Weights, not colours: no decode curve.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
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
}

export interface TerrainMaterialOptions {
  readonly landCover: THREE.Texture;
  /** Per-cover texture weights; see `createCoverPatternTexture`. */
  readonly coverPattern: THREE.Texture;
  readonly overlay: THREE.Texture;
  /** Sky-view openness in red, wetness in green. See `terrainData.ts`. */
  readonly terrainData: THREE.Texture;
  readonly gradientMap: THREE.Texture;
  readonly curvature: CurvatureUniforms;
  /** The grid the textures are on, so detail can be sized in metres. */
  readonly spec: GridSpec;
}

export function createTerrainMaterial(options: TerrainMaterialOptions): TerrainMaterial {
  const uOverlay = { value: options.overlay };
  const uOverlayMix = { value: 0 };
  const uTerrainData = { value: options.terrainData };
  const uCoverPattern = { value: options.coverPattern };

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
    shader.uniforms.uTerrainData = uTerrainData;
    shader.uniforms.uCoverPattern = uCoverPattern;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform sampler2D uOverlay;
        uniform float uOverlayMix;
        uniform sampler2D uTerrainData;
        uniform sampler2D uCoverPattern;

        ${GLSL_NOISE}
        ${GROUND_PATTERNS ? GROUND_PATTERN_FUNCTIONS : ""}`,
      )
      // Ground detail first, then the overlay on top of it: the risk map is the
      // one layer that has to stay legible, and grain applied over it would put
      // noise on the only thing in the frame that is meant to be read as a
      // number. Both sit after map_fragment and before lighting, so the toon
      // ramp still shades them — the map is painted onto the landscape, not
      // floating above it.
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        // Soft-nearest land cover: remap the fractional texel position so it
        // holds flat across the middle of a cell and ramps only near its edge,
        // then let linear filtering do the blend. The gradients passed are
        // those of the *unmodified* coordinate, or the remap's steep sections
        // would trip the mip selector and draw a seam at every cell boundary.
        vec2 cwTexels = vec2(${options.spec.width.toFixed(1)}, ${options.spec.height.toFixed(1)});
        vec2 cwP = vMapUv * cwTexels - 0.5;
        vec2 cwCell = floor(cwP);
        vec2 cwFrac = smoothstep(0.5 - ${COVER_EDGE_SOFTNESS.toFixed(3)}, 0.5 + ${COVER_EDGE_SOFTNESS.toFixed(3)}, cwP - cwCell);
        vec2 cwCoverUv = (cwCell + cwFrac + 0.5) / cwTexels;
        vec2 cwUvDx = dFdx(vMapUv);
        vec2 cwUvDy = dFdy(vMapUv);
        diffuseColor *= textureGrad(map, cwCoverUv, cwUvDx, cwUvDy);

        // Ground position in metres, and the metres one pixel covers there —
        // the larger of the two screen directions, so detail seen at a grazing
        // angle fades on the axis where it is most foreshortened. Taken here,
        // in uniform control flow, because derivatives inside the pattern
        // branches below would be undefined.
        vec2 cwGround = vMapUv * ${extentM.toFixed(1)};
        float cwMpp = max(length(cwUvDx), length(cwUvDy)) * ${extentM.toFixed(1)};

        // Sampled once at main() scope: the damp tint uses it here, and the
        // occlusion that replaces <aomap_fragment> uses it after the lights.
        vec4 cwTerrain = texture2D(uTerrainData, vMapUv);
        float cwShade = cwTerrain.r;
        float cwWetness = cwTerrain.g;
        {
          float cwMottle = cwNoise(cwGround / ${MOTTLE_M.toFixed(2)});
          float cwGrain = cwNoise(cwGround / ${GRAIN_M.toFixed(2)});
          float cwTooth = cwNoise(cwGround / ${TOOTH_M.toFixed(2)});

          // Each octave fades by its own wavelength against the pixel
          // footprint — see groundPatterns.ts for why not by distance.
          float cwGrainShown = smoothstep(1.5, 4.0, ${GRAIN_M.toFixed(2)} / max(cwMpp, 1e-4));
          float cwToothShown = smoothstep(1.5, 4.0, ${TOOTH_M.toFixed(2)} / max(cwMpp, 1e-4));
          float cwDetail = (cwMottle - 0.5) * ${MOTTLE_STRENGTH.toFixed(3)}
                         + (cwGrain - 0.5) * ${GRAIN_STRENGTH.toFixed(3)} * cwGrainShown
                         + (cwTooth - 0.5) * ${TOOTH_STRENGTH.toFixed(3)} * cwToothShown;

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
        ${
          GROUND_PATTERNS
            ? `{
          vec4 cwPattern = textureGrad(uCoverPattern, cwCoverUv, cwUvDx, cwUvDy);
          ${GROUND_PATTERN_APPLY}
        }`
            : ""
        }

        // Damp ground, from the same accumulation the model routes on. Under the
        // detail octaves so the two read as one surface, and before the overlay,
        // which is meant to replace the ground colour rather than sit on a
        // tinted version of it.
        diffuseColor.rgb = mix(
          diffuseColor.rgb,
          diffuseColor.rgb * vec3(${DAMP_TINT.map((c) => c.toFixed(3)).join(", ")}),
          cwWetness
        );

        vec4 cwOverlay = texture2D(uOverlay, vMapUv);
        diffuseColor.rgb = mix(diffuseColor.rgb, cwOverlay.rgb, cwOverlay.a * uOverlayMix);`,
      )
      // Occlusion from sky-view openness, in the slot three leaves for exactly
      // this. The chunk compiles to nothing without an aoMap, so replacing it
      // costs no work and puts the modulation where the material already
      // expects it — after the lights are accumulated, before they are summed.
      .replace(
        "#include <aomap_fragment>",
        /* glsl */ `
        float cwAoScale = mix(1.0, ${AO_OVERLAY_RELIEF.toFixed(2)}, uOverlayMix);
        reflectedLight.indirectDiffuse *= mix(1.0, cwShade, ${AO_INDIRECT.toFixed(2)} * cwAoScale);
        reflectedLight.directDiffuse *= mix(1.0, cwShade, ${AO_DIRECT.toFixed(2)} * cwAoScale);`,
      );
  };

  applyCurvature(material, options.curvature, "terrain-overlay");

  return {
    material,
    setOverlayMix(value) {
      uOverlayMix.value = value;
    },
  };
}
