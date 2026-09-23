/**
 * The storm: rainfall to hydrograph, over the catchment the player has built.
 *
 * A lag-and-route cascade on the **already-cached FD8 fractions** — the same
 * flow partitioning the risk model uses. Reusing it is not just an optimisation:
 * it means the water in the storm goes exactly where the connectivity model says
 * it goes, so the two halves of the game cannot disagree about the catchment.
 *
 * ## The counterfactual is computed, not remembered
 *
 * Every storm is run twice against the same rainfall: once over the catchment as
 * it is, and once with every pond, dam and planting disabled. The second run is
 * what the hydrograph draws as a dashed line, so "your work cut the peak by 23%"
 * is a measurement of this storm rather than a comparison against some earlier
 * storm that was a different size. That is the only honest way to attribute a
 * difference, and it costs one extra set of stores.
 *
 * ## Why the outflow fraction is capped
 *
 * A linear store releases `S * dt/T` per step. When `dt` approaches the travel
 * time `T` that fraction approaches 1, and past it the store goes negative and
 * the hydrograph oscillates — which looks exactly like "the player's
 * interventions made the flood worse". The cap at 0.9 is the stability
 * condition, and it is the single most important line in this file.
 */

import { type GridSpec, N8_DCOL, N8_DROW, cellAreaM2 } from "../core/grid";
import { LandCover } from "../scimap/constants";
import type { Fd8Table } from "../scimap/fd8";
import { RUNOFF_WEIGHT_LUT } from "../scimap/landcover";

/** Simulation step, in seconds. */
export const STEP_SECONDS = 60;

/** Fraction of a store that may leave in one step. Below 1 for stability. */
const MAX_RELEASE_FRACTION = 0.9;

/** Overland and in-channel roughness, as Manning's n. */
const MANNING_OVERLAND = 0.35;
const MANNING_CHANNEL = 0.045;
/** Extra roughness a leaky dam adds to its cell. */
export const DAM_ROUGHNESS = 0.09;

/**
 * Velocity scale in the Manning relation.
 *
 * Small, and deliberately so. The router moves water exactly one cell per step,
 * which caps celerity at `cellSize / dt` however fast the Manning relation says
 * the water is going — 0.067 m/s on a 4 m cell at a 60 s step. Feed it real
 * velocities of 1-3 m/s and *every* cell saturates at the maximum release
 * fraction, at which point roughness has no way to express itself and leaky dams
 * change the hydrograph by exactly nothing. That is how this model first failed,
 * and it failed silently: the hydrograph was perfectly plausible and identical
 * to its own counterfactual.
 *
 * So velocities are scaled to sit inside the scheme's own limit, with channels
 * near the top of it and hillslopes an order of magnitude below. What the model
 * then represents faithfully is the *relative* effect of roughness, storage and
 * land cover — which is what the player is manipulating — rather than absolute
 * travel times in metres per second.
 */
const VELOCITY_SCALE = 0.011;

/** Slowest travel a cell may have, in metres per second. */
const MIN_VELOCITY = 0.002;

/** Courant limit: one cell per step is all the router can move. */
function maxVelocity(cellSize: number): number {
  return cellSize / STEP_SECONDS;
}

/**
 * Depth of soil storage that must fill before runoff begins, in metres.
 *
 * This is what makes a second storm on wet ground worse than the first, and what
 * makes woodland genuinely different from arable rather than only differently
 * weighted.
 */
const INFILTRATION_CAPACITY_M = 0.012;

export interface StormFeatures {
  /** Free storage in cubic metres per cell, from ponds. */
  readonly pondStorageM3: Float64Array;
  /** Extra Manning roughness per cell, from leaky dams. */
  readonly damRoughness: Float64Array;
}

export interface StormInput {
  readonly spec: GridSpec;
  readonly table: Fd8Table;
  readonly slopeDeg: Float64Array;
  readonly channelMask: Uint8Array;
  readonly landCover: Uint8Array;
  /**
   * Land cover for the counterfactual run: the catchment as generated, before
   * any planting or pond. Defaults to `landCover`.
   */
  readonly counterfactualLandCover?: Uint8Array;
  readonly rainfallScaled: Float64Array;
  readonly outlet: number;
  /** Cell the village gauge sits on; usually at or near the outlet. */
  readonly gaugeCell: number;
  readonly features: StormFeatures;
}

export interface StormOptions {
  readonly depthMm: number;
  readonly durationHours: number;
  /** Number of depth frames to return for playback. */
  readonly frames: number;
}

export interface Hydrograph {
  /** Discharge at the gauge, cubic metres per second, one per step. */
  readonly q: Float32Array;
  readonly peakQ: number;
  /** Time of peak, in seconds from the start of rainfall. */
  readonly tPeakSeconds: number;
}

export interface StormResult {
  readonly withFeatures: Hydrograph;
  readonly counterfactual: Hydrograph;
  /** Water depth per cell, quantised, `frames` snapshots of the whole grid. */
  readonly depthFrames: Uint8Array;
  readonly frameCount: number;
  /** Metres of depth the top of the quantised range represents. */
  readonly depthScaleM: number;
  readonly steps: number;
  readonly stepSeconds: number;
}

const DEPTH_SCALE_M = 1.5;

/**
 * Front-loaded storm profile.
 *
 * Real convective rainfall peaks early and tails off, and the asymmetry matters:
 * a peak arriving while the soil store is still filling produces a very
 * different hydrograph from the same depth arriving after saturation.
 */
function intensityAt(fraction: number): number {
  if (fraction < 0 || fraction > 1) return 0;
  // Gamma-like shape, normalised by the caller.
  return Math.pow(fraction, 0.7) * Math.exp(-3.2 * fraction);
}

interface Stores {
  readonly surface: Float64Array;
  readonly soil: Float64Array;
  readonly pondFree: Float64Array;
  readonly outflow: Float64Array;
}

function createStores(n: number): Stores {
  return {
    surface: new Float64Array(n),
    soil: new Float64Array(n),
    pondFree: new Float64Array(n),
    outflow: new Float64Array(n),
  };
}

/**
 * Run one storm over the catchment.
 *
 * `useFeatures` false disables ponds and dam roughness and swaps in the
 * pre-intervention land cover, producing the counterfactual against which the
 * player's work is measured.
 */
function simulate(
  input: StormInput,
  options: StormOptions,
  useFeatures: boolean,
  depthFrames: Uint8Array | null,
  frameStride: number,
): Hydrograph {
  const { spec, table, slopeDeg, channelMask, rainfallScaled, features } = input;
  const landCover = useFeatures ? input.landCover : (input.counterfactualLandCover ?? input.landCover);
  const { width, height } = spec;
  const n = width * height;
  const area = cellAreaM2(spec);

  const steps = Math.max(1, Math.round((options.durationHours * 3600 * 2.2) / STEP_SECONDS));
  const rainSteps = Math.round((options.durationHours * 3600) / STEP_SECONDS);

  const stores = createStores(n);
  if (useFeatures) stores.pondFree.set(features.pondStorageM3);

  // Release fraction per cell, fixed for the run: it depends on slope, roughness
  // and cell size, none of which change during a storm.
  const ceiling = maxVelocity(spec.cellSize);
  const release = new Float64Array(n);
  for (let cell = 0; cell < n; cell++) {
    const tanBeta = Math.max(0.002, Math.tan((slopeDeg[cell] * Math.PI) / 180));
    const roughness =
      (channelMask[cell] ? MANNING_CHANNEL : MANNING_OVERLAND) +
      (useFeatures ? features.damRoughness[cell] : 0);

    const velocity = Math.min(
      ceiling,
      Math.max(MIN_VELOCITY, (VELOCITY_SCALE * Math.sqrt(tanBeta)) / roughness),
    );
    const travelTime = spec.cellSize / velocity;
    release[cell] = Math.min(MAX_RELEASE_FRACTION, STEP_SECONDS / travelTime);
  }

  // Normalise the hyetograph so its integral is the storm's total depth.
  let profileSum = 0;
  for (let step = 0; step < rainSteps; step++) {
    profileSum += intensityAt((step + 0.5) / rainSteps);
  }
  const depthPerUnit = profileSum > 0 ? options.depthMm / 1000 / profileSum : 0;

  const q = new Float32Array(steps);
  const { surface, soil, pondFree, outflow } = stores;

  let frameIndex = 0;

  for (let step = 0; step < steps; step++) {
    // --- rainfall and infiltration ------------------------------------------
    if (step < rainSteps) {
      const depth = depthPerUnit * intensityAt((step + 0.5) / rainSteps);
      for (let cell = 0; cell < n; cell++) {
        const cover = landCover[cell] as LandCover;
        const fell = depth * rainfallScaled[cell];

        // Runoff generation, NOT erodibility. Urban sheds most of what lands on
        // it while contributing no sediment; woodland absorbs. The two weight
        // tables exist precisely so this cannot be confused with the risk term.
        const runoffWeight = RUNOFF_WEIGHT_LUT[cover];
        const capacity = INFILTRATION_CAPACITY_M * (1 - runoffWeight * 0.75);

        const room = Math.max(0, capacity - soil[cell]);
        const infiltrated = Math.min(fell, room);
        soil[cell] += infiltrated;
        surface[cell] += (fell - infiltrated) * area;
      }
    }

    // --- release ------------------------------------------------------------
    // Computed for every cell before any is moved, so water travels exactly one
    // step per tick regardless of the order cells are visited in.
    for (let cell = 0; cell < n; cell++) {
      let leaving = surface[cell] * release[cell];

      if (useFeatures && pondFree[cell] > 0 && leaving > 0) {
        // A pond absorbs until full, then passes flow — which is why a full
        // pond stops helping.
        const absorbed = Math.min(leaving, pondFree[cell]);
        pondFree[cell] -= absorbed;
        leaving -= absorbed;
        surface[cell] -= absorbed;
      }

      outflow[cell] = leaving;
      surface[cell] -= leaving;
    }

    // --- route downslope ----------------------------------------------------
    for (let index = 0; index < n; index++) {
      const cell = table.order[index];
      const leaving = outflow[cell];
      if (leaving <= 0) continue;

      const row = (cell / width) | 0;
      const col = cell % width;
      const offset = cell * 8;

      for (let k = 0; k < 8; k++) {
        const fraction = table.fractions[offset + k];
        if (fraction === 0) continue;
        const nRow = row + N8_DROW[k];
        const nCol = col + N8_DCOL[k];
        if (nRow < 0 || nRow >= height || nCol < 0 || nCol >= width) continue;

        const neighbour = nRow * width + nCol;
        surface[neighbour] += leaving * fraction;
      }
      // Whatever the fractions did not account for has left the catchment.
    }

    // --- gauge --------------------------------------------------------------
    const gaugeFlow = outflow[input.gaugeCell] / STEP_SECONDS;
    q[step] = gaugeFlow;

    // --- playback frame -----------------------------------------------------
    if (depthFrames && step % frameStride === 0 && frameIndex < options.frames) {
      const base = frameIndex * n;
      for (let cell = 0; cell < n; cell++) {
        const depthM = surface[cell] / area;
        depthFrames[base + cell] = Math.min(255, Math.round((depthM / DEPTH_SCALE_M) * 255));
      }
      frameIndex++;
    }
  }

  let peakQ = 0;
  let tPeakSeconds = 0;
  for (let step = 0; step < steps; step++) {
    if (q[step] > peakQ) {
      peakQ = q[step];
      tPeakSeconds = step * STEP_SECONDS;
    }
  }

  return { q, peakQ, tPeakSeconds };
}

export function runStorm(input: StormInput, options: StormOptions): StormResult {
  const n = input.spec.width * input.spec.height;
  const steps = Math.max(
    1,
    Math.round((options.durationHours * 3600 * 2.2) / STEP_SECONDS),
  );
  const frameStride = Math.max(1, Math.floor(steps / options.frames));

  const depthFrames = new Uint8Array(options.frames * n);
  const withFeatures = simulate(input, options, true, depthFrames, frameStride);
  const counterfactual = simulate(input, options, false, null, frameStride);

  return {
    withFeatures,
    counterfactual,
    depthFrames,
    frameCount: options.frames,
    depthScaleM: DEPTH_SCALE_M,
    steps,
    stepSeconds: STEP_SECONDS,
  };
}
