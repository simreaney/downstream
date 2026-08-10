/**
 * Droplet-based hydraulic erosion.
 *
 * This is the step that makes the whole game work, and it is worth being clear
 * about why. Plain fractal noise produces smooth, blobby relief with no organised
 * drainage: flow accumulation on it fans out instead of concentrating, so the
 * Network Index is diffuse, critical source areas do not stand out, and the risk
 * map is an unreadable smear. There is nowhere obviously right to put a pond,
 * which means there is nothing for the player to be clever about.
 *
 * Simulating tens of thousands of droplets fixes that structurally rather than
 * cosmetically. Each one picks up sediment on steep ground and drops it where it
 * slows, which cuts dendritic valley networks with concave floors, sharp divides
 * and real confluences. SCIMAP then has something to read: connectivity
 * concentrates along valley lines, and where a high-risk field meets one is
 * visibly the place to plant.
 *
 * The algorithm is the standard particle model (Mei et al. / Hans Beyer's
 * formulation). It runs on a normalised copy of the DEM so the parameters below
 * mean the same thing regardless of the catchment's relief in metres.
 */

import type { GridSpec } from "../core/grid";
import type { Rng } from "../core/rng";

export interface ErosionParams {
  droplets: number;
  /** Maximum cells a droplet travels before it is abandoned. */
  maxSteps: number;
  /** 0 = follow the gradient exactly, 1 = ignore it. Low values meander less. */
  inertia: number;
  /** Sediment a droplet can carry per unit of slope, speed and water. */
  capacity: number;
  /** Floor on slope in the capacity term, so flat reaches still transport. */
  minSlope: number;
  erodeRate: number;
  depositRate: number;
  evaporation: number;
  gravity: number;
  /** Radius in cells over which erosion is spread, to avoid single-cell pits. */
  erosionRadius: number;
}

export const DEFAULT_EROSION: ErosionParams = {
  droplets: 50_000,
  maxSteps: 48,
  inertia: 0.05,
  capacity: 4,
  // Over a 256-cell grid the normalised drop per step is only a few thousandths,
  // so a minSlope near 0.01 would dominate the capacity term everywhere and turn
  // the model into a uniform depositor — which builds dams across valley floors.
  minSlope: 0.002,
  erodeRate: 0.3,
  // Deposition is bilinear over four cells while erosion is spread over a disc,
  // so a high deposit rate builds sharp mounds that dam the valley behind them.
  // Measured across seeds, 0.15 roughly halves the area the fill has to flood.
  depositRate: 0.15,
  evaporation: 0.015,
  gravity: 4,
  erosionRadius: 4,
};

interface Brush {
  readonly offsetsRow: Int32Array;
  readonly offsetsCol: Int32Array;
  readonly weights: Float64Array;
}

/**
 * Precompute a linearly-tapered disc of weights summing to 1.
 *
 * Eroding only the cell a droplet is standing on carves one-cell-wide slots that
 * priority-flood then has to fill, undoing the work. Spreading the same volume
 * over a small disc produces valleys with width, which both look right and
 * survive filling.
 */
function buildBrush(radius: number): Brush {
  const rows: number[] = [];
  const cols: number[] = [];
  const weights: number[] = [];
  let total = 0;

  for (let dRow = -radius; dRow <= radius; dRow++) {
    for (let dCol = -radius; dCol <= radius; dCol++) {
      const distance = Math.sqrt(dRow * dRow + dCol * dCol);
      if (distance > radius) continue;
      const weight = 1 - distance / radius;
      rows.push(dRow);
      cols.push(dCol);
      weights.push(weight);
      total += weight;
    }
  }

  return {
    offsetsRow: Int32Array.from(rows),
    offsetsCol: Int32Array.from(cols),
    weights: Float64Array.from(weights, (w) => w / total),
  };
}

interface Sample {
  height: number;
  gradRow: number;
  gradCol: number;
}

/** Bilinear height and gradient at a continuous position. */
function sample(dem: Float64Array, spec: GridSpec, row: number, col: number, out: Sample): void {
  const r = Math.min(Math.max(Math.floor(row), 0), spec.height - 2);
  const c = Math.min(Math.max(Math.floor(col), 0), spec.width - 2);
  const fr = row - r;
  const fc = col - c;

  const i = r * spec.width + c;
  const nw = dem[i];
  const ne = dem[i + 1];
  const sw = dem[i + spec.width];
  const se = dem[i + spec.width + 1];

  out.gradCol = (ne - nw) * (1 - fr) + (se - sw) * fr;
  out.gradRow = (sw - nw) * (1 - fc) + (se - ne) * fc;
  out.height =
    nw * (1 - fc) * (1 - fr) + ne * fc * (1 - fr) + sw * (1 - fc) * fr + se * fc * fr;
}

/**
 * Erode `dem` (in metres) in place.
 *
 * The outermost ring is never modified: it carries the catchment divide and the
 * outlet notch that `conditioning.ts` established, and a droplet chewing a
 * second gap in the rim would give the grid two ways out.
 */
export function erode(
  dem: Float64Array,
  spec: GridSpec,
  rng: Rng,
  params: ErosionParams = DEFAULT_EROSION,
): void {
  const { width, height } = spec;

  // Work in normalised height units so the tuning constants are relief-agnostic.
  let maxHeight = 0;
  for (let i = 0; i < dem.length; i++) if (dem[i] > maxHeight) maxHeight = dem[i];
  if (maxHeight <= 0) return;
  const scale = 1 / maxHeight;
  for (let i = 0; i < dem.length; i++) dem[i] *= scale;

  const brush = buildBrush(params.erosionRadius);
  const current: Sample = { height: 0, gradRow: 0, gradCol: 0 };
  const next: Sample = { height: 0, gradRow: 0, gradCol: 0 };

  const deposit = (row: number, col: number, amount: number): void => {
    // Bilinear deposition, so material lands smoothly rather than in steps.
    const r = Math.min(Math.max(Math.floor(row), 1), height - 3);
    const c = Math.min(Math.max(Math.floor(col), 1), width - 3);
    const fr = row - r;
    const fc = col - c;
    const i = r * width + c;
    dem[i] += amount * (1 - fc) * (1 - fr);
    dem[i + 1] += amount * fc * (1 - fr);
    dem[i + width] += amount * (1 - fc) * fr;
    dem[i + width + 1] += amount * fc * fr;
  };

  for (let droplet = 0; droplet < params.droplets; droplet++) {
    let row = rng.range(1, height - 2);
    let col = rng.range(1, width - 2);
    let dirRow = 0;
    let dirCol = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < params.maxSteps; step++) {
      const cellRow = Math.floor(row);
      const cellCol = Math.floor(col);
      sample(dem, spec, row, col, current);

      // Blend the previous heading with the downhill direction. Pure gradient
      // following produces straight, radial gullies; a little inertia lets
      // droplets carry through minor bumps and meander like real flow.
      dirRow = dirRow * params.inertia - current.gradRow * (1 - params.inertia);
      dirCol = dirCol * params.inertia - current.gradCol * (1 - params.inertia);

      const length = Math.hypot(dirRow, dirCol);
      if (length < 1e-9) break;
      dirRow /= length;
      dirCol /= length;

      row += dirRow;
      col += dirCol;

      // Stop at the pinned ring rather than clamping, so droplets do not pile
      // sediment against the boundary.
      if (row < 1 || row >= height - 2 || col < 1 || col >= width - 2) break;

      sample(dem, spec, row, col, next);
      const deltaHeight = next.height - current.height;

      const capacity = Math.max(
        -deltaHeight * speed * water * params.capacity,
        params.minSlope,
      );

      if (sediment > capacity || deltaHeight > 0) {
        // Uphill means the droplet has hit an obstruction: drop just enough to
        // fill it, which is what carves through minor pits instead of stalling.
        const amount =
          deltaHeight > 0
            ? Math.min(deltaHeight, sediment)
            : (sediment - capacity) * params.depositRate;
        sediment -= amount;
        deposit(cellRow, cellCol, amount);
      } else {
        const amount = Math.min((capacity - sediment) * params.erodeRate, -deltaHeight);
        for (let b = 0; b < brush.weights.length; b++) {
          const br = cellRow + brush.offsetsRow[b];
          const bc = cellCol + brush.offsetsCol[b];
          if (br < 1 || br >= height - 1 || bc < 1 || bc >= width - 1) continue;
          const bi = br * width + bc;
          const removed = Math.min(amount * brush.weights[b], dem[bi]);
          dem[bi] -= removed;
          sediment += removed;
        }
      }

      speed = Math.sqrt(Math.max(speed * speed - deltaHeight * params.gravity, 0));
      water *= 1 - params.evaporation;
      if (water < 0.01) break;
    }
  }

  for (let i = 0; i < dem.length; i++) dem[i] *= maxHeight;
}
