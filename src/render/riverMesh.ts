/**
 * The river network as extruded ribbons.
 *
 * Each traced reach becomes a strip of quads following the channel cells, with
 * half-width from the square root of contributing area — the usual hydraulic
 * geometry relation, and the reason the trunk looks like a trunk rather than a
 * uniform blue thread.
 *
 * Every vertex carries `aReachRisk`, sampled from in-channel risk. That single
 * Float32 attribute — a few thousand values, rewritten per recompute — is what
 * turns the model's output into something the player reads without opening a
 * map: the water below a critical source area runs brown.
 *
 * Widths are smoothed along each reach. FD8 accumulation is not monotonic down a
 * D8 path (flow spreads sideways to neighbours the path does not follow), so raw
 * widths would make the river pulse narrower and wider along its own length.
 *
 * ## Why the ribbon is finer than the grid
 *
 * The centreline is resampled along a centripetal Catmull-Rom spline through the
 * cell centres, at `SAMPLES_PER_CELL` cross-sections per cell rather than one.
 * A D8 path can only leave a cell in one of eight directions, so a cell-per-quad
 * ribbon inherits those 45-degree steps and a meander comes out as a staircase.
 * Subdividing costs a few thousand extra vertices, built once, and buys three
 * things at that price: the corners round off, the strip is re-fitted to the
 * terrain between cell centres instead of spanning up to 5.7 m of hillside in
 * one flat quad, and risk is interpolated along the reach so the transition from
 * clear to laden is a gradient rather than a visible seam at a cell boundary.
 *
 * Centripetal parameterisation rather than uniform because cell centres are not
 * evenly spaced — a diagonal step is 5.7 m against a cardinal step's 4 m — and
 * uniform Catmull-Rom answers that unevenness with overshoot, throwing the
 * centreline out of its own channel on the sharpest bends.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import type { ReachDto } from "../worker/protocol";
import { sampleHeight } from "./terrainMesh";

/** Half-width in metres at the channel head, and at the catchment outlet. */
const HALF_WIDTH_MIN = 0.7;
const HALF_WIDTH_MAX = 2.6;

/** Lift above the ground, in metres, to stop the ribbon z-fighting the terrain. */
const SURFACE_LIFT = 0.12;

/** Smoothing passes over the width profile of each reach. */
const WIDTH_SMOOTHING_PASSES = 4;

/**
 * Cross-sections emitted per channel cell.
 *
 * 1 reproduces the one-quad-per-cell ribbon exactly. 4 puts a cross-section
 * every metre or so at this cell size, which is below what the curved-world
 * bend and the 0.12 m surface lift can hide, so going finer only adds vertices.
 */
export const SAMPLES_PER_CELL = 4;

export interface RiverMesh {
  readonly mesh: THREE.Mesh;
  /** Update the per-vertex risk after a recompute. */
  setReachRisk(risk: Float32Array): void;
  dispose(): void;
}

export function createRiverMesh(
  reaches: readonly ReachDto[],
  dem: Float32Array,
  spec: GridSpec,
  outletAccum: number,
  material: THREE.Material,
): RiverMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const risks: number[] = [];
  const flows: number[] = [];
  const banks: number[] = [];
  const indices: number[] = [];

  const halfWidth = (spec.width * spec.cellSize) / 2;
  const halfHeight = (spec.height * spec.cellSize) / 2;

  const worldOf = (cell: number, out: THREE.Vector3): THREE.Vector3 => {
    const row = (cell / spec.width) | 0;
    const col = cell % spec.width;
    const x = (col + 0.5) * spec.cellSize - halfWidth;
    const z = (row + 0.5) * spec.cellSize - halfHeight;
    return out.set(x, sampleHeight(dem, spec, x, z) + SURFACE_LIFT, z);
  };

  const here = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const behind = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const side = new THREE.Vector3();

  /**
   * Position of each cross-section in the *risk* array, as a fractional index.
   *
   * The bridge between a ribbon that is finer than the grid and a risk array
   * that has one value per channel cell. Whole numbers land on cell centres;
   * everything between is interpolated on upload.
   */
  const sampleIndex: number[] = [];

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

    const centreline: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) centreline.push(worldOf(reach.cells[i], new THREE.Vector3()));
    const curve = new THREE.CatmullRomCurve3(centreline, false, "centripetal");

    // `getPoint` maps its parameter onto the control points linearly, so
    // t = j / segments lands on cell j / SAMPLES_PER_CELL — which is what lets
    // widths and risk be indexed by the same fractional cell coordinate.
    const segments = (count - 1) * SAMPLES_PER_CELL;
    const sampleCount = segments + 1;
    const centres = new Float64Array(sampleCount * 3);
    const sampleWidth = new Float64Array(sampleCount);

    for (let j = 0; j < sampleCount; j++) {
      curve.getPoint(j / segments, here);

      // Height comes from the terrain at the sampled position rather than from
      // the spline, so the ribbon lies on the ground it crosses instead of
      // chording between cell centres.
      centres[j * 3] = here.x;
      centres[j * 3 + 1] = sampleHeight(dem, spec, here.x, here.z) + SURFACE_LIFT;
      centres[j * 3 + 2] = here.z;

      const u = j / SAMPLES_PER_CELL;
      const cell = Math.min(count - 1, Math.floor(u));
      const next = Math.min(count - 1, cell + 1);
      sampleWidth[j] = widths[cell] + (widths[next] - widths[cell]) * (u - cell);
      sampleIndex.push(offset + u);
    }

    const firstVertex = positions.length / 3;

    let along = 0;
    for (let j = 0; j < sampleCount; j++) {
      here.set(centres[j * 3], centres[j * 3 + 1], centres[j * 3 + 2]);
      const before = Math.max(j - 1, 0);
      const after = Math.min(j + 1, sampleCount - 1);
      behind.set(centres[before * 3], centres[before * 3 + 1], centres[before * 3 + 2]);
      ahead.set(centres[after * 3], centres[after * 3 + 1], centres[after * 3 + 2]);

      // Central difference for the tangent, so corners are mitred rather than
      // producing a visible kink at every cross-section.
      direction.subVectors(ahead, behind);
      direction.y = 0;
      if (direction.lengthSq() < 1e-9) direction.set(0, 0, 1);
      direction.normalize();

      // Left-hand perpendicular in the ground plane.
      side.set(-direction.z, 0, direction.x).multiplyScalar(sampleWidth[j]);

      if (j > 0) along += here.distanceTo(behind);

      for (const sign of [-1, 1]) {
        positions.push(here.x + side.x * sign, here.y, here.z + side.z * sign);
        // Flat upward normal: the surface is water, and letting it pick up the
        // valley's shading would make it read as wet rock.
        normals.push(0, 1, 0);
        risks.push(0);
        flows.push(along);
        banks.push(sign);
      }
    }

    for (let j = 0; j < sampleCount - 1; j++) {
      // Winding matters here and is easy to get backwards. `side` is the
      // left-hand perpendicular, so vertex `a` (sign -1) lies to the right of
      // travel and `b` to the left; ordering them a, b, c puts the face normal
      // up. Reversed, the surface faces down, and because the material is
      // double-sided three then flips the normal per fragment and shades the
      // water with the hemisphere light's *ground* colour — which renders a
      // perfectly correct river in murky grey and looks like a colour bug.
      const a = firstVertex + j * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aReachRisk", new THREE.Float32BufferAttribute(risks, 1));
  geometry.setAttribute("aFlow", new THREE.Float32BufferAttribute(flows, 1));
  geometry.setAttribute("aBank", new THREE.Float32BufferAttribute(banks, 1));
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
      // mesh was built from. The ribbon carries several cross-sections per cell,
      // so each one reads the risk array at its own fractional cell coordinate
      // and interpolates — which also removes the step the old cell-per-quad
      // mapping put at every cell boundary. Both vertices of a cross-section
      // share the value: risk varies along the channel, not across it.
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
        target[p * 2] = value;
        target[p * 2 + 1] = value;
      }
      riskAttribute.needsUpdate = true;
    },

    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
    },
  };
}
