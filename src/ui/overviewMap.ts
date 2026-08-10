/**
 * The whole catchment, from above, wearing the same SCIMAP overlay the
 * terrain does.
 *
 * The 3D view only ever shows the player's neighbourhood — the curved-world
 * shader fades the ground out a couple of hundred metres out on purpose — so
 * there is no way to see how a placement reads at the scale SCIMAP actually
 * scores at: the whole 256x256 grid at once. This panel answers that with a
 * flat top-down raster built from the same land-cover and elevation arrays the
 * terrain mesh uses, composited with the same overlay buffer and the same fade
 * `overlayControl` drives, so the two views can never show different things.
 *
 * A plain `<canvas>` with a manually composited `ImageData`, not a second
 * three.js scene: the source data is already a flat grid with no camera to
 * manage, so a software blend of two same-sized RGBA buffers is both simpler
 * and cheaper than standing up a render target.
 */

import type { GridSpec } from "../core/grid";
import { LandCover } from "../scimap/constants";
import { COVER_COLOURS } from "../render/terrainMaterial";
import { LAYER_STYLE, type LayerKey } from "../worker/overlayPack";
import { rampGradient } from "./overlayLegend";

/** Light direction for the hillshade, matching `render/lighting.ts`'s sun. */
const SUN = normalise(-140, 190, 110);

/** Base and slope-driven range of the hillshade brightness multiplier. */
const AMBIENT = 0.55;
const DIFFUSE = 0.65;

/** How far a channel cell's colour is pulled toward open water. */
const CHANNEL_TINT = 0.75;

function normalise(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

/**
 * Land cover, tinted along channels and shaded by relief — the same picture
 * the terrain shows with its overlay off, flattened to a top-down raster.
 *
 * Hillshade comes from central differences on the DEM, exactly as
 * `terrainMesh.ts` computes vertex normals, so a ridge reads as a ridge here
 * too rather than as a flat wash of land-cover colour.
 */
function buildLandscapeImage(
  dem: Float32Array,
  landCover: Uint8Array,
  channelMask: Uint8Array,
  spec: GridSpec,
): ImageData {
  const { width, height, cellSize } = spec;
  const data = new Uint8ClampedArray(width * height * 4);
  const water = COVER_COLOURS[LandCover.Water];
  const [lx, ly, lz] = SUN;
  const twoCells = 2 * cellSize;

  for (let row = 0; row < height; row++) {
    const rUp = Math.max(row - 1, 0);
    const rDown = Math.min(row + 1, height - 1);
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      const cLeft = Math.max(col - 1, 0);
      const cRight = Math.min(col + 1, width - 1);

      const dzdx = (dem[row * width + cRight] - dem[row * width + cLeft]) / twoCells;
      const dzdy = (dem[rDown * width + col] - dem[rUp * width + col]) / twoCells;
      const inverse = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const nx = -dzdx * inverse;
      const ny = inverse;
      const nz = -dzdy * inverse;

      const brightness = AMBIENT + Math.max(0, nx * lx + ny * ly + nz * lz) * DIFFUSE;

      const cover = COVER_COLOURS[landCover[i] as LandCover] ?? COVER_COLOURS[LandCover.Moorland];
      let r = cover[0];
      let g = cover[1];
      let b = cover[2];
      if (channelMask[i]) {
        r = r + (water[0] - r) * CHANNEL_TINT;
        g = g + (water[1] - g) * CHANNEL_TINT;
        b = b + (water[2] - b) * CHANNEL_TINT;
      }

      const out = i * 4;
      data[out] = r * brightness;
      data[out + 1] = g * brightness;
      data[out + 2] = b * brightness;
      data[out + 3] = 255;
    }
  }

  return new ImageData(data, width, height);
}

const MARKUP = `
  <div class="overview" id="overview" hidden>
    <div class="overview__panel">
      <div class="overview__head">
        <strong id="overview-title">Catchment overview</strong>
        <button class="overview__close" id="overview-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="overview__description" id="overview-description"></div>
      <div class="overview__canvas-wrap">
        <canvas id="overview-canvas"></canvas>
        <div class="overview__marker overview__marker--outlet" id="overview-outlet" title="Outlet"></div>
        <div class="overview__marker overview__marker--player" id="overview-player">
          <svg viewBox="0 0 10 10" width="16" height="16" overflow="visible">
            <polygon points="5,1 9,9 5,7 1,9" fill="#fff" stroke="#3d3226" stroke-width="0.8" />
          </svg>
        </div>
      </div>
      <div class="overview__ramp" id="overview-ramp" hidden></div>
      <div class="overview__hint"><kbd>Tab</kbd> close &middot; <kbd>M</kbd> next layer &middot; <kbd>N</kbd> off</div>
    </div>
  </div>
`;

export interface OverviewMap {
  readonly visible: boolean;
  toggle(): void;
  show(): void;
  hide(): void;
  /** Adopt a freshly recomputed overlay buffer, same as the terrain gets. */
  setOverlay(rgba: Uint8Array): void;
  /** Overlay opacity, kept in lockstep with `overlayControl`'s fade. */
  setMix(value: number): void;
  setLayer(layer: LayerKey): void;
  setPlayer(x: number, z: number, yaw: number): void;
  dispose(): void;
}

export function createOverviewMap(
  root: HTMLElement,
  spec: GridSpec,
  dem: Float32Array,
  landCover: Uint8Array,
  channelMask: Uint8Array,
  outletCell: number,
): OverviewMap {
  root.insertAdjacentHTML("beforeend", MARKUP);

  const panel = root.querySelector("#overview") as HTMLElement;
  const canvas = root.querySelector("#overview-canvas") as HTMLCanvasElement;
  const title = root.querySelector("#overview-title") as HTMLElement;
  const description = root.querySelector("#overview-description") as HTMLElement;
  const rampEl = root.querySelector("#overview-ramp") as HTMLElement;
  const outletMarker = root.querySelector("#overview-outlet") as HTMLElement;
  const playerMarker = root.querySelector("#overview-player") as HTMLElement;
  const closeButton = root.querySelector("#overview-close") as HTMLButtonElement;

  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const base = buildLandscapeImage(dem, landCover, channelMask, spec);
  const composed = new ImageData(new Uint8ClampedArray(base.data), spec.width, spec.height);

  let overlayBuffer: Uint8Array | null = null;
  let mix = 0;
  let visible = false;
  let dirty = true;

  /** Re-blend base + overlay and upload. Skipped while hidden; see show(). */
  const recompose = (): void => {
    const out = composed.data;
    out.set(base.data);
    const overlay = overlayBuffer;
    if (overlay && mix > 0.002) {
      for (let i = 0; i < out.length; i += 4) {
        const a = (overlay[i + 3] / 255) * mix;
        if (a <= 0) continue;
        out[i] += (overlay[i] - out[i]) * a;
        out[i + 1] += (overlay[i + 1] - out[i + 1]) * a;
        out[i + 2] += (overlay[i + 2] - out[i + 2]) * a;
      }
    }
    ctx.putImageData(composed, 0, 0);
    dirty = false;
  };

  const halfWidth = (spec.width * spec.cellSize) / 2;
  const halfHeight = (spec.height * spec.cellSize) / 2;
  const worldSpanX = spec.width * spec.cellSize;
  const worldSpanZ = spec.height * spec.cellSize;

  const place = (el: HTMLElement, x: number, z: number): void => {
    const fx = ((x + halfWidth) / worldSpanX) * 100;
    const fz = ((z + halfHeight) / worldSpanZ) * 100;
    el.style.left = `${Math.min(100, Math.max(0, fx))}%`;
    el.style.top = `${Math.min(100, Math.max(0, fz))}%`;
  };

  const outletRow = (outletCell / spec.width) | 0;
  const outletCol = outletCell % spec.width;
  place(
    outletMarker,
    (outletCol + 0.5) * spec.cellSize - halfWidth,
    (outletRow + 0.5) * spec.cellSize - halfHeight,
  );

  const api: OverviewMap = {
    get visible() {
      return visible;
    },

    toggle() {
      if (visible) api.hide();
      else api.show();
    },

    show() {
      visible = true;
      panel.hidden = false;
      if (dirty) recompose();
    },

    hide() {
      visible = false;
      panel.hidden = true;
    },

    setOverlay(rgba) {
      overlayBuffer = rgba;
      dirty = true;
      if (visible) recompose();
    },

    setMix(value) {
      mix = value;
      dirty = true;
      if (visible) recompose();
    },

    setLayer(layer) {
      if (layer === "none") {
        title.textContent = "Catchment overview";
        description.textContent = "The whole landscape, from above.";
        rampEl.hidden = true;
        return;
      }
      const style = LAYER_STYLE[layer];
      title.textContent = style.label;
      description.textContent = style.description;
      rampEl.style.background = rampGradient(style.ramp);
      rampEl.hidden = false;
    },

    setPlayer(x, z, yaw) {
      place(playerMarker, x, z);
      // Screen bearing clockwise from "up": derived from the controller's own
      // convention (yaw 0 faces +z, which is *down* the map since row 0 sits
      // at the north edge), not by guessing and nudging until it looked right.
      const bearing = 180 - (yaw * 180) / Math.PI;
      playerMarker.style.transform = `translate(-50%, -50%) rotate(${bearing}deg)`;
    },

    dispose() {
      panel.remove();
    },
  };

  closeButton.addEventListener("click", () => api.hide());
  panel.addEventListener("click", (event) => {
    if (event.target === panel) api.hide();
  });

  api.setLayer("none");
  return api;
}
