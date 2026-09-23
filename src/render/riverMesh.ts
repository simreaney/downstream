/**
 * The river network as ribbons lying in carved beds.
 *
 * Each traced reach becomes a strip of quads following the channel cells, with
 * half-width from the square root of contributing area — the usual hydraulic
 * geometry relation, and the reason the trunk looks like a trunk rather than a
 * uniform blue thread.
 *
 * Every vertex carries `aReachRisk`, sampled from in-channel risk. That single
 * Float32 attribute — a few thousand values, rewritten per recompute — is what
 * turns the model's output into something the player reads without opening a
 * map: the water below a critical source area runs cloudy.
 *
 * Widths are smoothed along each reach. FD8 accumulation is not monotonic down a
 * D8 path (flow spreads sideways to neighbours the path does not follow), so raw
 * widths would make the river pulse narrower and wider along its own length.
 *
 * ## Three steps: layout, bed, ribbon
 *
 * The ribbon used to be a flat strip at the terrain height under its
 * centreline, plus a few centimetres. That is wrong in two ways at once. A
 * valley floor rises towards both banks, so a strip three to six metres wide
 * that is level with its middle has its edges *inside* the ground; and the
 * terrain mesh only has a vertex every four metres, so even where the ground
 * under the middle is right the triangles between vertices are not. Streams
 * disappeared into their own banks and reappeared a few metres on.
 *
 * So the water is now built the way a real one is:
 *
 * 1. **Layout** (`layoutRiver`) — centreline, width, velocity, and a water
 *    level taken from the channel cells' own elevations and forced never to
 *    rise downstream, so the surface is a proper water surface rather than a
 *    copy of whatever ground the smoothed centreline happens to cross.
 * 2. **Bed** (`carveRiverBed`) — a shallow bed with gentle banks is carved into
 *    the *render* ground below that level. Render only, like a pond's bowl: the
 *    model routes on its own DEM and never sees this.
 * 3. **Ribbon** — five vertices across each section, each at the water level
 *    but never below the drawn ground (probed conservatively, so a crease in the
 *    terrain between ribbon vertices cannot poke through either) and never
 *    floating far above it at the banks.
 *
 * ## Why the ribbon is finer than the grid
 *
 * The centreline is resampled along a centripetal Catmull-Rom spline through the
 * cell centres, at `SAMPLES_PER_CELL` cross-sections per cell rather than one.
 * A D8 path can only leave a cell in one of eight directions, so a cell-per-quad
 * ribbon inherits those 45-degree steps and a meander comes out as a staircase.
 * Subdividing rounds the corners off and interpolates risk along the reach, so
 * the transition from clear to laden is a gradient rather than a seam.
 *
 * Centripetal parameterisation rather than uniform because cell centres are not
 * evenly spaced — a diagonal step is 5.7 m against a cardinal step's 4 m — and
 * uniform Catmull-Rom answers that unevenness with overshoot, throwing the
 * centreline out of its own channel on the sharpest bends.
 */

import * as THREE from "three";
import { smoothstep } from "../core/clamp";
import type { GridSpec } from "../core/grid";
import type { ReachDto } from "../worker/protocol";
import { sampleHeight } from "./terrainMesh";

/**
 * Half-width in metres at the channel head, and at the catchment outlet.
 *
 * The head is wider than hydraulic geometry alone would put it. A 1.4 m stream
 * is honest for a channel that has just initiated, and from a third-person
 * camera it is a thread a couple of pixels across that the eye reads as a seam
 * in the grass — which matters because a leaky dam is only legal *in* a
 * watercourse, so a player who cannot see one cannot place one.
 */
export const HALF_WIDTH_MIN = 1.5;
export const HALF_WIDTH_MAX = 3.1;

/** Smoothing passes over the width profile of each reach. */
const WIDTH_SMOOTHING_PASSES = 4;

/**
 * Cross-sections emitted per channel cell.
 *
 * 4 puts a cross-section every metre or so at this cell size, which is finer
 * than any crease the terrain can put between them.
 */
export const SAMPLES_PER_CELL = 4;

/**
 * Where each section's vertices sit across the channel, as a fraction of the
 * half-width: left bank to right bank, looking downstream.
 *
 * Five rather than two so the surface can be level across the middle and still
 * meet the ground at the banks; see `ribbonHeight`.
 */
export const BANK_POSITIONS: readonly number[] = [-1, -0.5, 0, 0.5, 1];
export const VERTICES_PER_SECTION = BANK_POSITIONS.length;

/**
 * Surface velocity bounds, in metres per second.
 *
 * Velocity drives only how the flow streaks move (see `waterMaterial.ts`), so
 * the clamp is about legibility: below the floor a pool looks frozen, above the
 * ceiling a steep head-water reach turns into a blur.
 */
const VELOCITY_MIN = 0.35;
const VELOCITY_MAX = 2.4;

/**
 * Surface velocity from local channel gradient and width.
 *
 * Manning's relation has velocity rising with the square root of slope and the
 * two-thirds power of hydraulic radius; width stands in for the radius here,
 * normalised to the trunk. The constants are chosen so a 1% slope on the trunk
 * lands near a metre a second, which is about right for a lowland stream.
 */
function surfaceVelocity(slope: number, halfWidth: number): number {
  const radius = (halfWidth / HALF_WIDTH_MAX) ** (2 / 3);
  const v = 0.3 + 6.5 * Math.sqrt(Math.max(slope, 0.0004)) * radius;
  return Math.min(VELOCITY_MAX, Math.max(VELOCITY_MIN, v));
}

/**
 * Smoothing passes over each reach's centreline, in cross-sections.
 *
 * The spline passes through every cell centre, so it still carries the D8
 * path's 45-degree steps as tight wiggles. Wherever one of those bends is
 * sharper than the ribbon is wide, the inside bank folds over itself and
 * throws a spike out across the grass. Relaxing the centreline rounds those out
 * into meanders. The ends are pinned so reaches still meet at their
 * confluences, and at 16 passes the line moves about a metre at most — and the
 * bed is carved along the relaxed line, so the water is never off its bed.
 */
const CENTRELINE_SMOOTHING_PASSES = 16;

/** Smoothing passes over each reach's slope profile, in cross-sections. */
const SLOPE_SMOOTHING_PASSES = 12;

/**
 * How far the water surface sits below the channel cell's own elevation.
 *
 * A little, so the surface reads as lying in the ground rather than on it, and
 * so the player — who walks on the carved ground — stands in the water rather
 * than on top of it.
 */
const WATER_BELOW_GROUND_M = 0.05;

/**
 * The carved bed: depth below the water surface on the centreline, and the
 * fraction of that depth left at the ribbon's edge.
 *
 * Only as deep as it needs to be. The water is nearly opaque, so the bed is
 * never seen; what the depth buys is margin, so that every terrain triangle
 * under the middle of the stream stays under the surface even though the
 * terrain only has a vertex every four metres. The player wades through it,
 * and a chibi's legs are short — much deeper and they would vanish.
 */
const BED_DEPTH_M = 0.24;
const BED_EDGE_FRACTION = 0.45;

/** Rise of the carved bank per metre beyond the ribbon's edge. */
const BANK_SLOPE = 0.18;

/**
 * Distance beyond the ribbon's edge over which the carve blends back into the
 * natural ground, in metres. One cell: enough to lay a bank, not enough to cut
 * a terrace into a steep valley side.
 */
const CARVE_MARGIN_M = 4;

/** Distance beyond the ribbon's edge that counts as "in the river" for props. */
const FOOTPRINT_MARGIN_M = 1.2;

/** Closest the ribbon is ever allowed to the drawn ground, in metres. */
const MIN_CLEARANCE_M = 0.05;

/**
 * Radius of the conservative ground probe under each ribbon vertex, in metres.
 *
 * The terrain is piecewise linear with a crease along every cell edge and
 * diagonal; the ribbon is piecewise linear with vertices about a metre apart.
 * A convex crease running between two ribbon vertices can rise above both. The
 * highest ground within this radius of a vertex bounds that.
 */
const CLEARANCE_PROBE_M = 0.5;

/**
 * Furthest a vertex may float above the ground, by position across the section.
 *
 * Where the terrain dips below the water level near a bank (a D8 path does not
 * always follow the lowest line of its valley), the surface follows the ground
 * down rather than hanging in the air.
 */
const MAX_RISE_EDGE_M = 0.25;
const MAX_RISE_HALF_M = 0.7;

/** One drawable reach, resampled into cross-sections. */
export interface ReachLayout {
  readonly sections: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly halfWidth: Float64Array;
  /** Water surface elevation, never rising downstream. */
  readonly level: Float64Array;
  /** Unit direction of flow in the ground plane. */
  readonly dirX: Float64Array;
  readonly dirZ: Float64Array;
  readonly velocity: Float64Array;
  /** Seconds of travel from the head of the reach. */
  readonly travel: Float64Array;
  /** Metres along the reach. */
  readonly along: Float64Array;
  /** Fractional position in the worker's per-cell risk array. */
  readonly riskIndex: Float64Array;
}

export type RiverLayout = readonly ReachLayout[];

export interface RiverMesh {
  readonly mesh: THREE.Mesh;
  /** Update the per-vertex risk after a recompute. */
  setReachRisk(risk: Float32Array): void;
  dispose(): void;
}

export interface RiverMeshOptions {
  /** A layout already computed, e.g. for carving; computed here if absent. */
  readonly layout?: RiverLayout;
  /**
   * The ground as drawn, which the ribbon must stay on top of. Defaults to the
   * model DEM; pass the carved render ground when there is one.
   */
  readonly ground?: Float32Array;
}

/** Resample every drawable reach into cross-sections. */
export function layoutRiver(
  reaches: readonly ReachDto[],
  dem: Float32Array,
  spec: GridSpec,
  outletAccum: number,
): RiverLayout {
  const layout: ReachLayout[] = [];
  const halfExtentX = (spec.width * spec.cellSize) / 2;
  const halfExtentZ = (spec.height * spec.cellSize) / 2;
  const point = new THREE.Vector3();

  // Risk is emitted for every reach the worker traced, including any too short
  // to draw, so the offset has to advance for skipped reaches too or every
  // reach after one would read another's sediment.
  let riskOffset = 0;

  for (const reach of reaches) {
    const count = reach.cells.length;
    const offset = riskOffset;
    riskOffset += count;
    if (count < 2) continue;

    // Width from sqrt(area), then smoothed so the ribbon does not pulse.
    const widths = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const t = Math.min(1, Math.sqrt(Math.abs(reach.accum[i]) / outletAccum));
      widths[i] = HALF_WIDTH_MIN + (HALF_WIDTH_MAX - HALF_WIDTH_MIN) * t;
    }
    for (let pass = 0; pass < WIDTH_SMOOTHING_PASSES; pass++) {
      let previous = widths[0];
      for (let i = 1; i < count - 1; i++) {
        const smoothed = (previous + widths[i] * 2 + widths[i + 1]) / 4;
        previous = widths[i];
        widths[i] = smoothed;
      }
    }

    // Water level per cell, never rising downstream: through a pit in the DEM
    // it holds the pit's level rather than following the ground back up.
    const levels = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const own = dem[reach.cells[i]] - WATER_BELOW_GROUND_M;
      levels[i] = i === 0 ? own : Math.min(own, levels[i - 1]);
    }

    const controls: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const cell = reach.cells[i];
      const row = (cell / spec.width) | 0;
      const col = cell % spec.width;
      controls.push(
        new THREE.Vector3(
          (col + 0.5) * spec.cellSize - halfExtentX,
          0,
          (row + 0.5) * spec.cellSize - halfExtentZ,
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(controls, false, "centripetal");

    // `getPoint` maps its parameter onto the control points linearly, so
    // t = j / segments lands on cell j / SAMPLES_PER_CELL — which is what lets
    // widths, levels and risk be indexed by the same fractional cell coordinate.
    const segments = (count - 1) * SAMPLES_PER_CELL;
    const sections = segments + 1;
    const x = new Float64Array(sections);
    const z = new Float64Array(sections);
    const halfWidth = new Float64Array(sections);
    const level = new Float64Array(sections);
    const riskIndex = new Float64Array(sections);

    for (let j = 0; j < sections; j++) {
      curve.getPoint(j / segments, point);
      x[j] = point.x;
      z[j] = point.z;

      const u = j / SAMPLES_PER_CELL;
      const cell = Math.min(count - 1, Math.floor(u));
      const next = Math.min(count - 1, cell + 1);
      const f = u - cell;
      halfWidth[j] = widths[cell] + (widths[next] - widths[cell]) * f;
      level[j] = levels[cell] + (levels[next] - levels[cell]) * f;
      riskIndex[j] = offset + u;
    }

    for (let pass = 0; pass < CENTRELINE_SMOOTHING_PASSES; pass++) {
      for (const axis of [x, z]) {
        let previous = axis[0];
        for (let j = 1; j < sections - 1; j++) {
          const current = axis[j];
          axis[j] = (previous + current * 2 + axis[j + 1]) / 4;
          previous = current;
        }
      }
    }

    // Local gradient of the water surface, from a centred difference one cell
    // either side and then smoothed, so velocity does not surge and stall.
    const slopes = new Float64Array(sections);
    for (let j = 0; j < sections; j++) {
      const before = Math.max(0, j - SAMPLES_PER_CELL);
      const after = Math.min(sections - 1, j + SAMPLES_PER_CELL);
      const run = Math.hypot(x[after] - x[before], z[after] - z[before]);
      slopes[j] = run > 1e-6 ? Math.max(0, (level[before] - level[after]) / run) : 0;
    }
    for (let pass = 0; pass < SLOPE_SMOOTHING_PASSES; pass++) {
      let previous = slopes[0];
      for (let j = 1; j < sections - 1; j++) {
        const smoothed = (previous + slopes[j] * 2 + slopes[j + 1]) / 4;
        previous = slopes[j];
        slopes[j] = smoothed;
      }
    }

    const dirX = new Float64Array(sections);
    const dirZ = new Float64Array(sections);
    const velocity = new Float64Array(sections);
    const travel = new Float64Array(sections);
    const along = new Float64Array(sections);

    for (let j = 0; j < sections; j++) {
      // Two sections either side, so the tangent — and with it the bank offset
      // — turns smoothly instead of kinking at each section.
      const before = Math.max(j - 2, 0);
      const after = Math.min(j + 2, sections - 1);
      let dx = x[after] - x[before];
      let dz = z[after] - z[before];
      const length = Math.hypot(dx, dz);
      if (length < 1e-9) {
        dx = 0;
        dz = 1;
      } else {
        dx /= length;
        dz /= length;
      }
      dirX[j] = dx;
      dirZ[j] = dz;
      velocity[j] = surfaceVelocity(slopes[j], halfWidth[j]);

      if (j > 0) {
        const step = Math.hypot(x[j] - x[j - 1], z[j] - z[j - 1]);
        along[j] = along[j - 1] + step;
        // Trapezoidal: the mean of the two ends' slowness over the step.
        travel[j] = travel[j - 1] + step * 0.5 * (1 / velocity[j] + 1 / velocity[j - 1]);
      }
    }

    layout.push({ sections, x, z, halfWidth, level, dirX, dirZ, velocity, travel, along, riskIndex });
  }

  return layout;
}

/**
 * Carve beds for every reach into `ground`, in place.
 *
 * Only ever lowers the ground, so overlapping reaches at a confluence simply
 * take the deeper of their two beds. Returns a mask of the cells the water or
 * its immediate banks cover, for keeping trees and rocks out of the stream.
 */
export function carveRiverBed(ground: Float32Array, spec: GridSpec, layout: RiverLayout): Uint8Array {
  const { width, height, cellSize } = spec;
  const halfExtentX = (width * cellSize) / 2;
  const halfExtentZ = (height * cellSize) / 2;
  const footprint = new Uint8Array(width * height);

  for (const reach of layout) {
    for (let j = 0; j < reach.sections; j++) {
      const cx = reach.x[j];
      const cz = reach.z[j];
      const hw = reach.halfWidth[j];
      const surface = reach.level[j];
      const reachOut = hw + CARVE_MARGIN_M;

      const colMin = Math.max(0, Math.floor((cx - reachOut + halfExtentX) / cellSize - 0.5));
      const colMax = Math.min(width - 1, Math.ceil((cx + reachOut + halfExtentX) / cellSize - 0.5));
      const rowMin = Math.max(0, Math.floor((cz - reachOut + halfExtentZ) / cellSize - 0.5));
      const rowMax = Math.min(height - 1, Math.ceil((cz + reachOut + halfExtentZ) / cellSize - 0.5));

      for (let row = rowMin; row <= rowMax; row++) {
        const vz = (row + 0.5) * cellSize - halfExtentZ;
        for (let col = colMin; col <= colMax; col++) {
          const vx = (col + 0.5) * cellSize - halfExtentX;
          const distance = Math.hypot(vx - cx, vz - cz);
          if (distance > reachOut) continue;

          let target: number;
          if (distance <= hw) {
            const t = distance / hw;
            target = surface - BED_DEPTH_M * (1 - (1 - BED_EDGE_FRACTION) * t * t);
          } else {
            target = surface - BED_DEPTH_M * BED_EDGE_FRACTION + (distance - hw) * BANK_SLOPE;
          }

          const cell = row * width + col;
          const current = ground[cell];
          const blend = smoothstep(hw + CARVE_MARGIN_M * 0.25, reachOut, distance);
          const carved = target + (current - target) * blend;
          if (carved < current) ground[cell] = carved;
          if (distance < hw + FOOTPRINT_MARGIN_M) footprint[cell] = 1;
        }
      }
    }
  }

  return footprint;
}

/** Highest drawn ground within the probe radius of a point. */
function groundCeiling(ground: Float32Array, spec: GridSpec, x: number, z: number): number {
  const r = CLEARANCE_PROBE_M;
  return Math.max(
    sampleHeight(ground, spec, x, z),
    sampleHeight(ground, spec, x + r, z),
    sampleHeight(ground, spec, x - r, z),
    sampleHeight(ground, spec, x, z + r),
    sampleHeight(ground, spec, x, z - r),
  );
}

/**
 * Height of one ribbon vertex: at the water level, never under the ground, and
 * — towards the banks — never floating far above it.
 */
function ribbonHeight(surface: number, groundTop: number, bank: number): number {
  const lowest = groundTop + MIN_CLEARANCE_M;
  const reach = Math.abs(bank);
  const rise = reach >= 1 ? MAX_RISE_EDGE_M : reach >= 0.5 ? MAX_RISE_HALF_M : Infinity;
  return Math.max(lowest, Math.min(surface, groundTop + rise));
}

export function createRiverMesh(
  reaches: readonly ReachDto[],
  dem: Float32Array,
  spec: GridSpec,
  outletAccum: number,
  material: THREE.Material,
  options: RiverMeshOptions = {},
): RiverMesh {
  const layout = options.layout ?? layoutRiver(reaches, dem, spec, outletAccum);
  const ground = options.ground ?? dem;

  const positions: number[] = [];
  const normals: number[] = [];
  const risks: number[] = [];
  const banks: number[] = [];
  const travels: number[] = [];
  const dirs: number[] = [];
  const indices: number[] = [];
  /** Each section's position in the risk array, in section order. */
  const sampleIndex: number[] = [];

  for (const reach of layout) {
    const firstVertex = positions.length / 3;

    for (let j = 0; j < reach.sections; j++) {
      // Right-hand perpendicular in the ground plane, looking downstream.
      const sideX = -reach.dirZ[j];
      const sideZ = reach.dirX[j];
      const hw = reach.halfWidth[j];
      sampleIndex.push(reach.riskIndex[j]);

      for (const bank of BANK_POSITIONS) {
        const vx = reach.x[j] + sideX * hw * bank;
        const vz = reach.z[j] + sideZ * hw * bank;
        const y = ribbonHeight(reach.level[j], groundCeiling(ground, spec, vx, vz), bank);

        positions.push(vx, y, vz);
        // Flat upward normal: the surface is water, and letting it pick up the
        // valley's shading would make it read as wet rock.
        normals.push(0, 1, 0);
        risks.push(0);
        banks.push(bank);
        travels.push(reach.travel[j]);
        dirs.push(reach.dirX[j] * reach.velocity[j], reach.dirZ[j] * reach.velocity[j]);
      }
    }

    for (let j = 0; j < reach.sections - 1; j++) {
      for (let k = 0; k < VERTICES_PER_SECTION - 1; k++) {
        // Winding matters here and is easy to get backwards. Bank positions run
        // left to right looking downstream, so vertex `a` lies to the left of
        // `b`; ordering them a, b, c puts the face normal up (the test suite
        // checks every face). Reversed, the
        // surface faces down, and because the material is double-sided three
        // then flips the normal per fragment and shades the water with the
        // hemisphere light's *ground* colour — which renders a perfectly correct
        // river in murky grey and looks like a colour bug.
        const a = firstVertex + j * VERTICES_PER_SECTION + k;
        const b = a + 1;
        const c = a + VERTICES_PER_SECTION;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aReachRisk", new THREE.Float32BufferAttribute(risks, 1));
  geometry.setAttribute("aBank", new THREE.Float32BufferAttribute(banks, 1));
  geometry.setAttribute("aTravel", new THREE.Float32BufferAttribute(travels, 1));
  geometry.setAttribute("aDir", new THREE.Float32BufferAttribute(dirs, 2));
  geometry.setIndex(indices);

  const riskAttribute = geometry.getAttribute("aReachRisk") as THREE.BufferAttribute;
  riskAttribute.setUsage(THREE.DynamicDrawUsage);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Drawn after the terrain so the transparent surface blends over the ground
  // rather than being sorted against it arbitrarily.
  mesh.renderOrder = 1;

  return {
    mesh,

    setReachRisk(risk) {
      // The worker emits one value per reach cell, in the same reach order this
      // mesh was built from. The ribbon carries several sections per cell, so
      // each one reads the risk array at its own fractional cell coordinate and
      // interpolates. Every vertex of a section shares the value: risk varies
      // along the channel, not across it.
      const last = risk.length - 1;
      if (last < 0) return;

      const target = riskAttribute.array as Float32Array;
      for (let p = 0; p < sampleIndex.length; p++) {
        const u = sampleIndex[p];
        // Clamped rather than assumed in range: a risk array shorter than the
        // reaches this mesh was built from must hold the last value, not read
        // past the end.
        const cell = Math.min(last, Math.floor(u));
        const next = Math.min(last, cell + 1);
        const value = risk[cell] + (risk[next] - risk[cell]) * (u - cell);
        for (let k = 0; k < VERTICES_PER_SECTION; k++) {
          target[p * VERTICES_PER_SECTION + k] = value;
        }
      }
      riskAttribute.needsUpdate = true;
    },

    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
    },
  };
}
