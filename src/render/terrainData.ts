/**
 * The fields the *look* of the ground is built from, as opposed to the fields
 * the model is built from.
 *
 * Three things the terrain shader needs and cannot work out per fragment:
 *
 * **Openness** — how much sky each cell can see. The shadow map covers only a
 * region around the player (see `lighting.ts`), so everything beyond it is lit as if
 * the landscape were flat: a hollow, a gully floor and a spur top all come back
 * the same shade, and the middle distance turns into a single sheet of green
 * with nothing but tree shadows on it. Sky-view openness is the part of that the
 * shadow map was never going to supply, it costs one bake, and it does not
 * aliase with distance the way a screen-space trick would.
 *
 * **Wetness** — how much ground drains through each cell, which is the same
 * `accum` the model routes on. Damp ground reads darker and cooler in the field,
 * so drawing it that way puts the drainage network into the ground itself. That
 * is worth more than the prettiness: the player has to find a watercourse to put
 * a leaky dam in, and before this the only way to do it was to open the map.
 *
 * **Relief** — which way each slope faces relative to the sun, with the
 * heights exaggerated first. The toon ramp is deliberately flat near full
 * light (see `toonRamp.ts`), and this catchment's slopes average about twelve
 * degrees, so between a hillside facing the sun and one facing away the ramp
 * moves by a few percent: from the overview the valley reads as a printed map
 * laid flat. This is the cartographer's answer to the same problem — shade
 * the relief as if it were several times steeper than it is — and the shader
 * spends it as a *colour* shift, warm on sunward slopes and cool on the far
 * side, so the landform appears without anything going dark.
 *
 * All three are sampled with **linear** filtering, unlike the land-cover and overlay
 * textures next to them. That split is deliberate — crisp 4 m cells are right
 * for a data product the player is meant to read as data, and wrong for light,
 * which has no business being square.
 */

import * as THREE from "three";
import { clamp01 } from "../core/clamp";
import type { GridSpec } from "../core/grid";
import { channelThresholdCells } from "../scimap/constants";
import { SUN_OFFSET } from "./lighting";

/**
 * Azimuths sampled when scanning for the horizon.
 *
 * Eight is the obvious number on a grid and it is not enough: a valley running
 * diagonally is then blocked in two of eight directions rather than the four it
 * really occludes, and the openness field picks up a faint eight-pointed star
 * around every knoll. Sixteen costs one more pass over the grid and the star
 * disappears.
 */
const HORIZON_DIRECTIONS = 16;

/**
 * Radial sample distances, in cells.
 *
 * Geometric rather than uniform. What blocks the sky is overwhelmingly nearby —
 * the near bank of a gully subtends a far larger angle than the valley side
 * 100 m off — so the samples are dense close in and sparse far out. Ten samples
 * reaching 26 cells covers a little over 100 m, which at this relief is enough
 * to catch a valley confining its own floor without the scan cost of the full
 * catchment.
 */
const HORIZON_STEPS = [1, 2, 3, 4, 6, 8, 11, 15, 20, 26];

/**
 * Openness value that maps to full shade, with 1.0 always mapping to full light.
 *
 * Openness is a cosine-weighted sky fraction, so its useful range is nothing
 * like 0..1: flat ground sits at 1.0 and even a steep gully floor only falls to
 * about 0.8, because most of the sky is still overhead. Writing the raw value
 * into a texture and multiplying by it would be a 2% effect nobody could see.
 * This stretches the range the terrain actually occupies across the full 0..1 of
 * the texture, and the shader then decides how hard to lean on it.
 */
const OPENNESS_FLOOR = 0.82;

/**
 * Contributing area at which ground starts to read as damp, in cells.
 *
 * The top of the ramp is the model's own channel threshold, so the ground is at
 * its dampest exactly where the model says a watercourse begins and the river
 * ribbon takes over. Anchoring to `channelThresholdCells` rather than a number
 * picked by eye means the damp corridor stays aligned with where dams are legal
 * if the threshold is ever retuned.
 *
 * The bottom of the ramp started four times lower, which is hydrologically
 * defensible — ground does get damper that far up a hillslope — and read badly:
 * every valley floor in the catchment went dark at once, and because valley
 * floors are also the most enclosed ground, the damp tint and the openness term
 * darkened the same places together. Starting higher draws a corridor that
 * follows the drainage lines instead of flooding the low ground, which is both
 * the more useful picture and the one that does not fight the shading.
 */
const WET_START_CELLS = 60;

/**
 * Vertical exaggeration applied to the terrain before relief shading.
 *
 * At 1 this would be ordinary Lambert shading, which the lights already do
 * and which is the few-percent effect described above. Printed relief maps
 * run between two and five times; three puts a twelve-degree hillside at the
 * shading of a thirty-degree one, which is where slopes start to read as
 * slopes from above.
 */
const RELIEF_EXAGGERATION = 3;

/**
 * Change in sun-facing (the cosine against the sun) that maps to the full
 * relief tint in either direction. Slopes beyond it clip, so a rare crag does
 * not set the scale for every gentle hillside.
 */
const RELIEF_RANGE = 0.6;

export interface TerrainData {
  readonly texture: THREE.DataTexture;
  dispose(): void;
}

/**
 * Sky-view openness for every cell, as a cosine-weighted fraction in 0..1.
 *
 * For each azimuth, walk outwards and keep the steepest rise seen; that is the
 * horizon in that direction. A horizon at angle t contributes cos²(t) of the
 * sky it covers, and since the scan produces the *tangent* of the angle rather
 * than the angle, that is `1 / (1 + tan²)` — the identity cos²(atan(t)) =
 * 1/(1+t²), which keeps the inner loop free of trigonometry entirely.
 */
function computeOpenness(dem: Float32Array, spec: GridSpec): Float32Array {
  const { width, height, cellSize } = spec;
  const openness = new Float32Array(dem.length);

  const dirCol = new Float64Array(HORIZON_DIRECTIONS);
  const dirRow = new Float64Array(HORIZON_DIRECTIONS);
  for (let d = 0; d < HORIZON_DIRECTIONS; d++) {
    const angle = (d / HORIZON_DIRECTIONS) * Math.PI * 2;
    dirCol[d] = Math.cos(angle);
    dirRow[d] = Math.sin(angle);
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      const here = dem[cell];
      let sum = 0;

      for (let d = 0; d < HORIZON_DIRECTIONS; d++) {
        let maxTan = 0;

        for (const step of HORIZON_STEPS) {
          const sampleCol = col + Math.round(dirCol[d] * step);
          const sampleRow = row + Math.round(dirRow[d] * step);
          // Off the edge of the catchment is open sky, not a wall. Stopping the
          // scan rather than clamping to the edge cell keeps the map border from
          // ringing itself with false occlusion.
          if (sampleCol < 0 || sampleCol >= width || sampleRow < 0 || sampleRow >= height) break;

          const rise = dem[sampleRow * width + sampleCol] - here;
          if (rise <= 0) continue;
          const tan = rise / (step * cellSize);
          if (tan > maxTan) maxTan = tan;
        }

        sum += 1 / (1 + maxTan * maxTan);
      }

      openness[cell] = sum / HORIZON_DIRECTIONS;
    }
  }

  return openness;
}

/**
 * How much more, or less, each cell faces the sun than flat ground does, with
 * the relief exaggerated: -1 for a slope turned well away, 0 on the flat, +1
 * for one turned well towards it.
 *
 * Signed and centred on flat ground on purpose. Valley floors and hilltops,
 * which are most of what the player walks on, come out at exactly zero and
 * keep the colour they were authored in; only the hillsides move.
 */
function computeRelief(dem: Float32Array, spec: GridSpec): Float32Array {
  const { width, height, cellSize } = spec;
  const relief = new Float32Array(dem.length);

  const sunLength = Math.hypot(SUN_OFFSET[0], SUN_OFFSET[1], SUN_OFFSET[2]);
  const sunX = SUN_OFFSET[0] / sunLength;
  const sunY = SUN_OFFSET[1] / sunLength;
  const sunZ = SUN_OFFSET[2] / sunLength;

  for (let row = 0; row < height; row++) {
    const rowUp = Math.max(row - 1, 0);
    const rowDown = Math.min(row + 1, height - 1);
    for (let col = 0; col < width; col++) {
      const colLeft = Math.max(col - 1, 0);
      const colRight = Math.min(col + 1, width - 1);

      // The same central differences the mesh's normals use (columns run
      // along world x, rows along z), so the tint lines up with the surface
      // it is painted on. Divided by the cells actually spanned, which is one
      // rather than two on the border.
      const dzdx =
        ((dem[row * width + colRight] - dem[row * width + colLeft]) /
          ((colRight - colLeft) * cellSize)) *
        RELIEF_EXAGGERATION;
      const dzdz =
        ((dem[rowDown * width + col] - dem[rowUp * width + col]) /
          ((rowDown - rowUp) * cellSize)) *
        RELIEF_EXAGGERATION;

      const facing = (-dzdx * sunX + sunY - dzdz * sunZ) / Math.sqrt(dzdx * dzdx + dzdz * dzdz + 1);
      relief[row * width + col] = Math.max(-1, Math.min(1, (facing - sunY) / RELIEF_RANGE));
    }
  }

  return relief;
}

/**
 * Bake the shading fields into one texture.
 *
 * R is openness stretched to 0..1, G is wetness, and B is relief, with 0.5 as
 * flat ground. Alpha is unused.
 */
export function bakeTerrainData(
  dem: Float32Array,
  accum: Float32Array,
  spec: GridSpec,
): TerrainData {
  const openness = computeOpenness(dem, spec);
  const relief = computeRelief(dem, spec);

  const wetStart = Math.log(WET_START_CELLS);
  const wetSpan = Math.log(channelThresholdCells(spec.cellSize)) - wetStart;

  const data = new Uint8Array(dem.length * 4);
  for (let cell = 0; cell < dem.length; cell++) {
    const shade = clamp01((openness[cell] - OPENNESS_FLOOR) / (1 - OPENNESS_FLOOR));
    // accum is in cells and never below 1 (a cell drains through itself), so the
    // log is always defined.
    const wetness = clamp01((Math.log(accum[cell]) - wetStart) / wetSpan);

    data[cell * 4] = Math.round(shade * 255);
    data[cell * 4 + 1] = Math.round(wetness * 255);
    // 128 rather than 127.5: flat ground must decode to exactly no tint, and
    // the shader subtracts 128/255 to match.
    data[cell * 4 + 2] = Math.round(128 + relief[cell] * 127);
    data[cell * 4 + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, spec.width, spec.height, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  // No colour space conversion: these are coefficients, not colours. Tagging
  // them sRGB would put both fields through a decode curve on sampling and bend
  // a linear ramp into something else entirely.
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  return {
    texture,
    dispose() {
      texture.dispose();
    },
  };
}
