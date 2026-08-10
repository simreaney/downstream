/**
 * Renders the generated catchment to PNGs so the terrain and its derived layers
 * can actually be looked at.
 *
 * Run explicitly — `npx vitest run tools/preview.test.ts` — it is excluded from
 * the default suite by `test.include` in vite.config.ts. Output goes to
 * `tools/out/`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { GRID } from "../src/config";
import { type GridSpec, N8_DCOL, N8_DROW } from "../src/core/grid";
import { channelThresholdCells } from "../src/scimap/constants";
import { accumulateD8, buildDownstreamIndex } from "../src/scimap/d8";
import { accumulate, buildFd8Table } from "../src/scimap/fd8";
import { fillDepressions } from "../src/scimap/fill";
import { extractChannelMask, traceStreams } from "../src/scimap/streams";
import { generateTerrain } from "../src/terrain/generate";
import { createWorld } from "../src/world";
import { encodePng } from "./png";

const OUT_DIR = new URL("./out/", import.meta.url).pathname;

/** Classic hillshade: sun in the north-west at 45 degrees, the GIS convention. */
function hillshade(dem: Float64Array, spec: GridSpec): Uint8Array {
  const { width, height, cellSize } = spec;
  const rgb = new Uint8Array(width * height * 3);

  const azimuth = (315 * Math.PI) / 180;
  const zenith = (45 * Math.PI) / 180;
  const sunX = Math.sin(zenith) * Math.cos(azimuth);
  const sunY = Math.sin(zenith) * Math.sin(azimuth);
  const sunZ = Math.cos(zenith);

  let min = Infinity;
  let max = -Infinity;
  for (const z of dem) {
    if (z < min) min = z;
    if (z > max) max = z;
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const r0 = Math.max(row - 1, 0);
      const r1 = Math.min(row + 1, height - 1);
      const c0 = Math.max(col - 1, 0);
      const c1 = Math.min(col + 1, width - 1);

      const dzdx = (dem[row * width + c1] - dem[row * width + c0]) / (2 * cellSize);
      const dzdy = (dem[r1 * width + col] - dem[r0 * width + col]) / (2 * cellSize);

      const norm = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = Math.max(0, (-dzdx * sunX - dzdy * sunY + sunZ) / norm);

      // Tint by elevation so valleys read green and divides read pale.
      const t = (dem[i] - min) / (max - min || 1);
      const base = [90 + 110 * t, 130 + 80 * t, 80 + 90 * t];
      for (let k = 0; k < 3; k++) {
        rgb[i * 3 + k] = Math.min(255, Math.max(0, base[k] * (0.35 + 0.85 * shade)));
      }
    }
  }
  return rgb;
}

function drainageOverlay(
  rgb: Uint8Array,
  accum: Float64Array,
  channelMask: Uint8Array,
  threshold: number,
): Uint8Array {
  const out = Uint8Array.from(rgb);
  for (let i = 0; i < accum.length; i++) {
    if (!channelMask[i]) continue;
    // Wider, darker channels where more area drains through.
    const strength = Math.min(1, 0.45 + Math.log(accum[i] / threshold + 1) / 3);
    out[i * 3] = Math.round(out[i * 3] * (1 - strength) + 40 * strength);
    out[i * 3 + 1] = Math.round(out[i * 3 + 1] * (1 - strength) + 120 * strength);
    out[i * 3 + 2] = Math.round(out[i * 3 + 2] * (1 - strength) + 220 * strength);
  }
  return out;
}

function markOutlet(rgb: Uint8Array, spec: GridSpec, outlet: number): Uint8Array {
  const out = Uint8Array.from(rgb);
  const row = Math.floor(outlet / spec.width);
  const col = outlet % spec.width;
  for (let k = 0; k < 8; k++) {
    for (let step = 0; step <= 3; step++) {
      const r = row + N8_DROW[k] * step;
      const c = col + N8_DCOL[k] * step;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;
      const i = (r * spec.width + c) * 3;
      out[i] = 255;
      out[i + 1] = 40;
      out[i + 2] = 40;
    }
  }
  return out;
}

/** Render a [0, 1] layer through a perceptual ramp, hillshade-modulated. */
function layerImage(
  layer: Float64Array,
  shade: Uint8Array,
  ramp: readonly [number, number, number][],
): Uint8Array {
  const rgb = new Uint8Array(layer.length * 3);
  for (let i = 0; i < layer.length; i++) {
    const t = Math.min(1, Math.max(0, layer[i]));
    const scaled = t * (ramp.length - 1);
    const lo = Math.floor(scaled);
    const hi = Math.min(ramp.length - 1, lo + 1);
    const f = scaled - lo;

    // Reuse the hillshade's luminance so terrain structure stays legible under
    // the data — the same trick the in-game overlay uses over the toon shading.
    const relief = 0.55 + (0.45 * shade[i * 3 + 1]) / 255;
    for (let k = 0; k < 3; k++) {
      rgb[i * 3 + k] = Math.round((ramp[lo][k] + (ramp[hi][k] - ramp[lo][k]) * f) * relief);
    }
  }
  return rgb;
}

const MAGMA: [number, number, number][] = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [252, 194, 71],
  [252, 253, 191],
];

const VIRIDIS: [number, number, number][] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

describe("preview", () => {
  it("renders the risk layers", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    const seed = 20260809;
    const world = createWorld(seed, { spec: GRID });
    const shade = hillshade(world.arrays.dem, GRID);

    for (const [name, layer, ramp] of [
      ["connectivity", world.arrays.connectivity, VIRIDIS],
      ["erosion", world.arrays.erosion, MAGMA],
      ["source-risk", world.arrays.sourceRisk, MAGMA],
    ] as const) {
      const path = `${OUT_DIR}${name}-${seed}.png`;
      writeFileSync(path, encodePng(layerImage(layer, shade, ramp), GRID.width, GRID.height));
      console.log(`wrote ${path}`);
    }

    // In-channel risk only means anything on the network, so show it there over
    // a muted hillshade rather than washing the whole catchment.
    const inChannel = Uint8Array.from(shade);
    for (let i = 0; i < world.arrays.inChannel.length; i++) {
      if (!world.arrays.channelMask[i]) continue;
      const t = Math.min(1, Math.max(0, world.arrays.inChannel[i]));
      inChannel[i * 3] = Math.round(60 + 195 * t);
      inChannel[i * 3 + 1] = Math.round(140 - 80 * t);
      inChannel[i * 3 + 2] = Math.round(220 - 180 * t);
    }
    // Land cover with no shading or jitter, to judge parcel coherence directly.
    const cover = new Uint8Array(world.arrays.landCover.length * 3);
    const palette: Record<number, [number, number, number]> = {
      1: [0x46, 0x7d, 0x40],
      2: [0xbd, 0xa2, 0x74],
      3: [0x8d, 0xb8, 0x5e],
      4: [0x9e, 0xb0, 0x74],
      5: [0x96, 0x8c, 0x72],
      6: [0xbc, 0xac, 0x9c],
      7: [0x5a, 0xa9, 0xd6],
    };
    for (let i = 0; i < world.arrays.landCover.length; i++) {
      const c = palette[world.arrays.landCover[i]] ?? [255, 0, 255];
      cover[i * 3] = c[0];
      cover[i * 3 + 1] = c[1];
      cover[i * 3 + 2] = c[2];
    }
    writeFileSync(`${OUT_DIR}landcover-${seed}.png`, encodePng(cover, GRID.width, GRID.height));

    // Fragmentation: how often a cell differs from the one to its right. Low is
    // fields, high is static.
    let edges = 0;
    for (let row = 0; row < GRID.height; row++) {
      for (let col = 0; col < GRID.width - 1; col++) {
        const i = row * GRID.width + col;
        if (world.arrays.landCover[i] !== world.arrays.landCover[i + 1]) edges++;
      }
    }
    console.log(`landcover edge density: ${((100 * edges) / world.arrays.landCover.length).toFixed(1)}%`);

    const path = `${OUT_DIR}in-channel-${seed}.png`;
    writeFileSync(path, encodePng(inChannel, GRID.width, GRID.height));
    console.log(`wrote ${path}`);
  }, 120_000);

  it("renders hillshade and drainage for several seeds", () => {
    mkdirSync(OUT_DIR, { recursive: true });

    for (const seed of [20260809, 4242, 777]) {
      const terrain = generateTerrain(seed, { spec: GRID });
      fillDepressions(terrain.dem, GRID, terrain.outlet);

      const downstream = buildDownstreamIndex(terrain.dem, GRID);
      const table = buildFd8Table(terrain.dem, GRID);
      const accum = accumulate(table, GRID);
      const d8Accum = accumulateD8(downstream, table.order);
      const threshold = channelThresholdCells(GRID.cellSize);
      const channelMask = extractChannelMask(d8Accum, threshold);
      const reaches = traceStreams(channelMask, downstream, d8Accum);

      let rgb = hillshade(terrain.dem, GRID);
      rgb = drainageOverlay(rgb, d8Accum, channelMask, threshold);
      rgb = markOutlet(rgb, GRID, terrain.outlet);

      const path = `${OUT_DIR}terrain-${seed}.png`;
      writeFileSync(path, encodePng(rgb, GRID.width, GRID.height));

      let channelCells = 0;
      for (const flag of channelMask) channelCells += flag;
      console.log(
        `wrote ${path}  outlet=${terrain.outlet} channelCells=${channelCells} ` +
          `reaches=${reaches.length} outletAccum=${accum[terrain.outlet].toFixed(0)}`,
      );
    }
  }, 120_000);
});
