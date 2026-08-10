/**
 * Colour ramps for the risk overlay.
 *
 * Deliberately the ramps the reference SCIMAP application already uses — magma
 * for erosion, viridis for connectivity, plasma for the combined product. That
 * is not decoration: someone who has read SCIMAP output in QGIS should recognise
 * the map in the game without relearning what the colours mean.
 *
 * All three are perceptually uniform and monotonic in luminance, which matters
 * because the overlay is composited over toon-shaded terrain. A ramp that is not
 * monotonic in lightness (a rainbow, most obviously) produces false edges where
 * the ramp turns, and the player reads them as features in the data.
 *
 * Stops are expanded to a 256-entry lookup once at startup, so packing an
 * overlay is a table read per cell rather than an interpolation.
 */

export type RampStops = readonly (readonly [number, number, number])[];

export const MAGMA: RampStops = [
  [0, 0, 4],
  [28, 16, 68],
  [79, 18, 123],
  [129, 37, 129],
  [181, 54, 122],
  [229, 80, 100],
  [251, 135, 97],
  [254, 194, 135],
  [252, 253, 191],
];

export const VIRIDIS: RampStops = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];

export const PLASMA: RampStops = [
  [13, 8, 135],
  [75, 3, 161],
  [125, 3, 168],
  [168, 34, 150],
  [203, 70, 121],
  [229, 107, 93],
  [248, 148, 65],
  [253, 195, 40],
  [240, 249, 33],
];

/** 256 x RGB bytes, expanded from stops by linear interpolation. */
export function buildLut(stops: RampStops): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  const last = stops.length - 1;

  for (let i = 0; i < 256; i++) {
    const scaled = (i / 255) * last;
    const lo = Math.floor(scaled);
    const hi = Math.min(last, lo + 1);
    const f = scaled - lo;
    for (let k = 0; k < 3; k++) {
      lut[i * 3 + k] = Math.round(stops[lo][k] + (stops[hi][k] - stops[lo][k]) * f);
    }
  }
  return lut;
}

export const LUTS = {
  magma: buildLut(MAGMA),
  viridis: buildLut(VIRIDIS),
  plasma: buildLut(PLASMA),
} as const;

export type RampName = keyof typeof LUTS;
