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

  for (const reach of reaches) {
    const count = reach.cells.length;
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

    const firstVertex = positions.length / 3;

    let along = 0;
    for (let i = 0; i < count; i++) {
      worldOf(reach.cells[i], here);
      worldOf(reach.cells[Math.max(i - 1, 0)], behind);
      worldOf(reach.cells[Math.min(i + 1, count - 1)], ahead);

      // Central difference for the tangent, so corners are mitred rather than
      // producing a visible kink at every cell boundary.
      direction.subVectors(ahead, behind);
      direction.y = 0;
      if (direction.lengthSq() < 1e-9) direction.set(0, 0, 1);
      direction.normalize();

      // Left-hand perpendicular in the ground plane.
      side.set(-direction.z, 0, direction.x).multiplyScalar(widths[i]);

      if (i > 0) along += here.distanceTo(behind);

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

    for (let i = 0; i < count - 1; i++) {
      // Winding matters here and is easy to get backwards. `side` is the
      // left-hand perpendicular, so vertex `a` (sign -1) lies to the right of
      // travel and `b` to the left; ordering them a, b, c puts the face normal
      // up. Reversed, the surface faces down, and because the material is
      // double-sided three then flips the normal per fragment and shades the
      // water with the hemisphere light's *ground* colour — which renders a
      // perfectly correct river in murky grey and looks like a colour bug.
      const a = firstVertex + i * 2;
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
      // mesh was built from; each cell owns the two vertices across the ribbon.
      const target = riskAttribute.array as Float32Array;
      const shared = Math.min(risk.length, target.length >> 1);
      for (let i = 0; i < shared; i++) {
        target[i * 2] = risk[i];
        target[i * 2 + 1] = risk[i];
      }
      riskAttribute.needsUpdate = true;
    },

    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
    },
  };
}
