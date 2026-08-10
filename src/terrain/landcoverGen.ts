/**
 * Land cover for a generated catchment.
 *
 * Cover is not scattered at random — it follows the terrain the way farming
 * actually does. Flat, low, well-drained ground near the valley floor is
 * ploughed; steeper mid-slopes are grazed; the wet, thin-soiled tops are left as
 * moorland; and fragments of woodland survive on the steepest ground nobody
 * could work.
 *
 * That correlation is what makes the game's central problem a real one. Arable
 * carries five times the erodibility of woodland and sits exactly where
 * hydrological connectivity is highest, so the catchment hands the player
 * genuine critical source areas to find rather than a uniform field of noise.
 * Land cover assigned independently of slope would produce a risk map with no
 * structure worth reading.
 */

import type { GridSpec } from "../core/grid";
import { smoothstep } from "../core/clamp";
import type { Rng } from "../core/rng";
import { LandCover } from "../scimap/constants";
import { createNoise2D, domainWarp } from "./noise";

/**
 * Fields, not noise.
 *
 * Land cover is decided **once per parcel**, from that parcel's average slope
 * and elevation, and every cell inside it gets the same answer. Anything less
 * committal produces static rather than farmland, and the reason is worth
 * recording because two earlier attempts both failed.
 *
 * Comparing per-cell noise against per-cell suitability speckles wherever the
 * two are close. Fixing the random draw per parcel but leaving suitability
 * per-cell is no better: the boundary becomes a contour of a noisy slope field,
 * so fields grow fractal fingers and 32% of cells end up differing from their
 * neighbour. Neither gives the player a parcel they can recognise, walk around
 * and plant.
 *
 * Deciding whole parcels is also what actually happens. A farmer ploughs a field
 * or grazes it; they do not plough the flat 40% of it. Field boundaries then
 * fall on the warped lattice — hedge lines — rather than on a slope contour.
 *
 * The steep-ground woodland override stays per-cell, because relict woodland
 * genuinely does follow the terrain rather than the field pattern.
 */
const FIELDS_ACROSS = 13;
const FIELD_WARP = 0.06;
const FIELD_WARP_FREQUENCY = 3.5;

/** Lattice padding, so warped coordinates outside [0, 1] still land in range. */
const FIELD_PAD = 2;
const FIELD_STRIDE = FIELDS_ACROSS + FIELD_PAD * 2;

/** Deterministic hash of a parcel's lattice coordinates to [0, 1). */
function parcelRandom(x: number, y: number, salt: number): number {
  let hash = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ salt;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2545f491);
  hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}

/** Slope in degrees above which ploughing stops being practical. */
const ARABLE_MAX_SLOPE = 7;
const IMPROVED_MAX_SLOPE = 15;
/** Steep ground that escaped clearance keeps its woodland. */
const RELICT_WOODLAND_SLOPE = 26;
/** Fraction of the catchment's relief above which grazing gives way to moor. */
const MOORLAND_MIN_ELEVATION = 0.72;

export interface LandCoverOptions {
  /** Fraction of the catchment's relief below which arable is plausible. */
  readonly arableMaxElevationFraction?: number;
}

export function generateLandCover(
  dem: Float64Array,
  slopeDeg: Float64Array,
  spec: GridSpec,
  rng: Rng,
  options: LandCoverOptions = {},
): Uint8Array {
  const { width, height } = spec;
  const n = width * height;
  const cover = new Uint8Array(n);
  const noise = createNoise2D(rng);
  const fieldSalt = rng.int(0x7fffffff);

  const arableCeiling = options.arableMaxElevationFraction ?? 0.55;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (dem[i] < min) min = dem[i];
    if (dem[i] > max) max = dem[i];
  }
  const span = max - min || 1;

  // Pass 1: assign every cell to a parcel and gather that parcel's terrain.
  const parcelOf = new Int32Array(n);
  const parcelCount = FIELD_STRIDE * FIELD_STRIDE;
  const sumSlope = new Float64Array(parcelCount);
  const sumElevation = new Float64Array(parcelCount);
  const cellsIn = new Int32Array(parcelCount);

  for (let row = 0; row < height; row++) {
    const v = row / height;
    for (let col = 0; col < width; col++) {
      const index = row * width + col;
      const [warpedU, warpedV] = domainWarp(
        noise,
        col / width,
        v,
        FIELD_WARP,
        FIELD_WARP_FREQUENCY,
      );

      const fx = Math.min(
        FIELD_STRIDE - 1,
        Math.max(0, Math.floor(warpedU * FIELDS_ACROSS) + FIELD_PAD),
      );
      const fy = Math.min(
        FIELD_STRIDE - 1,
        Math.max(0, Math.floor(warpedV * FIELDS_ACROSS) + FIELD_PAD),
      );

      const parcel = fy * FIELD_STRIDE + fx;
      parcelOf[index] = parcel;
      sumSlope[parcel] += slopeDeg[index];
      sumElevation[parcel] += (dem[index] - min) / span;
      cellsIn[parcel]++;
    }
  }

  // Pass 2: one land-use decision per parcel, from its mean terrain.
  const parcelCover = new Uint8Array(parcelCount);
  for (let parcel = 0; parcel < parcelCount; parcel++) {
    if (cellsIn[parcel] === 0) continue;

    const meanSlope = sumSlope[parcel] / cellsIn[parcel];
    const meanElevation = sumElevation[parcel] / cellsIn[parcel];

    const slopeSuitability =
      1 - smoothstep(ARABLE_MAX_SLOPE - 3, ARABLE_MAX_SLOPE + 3, meanSlope);
    const heightSuitability =
      1 - smoothstep(arableCeiling - 0.15, arableCeiling + 0.1, meanElevation);

    const fx = parcel % FIELD_STRIDE;
    const fy = (parcel / FIELD_STRIDE) | 0;
    const draw = parcelRandom(fx, fy, fieldSalt);

    if (draw < slopeSuitability * heightSuitability) {
      parcelCover[parcel] = LandCover.Arable;
    } else if (meanSlope < IMPROVED_MAX_SLOPE && meanElevation < 0.7) {
      parcelCover[parcel] = LandCover.ImprovedGrassland;
    } else if (meanElevation < MOORLAND_MIN_ELEVATION) {
      parcelCover[parcel] = LandCover.ExtensiveGrassland;
    } else {
      parcelCover[parcel] = LandCover.Moorland;
    }
  }

  for (let index = 0; index < n; index++) {
    // Relict woodland is the one class that follows terrain rather than the
    // field pattern: nobody cleared the ground too steep to work.
    cover[index] =
      slopeDeg[index] > RELICT_WOODLAND_SLOPE
        ? LandCover.Woodland
        : parcelCover[parcelOf[index]];
  }
  return cover;
}

/** Stamp a compact block of urban cells, for the village footprint. */
export function stampUrban(
  cover: Uint8Array,
  spec: GridSpec,
  centre: number,
  radiusCells: number,
): void {
  const { width, height } = spec;
  const centreRow = (centre / width) | 0;
  const centreCol = centre % width;

  for (let dRow = -radiusCells; dRow <= radiusCells; dRow++) {
    for (let dCol = -radiusCells; dCol <= radiusCells; dCol++) {
      if (dRow * dRow + dCol * dCol > radiusCells * radiusCells) continue;
      const row = centreRow + dRow;
      const col = centreCol + dCol;
      if (row < 0 || row >= height || col < 0 || col >= width) continue;
      cover[row * width + col] = LandCover.Urban;
    }
  }
}
