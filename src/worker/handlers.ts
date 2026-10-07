/**
 * The work the simulation worker actually does.
 *
 * Kept out of `sim.worker.ts` so it can be unit-tested in a plain Node process
 * with no worker environment, and so the dispatcher stays a readable switch.
 *
 * State lives here as module-level singletons because there is exactly one
 * catchment at a time and the arrays are large. `generate` replaces it;
 * everything else mutates it in place.
 */

import type { GridSpec } from "../core/grid";
import { buildRiskWeight } from "../scimap/landcover";
import { recomputeFromTwi } from "../scimap/pipeline";
import { computeBufferBreaks } from "../scimap/buffer";
import { storageBreakTwi, type ConnectivityBreak } from "../scimap/twi";
import { traceStreams } from "../scimap/streams";
import { computeMetrics } from "../scimap/metrics";
import { chooseSites, fisheryPool } from "../terrain/sites";
import { POND_RADIUS_CELLS } from "../game/interventions";
import { fitGumbel, returnPeriodForDepth } from "../sim/gumbel";
import { DAM_ROUGHNESS, runStorm, type StormResult } from "../sim/storm";
import { POND_STORAGE_M3 } from "../game/interventions";
import { createWorld, type World } from "../world";
import { LAYER_STYLE, packOverlay, type LayerKey } from "./overlayPack";
import type {
  BreakDto,
  CatchmentMetricsDto,
  CoverEditDto,
  ProgressCallback,
  ReachDto,
  SitesDto,
} from "./protocol";

let world: World | null = null;
/**
 * Land cover as generated, before any player edit.
 *
 * The worker's `landCover` array is mutated by every recompute, so without
 * this there is nothing to rebuild from: an undone tree would leave its cell
 * woodland for the rest of the session, still earning credit.
 */
let pristineCover: Uint8Array | null = null;
let currentLayer: LayerKey = "sourceRisk";
/** Pool of overlay buffers returned by the main thread after upload. */
const overlayPool: ArrayBuffer[] = [];

function requireWorld(): World {
  if (!world) throw new Error("No catchment has been generated yet");
  return world;
}

/** Which array a layer key selects. */
function layerArray(key: Exclude<LayerKey, "none">): Float64Array {
  const { arrays } = requireWorld();
  switch (key) {
    case "connectivity":
      return arrays.connectivity;
    case "erosion":
      return arrays.erosion;
    case "sourceRisk":
      return arrays.sourceRisk;
    case "inChannel":
      return arrays.inChannel;
  }
}

/**
 * Render the current layer into a pooled RGBA buffer.
 *
 * Reusing returned buffers keeps steady-state allocation at zero: a 256 KB
 * allocation per placement is survivable on its own, but handing the collector a
 * steady stream of them shows up as a hitch precisely when the player is doing
 * something.
 */
function buildOverlay(): ArrayBuffer {
  const { arrays } = requireWorld();
  const n = arrays.spec.width * arrays.spec.height;

  const buffer = overlayPool.pop() ?? new ArrayBuffer(n * 4);
  const rgba = new Uint8Array(buffer);

  if (currentLayer === "none") {
    rgba.fill(0);
    return buffer;
  }

  const style = LAYER_STYLE[currentLayer];
  packOverlay(
    layerArray(currentLayer),
    style.ramp,
    rgba,
    style.channelOnly ? arrays.channelMask : undefined,
  );
  return buffer;
}

let sites: SitesDto | null = null;
let baseline: CatchmentMetricsDto | null = null;

/** Cells one pond covers, so water area can be read back as a pond count. */
const CELLS_PER_POND = (() => {
  let count = 0;
  const r = POND_RADIUS_CELLS;
  for (let dRow = -r; dRow <= r; dRow++) {
    for (let dCol = -r; dCol <= r; dCol++) {
      if (dRow * dRow + dCol * dCol <= r * r) count++;
    }
  }
  return count;
})();

function metrics(): CatchmentMetricsDto {
  const { arrays } = requireWorld();
  return computeMetrics({
    spec: arrays.spec,
    sourceRisk: arrays.sourceRisk,
    connectivity: arrays.connectivity,
    inChannel: arrays.inChannel,
    landCover: arrays.landCover,
    channelMask: arrays.channelMask,
    downstream: arrays.downstream,
    outlet: arrays.outlet,
    fisheryCell: sites?.fisheryCell ?? arrays.outlet,
    cellsPerPond: CELLS_PER_POND,
  });
}

/** In-channel risk sampled at every river vertex, for the water shader. */
function buildReachRisk(reaches: ReachDto[]): Float32Array<ArrayBuffer> {
  const { arrays } = requireWorld();
  let total = 0;
  for (const reach of reaches) total += reach.cells.length;

  const risk = new Float32Array(total);
  let offset = 0;
  for (const reach of reaches) {
    for (const cell of reach.cells) risk[offset++] = arrays.inChannel[cell];
  }
  return risk;
}

let reaches: ReachDto[] = [];

export interface GenerateResult {
  world: World;
  overlay: ArrayBuffer;
  reaches: ReachDto[];
  /** In-channel risk at every reach vertex, as a recompute would return it. */
  reachRisk: Float32Array<ArrayBuffer>;
  metrics: CatchmentMetricsDto;
  sites: SitesDto;
  baseline: CatchmentMetricsDto;
}

export function handleGenerate(
  seed: number,
  layer: LayerKey,
  spec?: GridSpec,
  onProgress?: ProgressCallback,
): GenerateResult {
  currentLayer = layer;
  world = createWorld(seed, { spec }, onProgress);
  pristineCover = Uint8Array.from(world.arrays.landCover);
  overlayPool.length = 0;

  onProgress?.(76, "stage.riverNetwork");
  const { arrays } = world;
  const d8 = arrays.d8Accum;
  reaches = traceStreams(arrays.channelMask, arrays.downstream, d8).map((line) => ({
    cells: line.cells,
    accum: line.accum,
  }));

  onProgress?.(78, "stage.sites");
  const chosen = chooseSites(
    arrays.spec,
    arrays.outlet,
    arrays.downstream,
    d8,
    arrays.slopeDeg,
    arrays.channelMask,
  );
  sites = {
    fisheryCell: chosen.fisheryCell,
    villageCell: chosen.villageCell,
    cottageCells: [...chosen.cottageCells],
    poolCells: fisheryPool(arrays.spec, chosen.fisheryCell, arrays.channelMask),
  };

  onProgress?.(80, "stage.colourMap");
  // The baseline is frozen here, on the pristine catchment, for exactly the same
  // reason the stretch bounds are: every score is a reduction against how the
  // catchment was *found*, so recomputing this later would silently reset the
  // player's progress to zero.
  //
  // Frozen from the same solve a recompute runs, with no features. The full
  // pipeline in `createWorld` does not apply the buffer breaks that existing
  // riparian woodland earns, and every recompute does — so a baseline taken
  // straight from it handed the player's first placement the credit for all
  // the woodland that was already there.
  solve([], []);
  baseline = metrics();

  return {
    world,
    overlay: buildOverlay(),
    reaches,
    reachRisk: buildReachRisk(reaches),
    metrics: baseline,
    sites,
    baseline,
  };
}

export interface RecomputeResult {
  overlay: ArrayBuffer;
  /** Explicitly backed by ArrayBuffer, not SharedArrayBuffer, so it transfers. */
  reachRisk: Float32Array<ArrayBuffer>;
  metrics: CatchmentMetricsDto;
}

/**
 * Apply the player's interventions and re-solve.
 *
 * Breaks and cover edits are always supplied as the *complete* current set, not
 * as deltas. Rebuilding from the pristine baseline every time costs nothing
 * measurable — the sweep is linear and dominated by the grid, not by the number
 * of features — and it means removing a feature restores the catchment exactly,
 * with no accumulated drift for a long session to reveal.
 */
export function handleRecompute(
  layer: LayerKey,
  breaks: readonly BreakDto[],
  coverEdits: readonly CoverEditDto[],
): RecomputeResult {
  requireWorld();
  currentLayer = layer;
  solve(breaks, coverEdits);

  return {
    overlay: buildOverlay(),
    reachRisk: buildReachRisk(reaches),
    metrics: metrics(),
  };
}

/**
 * Re-solve the catchment for a complete set of features, from the land cover
 * as generated.
 *
 * Restoring the pristine cover first is what makes the "complete set, not
 * deltas" contract true for cover edits as well as breaks: a feature missing
 * from the set leaves no trace, however many recomputes ago it was placed.
 */
function solve(breaks: readonly BreakDto[], coverEdits: readonly CoverEditDto[]): void {
  const { arrays, bounds } = requireWorld();
  if (!pristineCover) throw new Error("No catchment has been generated yet");

  arrays.landCover.set(pristineCover);
  for (const edit of coverEdits) arrays.landCover[edit.cell] = edit.cover;
  buildRiskWeight(arrays.landCover, arrays.riskWeight);

  // Buffer breaks are derived rather than sent. Whether a planted cell forms a
  // buffer depends on how many woodland cells lie between it and the channel,
  // which only the worker's land-cover array and flow paths can answer — and
  // planting one tree can change the width credited to every tree upslope of it.
  const bufferBreaks = computeBufferBreaks(
    arrays.landCover,
    arrays.downstream,
    arrays.channelMask,
    arrays.accum,
  );

  const resolved: ConnectivityBreak[] = [];
  for (const source of [...breaks, ...bufferBreaks]) {
    resolved.push({
      cell: source.cell,
      twi: storageBreakTwi(
        arrays.accum[source.cell],
        arrays.slopeDeg[source.cell],
        arrays.rainfallScaled[source.cell],
        source.capacityCells,
      ),
    });
  }

  recomputeFromTwi(arrays, bounds, resolved);
}

/** Snapshots the whole grid this many times across a storm, for playback. */
const STORM_FRAMES = 48;

/** Storm duration in hours. Long enough to separate a delayed peak from a cut one. */
const STORM_DURATION_HOURS = 6;

export interface StormOutcome {
  readonly result: StormResult;
  readonly depthMm: number;
  readonly returnPeriodDays: number;
}

/**
 * Route a storm of the given depth over the catchment as it currently stands.
 *
 * Depth is decided by the caller because storms arrive two ways. The player asks
 * for a *named design event* — "show me the 1-in-30" — which is a test against a
 * stated standard and must not be a random draw, or half the time the button
 * would deliver drizzle and teach only that it is unreliable. Scheduled weather
 * samples the same distribution instead, so most events are modest and the
 * occasional large one arrives unasked. The return period is computed here for
 * labelling, whichever route the depth came by.
 *
 * The features are passed as cell lists rather than read from the model, because
 * the worker's arrays record the *consequences* of a pond (its land cover, its
 * connectivity break) and not the fact that it is a pond with a volume. Storage
 * and roughness are properties of the built thing, so they come from the side
 * that built it.
 */
export function handleStorm(
  depthMm: number,
  damCells: readonly number[],
  pondCells: readonly number[],
): StormOutcome {
  const { arrays } = requireWorld();
  const n = arrays.spec.width * arrays.spec.height;

  const pondStorageM3 = new Float64Array(n);
  for (const cell of pondCells) pondStorageM3[cell] += POND_STORAGE_M3;

  const damRoughness = new Float64Array(n);
  for (const cell of damCells) damRoughness[cell] += DAM_ROUGHNESS;

  const gumbel = fitGumbel();

  const result = runStorm(
    {
      spec: arrays.spec,
      table: arrays.table,
      slopeDeg: arrays.slopeDeg,
      channelMask: arrays.channelMask,
      landCover: arrays.landCover,
      // "Without your work" means without the planting too, not only without
      // the ponds' storage and the dams' roughness.
      counterfactualLandCover: pristineCover ?? arrays.landCover,
      rainfallScaled: arrays.rainfallScaled,
      outlet: arrays.outlet,
      gaugeCell: arrays.outlet,
      features: { pondStorageM3, damRoughness },
    },
    { depthMm, durationHours: STORM_DURATION_HOURS, frames: STORM_FRAMES },
  );

  return { result, depthMm, returnPeriodDays: returnPeriodForDepth(gumbel, depthMm) };
}

export function handleSetLayer(layer: LayerKey): ArrayBuffer {
  currentLayer = layer;
  return buildOverlay();
}

export function handleRelease(buffers: ArrayBuffer[]): void {
  // Two deep is enough: one texture being uploaded while the next is packed.
  for (const buffer of buffers) {
    if (overlayPool.length < 2) overlayPool.push(buffer);
  }
}

/** Test seam: drop all worker state. */
export function resetWorkerState(): void {
  world = null;
  pristineCover = null;
  sites = null;
  baseline = null;
  reaches = [];
  overlayPool.length = 0;
  currentLayer = "sourceRisk";
}
