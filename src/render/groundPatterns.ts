/**
 * Small-scale texture for the ground, by land cover.
 *
 * The land-cover colours say what each field *is*; these say what it is *like*
 * to stand on. Ploughed ground gets furrows, grass gets tufts and blade
 * strokes and a scatter of wildflowers, moorland gets clumps of heather. None
 * of it touches the model or the risk overlay, which is drawn over the top.
 *
 * All procedural, for the same reason the rest of the ground detail is: no
 * texture to author or ship, and patterns sized in metres so a furrow is a
 * furrow's width wherever it is on the map.
 *
 * ## Band-limited by pixel footprint, not by distance
 *
 * Procedural detail has no mip chain, so a pattern finer than a pixel aliases
 * and crawls as the camera moves. Fading by distance from the camera — what the
 * older octaves did — stops being right the moment the camera can zoom: at a
 * far zoom everything is "far" and the ground goes flat; zoomed in, fine detail
 * a few metres off is still fading. Instead every feature fades by its own size
 * against the metres a pixel covers at that fragment (`cwResolved`), so each
 * detail is crisp as long as the screen can show it and gone just before it
 * would shimmer, at any zoom, resolution or pixel ratio.
 *
 * ## Why furrows run in strips
 *
 * Stripes need a direction, and one direction for the whole map reads as a
 * texture laid over everything. The shader cannot see the model's field
 * parcels, so the ground is divided into its own jittered strips about 40 m
 * across, each ploughed at an angle hashed from its identity, with an
 * unploughed grassy headland where two strips meet. It reads as a patchwork
 * of worked strips, which is what arable land looks like from a hill.
 */

import { glslColour } from "./glsl";

/** Size of a ploughing strip, and the furrow spacing within one, in metres. */
const STRIP_M = 42;
const FURROW_M = 1.15;

/** Heather clump size, in metres. */
const HEATHER_M = 0.9;

/** Wildflower lattice spacing, in metres; at most one flower per lattice cell. */
const FLOWER_CELL_M = 1.7;


const PETAL_WHITE = glslColour(0xfff8ee);
const PETAL_PINK = glslColour(0xf5b3c8);
const PETAL_YELLOW = glslColour(0xf7df86);
const PETAL_LILAC = glslColour(0xd3c1f2);
const FLOWER_HEART = glslColour(0xf4bf55);
const HEATHER = glslColour(0xd8aad0);
const BRACKEN = glslColour(0xc9ae92);
const MOSS = glslColour(0xbdd09c);

/**
 * GLSL functions. Expects `cwHash` and `cwNoise` from the terrain material's
 * own preamble to be declared first.
 */
export const GROUND_PATTERN_FUNCTIONS = /* glsl */ `
  // How much of a feature \`size\` metres across the screen can show, given the
  // metres a pixel covers: 1 from four pixels up, 0 below one and a half.
  float cwResolved(float size, float mpp) {
    return smoothstep(1.5, 4.0, size / max(mpp, 1e-4));
  }

  vec2 cwHash2(vec2 p) {
    return vec2(cwHash(p), cwHash(p + 19.19));
  }

  // Ploughed strips. x: signed ridge/furrow brightness, already faded by
  // resolution. y: 1 inside a strip, falling to 0 on the headland between two.
  vec2 cwFurrows(vec2 ground, float mpp) {
    vec2 p = ground / ${STRIP_M.toFixed(1)};
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    vec2 site1 = vec2(0.0);
    vec2 id1 = vec2(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 offset = vec2(float(x), float(y));
        vec2 id = cell + offset;
        vec2 site = offset + 0.5 + (cwHash2(id) - 0.5) * 0.7;
        float d = length(site - f);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          site1 = site;
          id1 = id;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
    float angle = cwHash(id1 + 7.3) * 3.14159265;
    vec2 across = vec2(-sin(angle), cos(angle));
    // Measured from the strip's own site in metres, so the stripe phase keeps
    // its precision anywhere on the map.
    float s = dot((f - site1) * ${STRIP_M.toFixed(1)}, across) / ${FURROW_M.toFixed(2)};
    float ridge = 0.5 + 0.5 * cos(s * 6.2831853);
    float inside = smoothstep(0.03, 0.09, d2 - d1);
    // A stripe pattern needs more pixels per period than a blob does before it
    // stops beating against the pixel grid, so this fades out earlier than
    // cwResolved would.
    float shown = smoothstep(3.0, 7.0, ${FURROW_M.toFixed(2)} / max(mpp, 1e-4));
    return vec2((ridge - 0.5) * inside * shown, inside);
  }

  // Grass: blade strokes, tufts lit on the sun side, and wildflowers. \`wild\`
  // is 0 for improved pasture (short, neat, few flowers) and 1 for rough
  // grazing (tussocky and flowery).
  void cwGrass(inout vec3 colour, vec2 ground, float mpp, float wild, float weight) {
    // Strokes: two layers of noise stretched along different directions, so
    // the sward has a brushed grain without one obvious direction.
    vec2 a = mat2(0.8, -0.6, 0.6, 0.8) * ground;
    vec2 b = mat2(0.28, 0.96, -0.96, 0.28) * ground;
    float strokes = cwNoise(a * vec2(3.2, 0.9)) * 0.5 + cwNoise(b * vec2(3.6, 1.0) + 7.7) * 0.5;
    colour *= 1.0 + (strokes - 0.5) * 0.24 * cwResolved(0.3, mpp) * weight;

    // Tufts: at most one per lattice cell, a soft darker clump with a lit crown
    // offset towards the sun, which reads as a little mound from above.
    float tuftCell = mix(1.1, 0.85, wild);
    vec2 tp = ground / tuftCell;
    vec2 tc = floor(tp);
    vec2 th = cwHash2(tc + 3.1);
    float tuftRadius = mix(0.17, 0.24, wild) * (0.8 + 0.4 * th.x);
    vec2 toTuft = (fract(tp) - (0.3 + th * 0.4)) * tuftCell;
    float body = 1.0 - smoothstep(0.5, 1.0, length(toTuft * vec2(1.0, 1.3)) / tuftRadius);
    float crown = 1.0 - smoothstep(0.0, 0.75, length(toTuft - vec2(-0.035, -0.045)) / tuftRadius);
    float tufted = step(mix(0.45, 0.2, wild), cwHash(tc + 9.4)) * cwResolved(tuftRadius * 2.0, mpp) * weight;
    colour *= 1.0 - body * 0.11 * tufted;
    colour = mix(colour, colour * vec3(1.1, 1.12, 1.02), crown * body * 0.8 * tufted);

    // Wildflowers: a pastel petal disc with a golden heart.
    vec2 fp = ground / ${FLOWER_CELL_M.toFixed(2)};
    vec2 fc = floor(fp);
    vec2 toFlower = (fract(fp) - (0.2 + cwHash2(fc + 21.7) * 0.6)) * ${FLOWER_CELL_M.toFixed(2)};
    float toCentre = length(toFlower);
    // Edges at least a pixel wide, or a flower a few pixels across sparkles
    // as its rim flips between covering a pixel and not.
    float edge = mpp * 0.75;
    float petals = 1.0 - smoothstep(0.075 - edge, 0.105 + edge, toCentre);
    float heart = 1.0 - smoothstep(0.022 - edge, 0.04 + edge, toCentre);
    float pick = cwHash(fc + 33.3);
    vec3 petal = pick < 0.34 ? ${PETAL_WHITE}
      : pick < 0.6 ? ${PETAL_PINK}
      : pick < 0.82 ? ${PETAL_YELLOW}
      : ${PETAL_LILAC};
    float blooming = step(1.0 - mix(0.16, 0.36, wild), cwHash(fc + 5.5)) * cwResolved(0.2, mpp) * weight;
    colour = mix(colour, petal, petals * blooming);
    colour = mix(colour, ${FLOWER_HEART}, heart * blooming);
  }

  // Heather: jittered clumps, each pink heather, bracken brown or moss green,
  // shaded darker towards its edge so the moor reads as a lumpy carpet.
  void cwHeather(inout vec3 colour, vec2 ground, float mpp, float weight) {
    vec2 p = ground / ${HEATHER_M.toFixed(2)};
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float d1 = 8.0;
    vec2 id1 = vec2(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 offset = vec2(float(x), float(y));
        vec2 id = cell + offset;
        float d = length(offset + 0.5 + (cwHash2(id) - 0.5) * 0.8 - f);
        if (d < d1) {
          d1 = d;
          id1 = id;
        }
      }
    }
    float pick = cwHash(id1 + 2.2);
    vec3 tint = pick < 0.45 ? ${HEATHER} : pick < 0.75 ? ${BRACKEN} : ${MOSS};
    float resolved = cwResolved(${HEATHER_M.toFixed(2)}, mpp) * weight;
    colour = mix(colour, tint, 0.4 * resolved);
    colour *= 1.0 - smoothstep(0.2, 0.75, d1) * 0.18 * resolved;
  }
`;

/**
 * GLSL statements applying the patterns to `diffuseColor`.
 *
 * Expects `cwGround` (metres), `cwMpp` (metres per pixel, computed in uniform
 * control flow) and `cwPattern` (cover weights: arable, improved grass,
 * extensive grass, moorland) in scope. Each pattern sits behind a branch on its
 * own weight; over any one screen region nearly every fragment takes the same
 * path, so the branches cost nothing and skip work for every other cover.
 */
export const GROUND_PATTERN_APPLY = /* glsl */ `
  if (cwPattern.r > 0.004) {
    vec2 furrows = cwFurrows(cwGround, cwMpp);
    diffuseColor.rgb *= 1.0 + furrows.x * 0.17 * cwPattern.r;
    // Clods between the furrows.
    diffuseColor.rgb *= 1.0 + (cwNoise(cwGround * 3.1) - 0.5) * 0.14 * cwResolved(0.32, cwMpp) * cwPattern.r;
    // Headlands are left in grass.
    diffuseColor.rgb = mix(
      diffuseColor.rgb,
      diffuseColor.rgb * vec3(0.88, 1.03, 0.82),
      (1.0 - furrows.y) * 0.55 * cwPattern.r
    );
  }
  float cwGrassWeight = cwPattern.g + cwPattern.b;
  if (cwGrassWeight > 0.004) {
    cwGrass(diffuseColor.rgb, cwGround, cwMpp, cwPattern.b / cwGrassWeight, cwGrassWeight);
  }
  if (cwPattern.a > 0.004) {
    cwHeather(diffuseColor.rgb, cwGround, cwMpp, cwPattern.a);
  }
`;
