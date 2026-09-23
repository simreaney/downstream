/**
 * The village as a place: cottages facing a green, a well at its middle, and
 * gravel paths from every front door to the well.
 *
 * `terrain/sites.ts` decides *where* the cottages go, from the hydrology. This
 * decides how they sit together, which is what makes seven houses read as a
 * village rather than as seven houses. Scattered at random rotations they did
 * not: nothing tied them to each other, and from the diorama camera a village
 * looked like a few buildings someone had dropped on a field. Turning every
 * front door to face a shared green, and drawing the paths people would have
 * worn between them, is most of the difference.
 *
 * The paths are thin draped ribbons rather than painted cells, because a 4 m
 * cell is three times the width of a path, and they are a prop rather than land
 * cover: the model never sees them, and they claim nothing about erosion.
 */

import * as THREE from "three";
import { markSquare, type GridSpec } from "../core/grid";
import { cottageDoor } from "../props/building";
import type { SitesDto } from "../worker/protocol";
import { applyCurvature, type CurvatureUniforms } from "./curvature";
import { GLSL_NOISE } from "./glsl";
import { cellToWorld, sampleHeight, sampleNormal, worldToCell } from "./terrainMesh";

/** Half-width of a path, in metres. */
const PATH_HALF_WIDTH_M = 0.6;
/** Spacing of path cross-sections, in metres. */
const PATH_STEP_M = 0.6;
/** Lift over the ground, in metres; enough to clear the terrain's creases. */
const PATH_LIFT_M = 0.035;
/**
 * Radius of the round gravel patch around the well, in metres, and how far
 * inside its edge the paths run before they stop — so each one merges into
 * the patch instead of the seven of them crowding into a fan at the well wall.
 */
const WELL_PATCH_M = 2.6;
const WELL_CLEARANCE_M = WELL_PATCH_M * 0.75;
/** Rings and segments of the gravel patch. */
const PATCH_RINGS = 4;
const PATCH_SEGMENTS = 20;
/** Largest sideways bow in a path, in metres, so they curve like worn tracks. */
const PATH_BOW_M = 1.4;

export interface PlannedCottage {
  readonly cell: number;
  readonly x: number;
  readonly z: number;
  /** Rotation about Y turning the front door towards the green. */
  readonly rotation: number;
  /** Colour scheme and mirroring, 0 to 3. */
  readonly variant: number;
}

export interface PlannedBush {
  readonly x: number;
  readonly z: number;
  readonly rotation: number;
  readonly scale: number;
}

export interface VillagePlan {
  readonly cottages: readonly PlannedCottage[];
  readonly well: { readonly x: number; readonly z: number };
  /** Each path as a polyline of x, z pairs, door first. */
  readonly paths: readonly Float64Array[];
  readonly bushes: readonly PlannedBush[];
  /** Cells trees and boulders must stay out of: plots, the green, the paths. */
  readonly clearance: Uint8Array;
}

/** A small deterministic hash to [0, 1), so a village is laid out the same on every load. */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function planVillage(sites: SitesDto, spec: GridSpec): VillagePlan {
  const clearance = new Uint8Array(spec.width * spec.height);
  const centre = cellToWorld(spec, sites.villageCell, new THREE.Vector3());
  markSquare(clearance, spec, sites.villageCell, 1);

  const cottages: PlannedCottage[] = [];
  const bushes: PlannedBush[] = [];
  const paths: Float64Array[] = [];
  const position = new THREE.Vector3();

  sites.cottageCells.forEach((cell, index) => {
    cellToWorld(spec, cell, position);
    const variant = index % 4;
    // Local +z is the front of a cottage (see props/building.ts), and a
    // rotation of θ about Y carries +z to (sin θ, cos θ).
    const rotation = Math.atan2(centre.x - position.x, centre.z - position.z);
    cottages.push({ cell, x: position.x, z: position.z, rotation, variant });
    markSquare(clearance, spec, cell, 1);

    const sin = Math.sin(rotation);
    const cos = Math.cos(rotation);
    const toWorld = (lx: number, lz: number): [number, number] => [
      position.x + lx * cos + lz * sin,
      position.z - lx * sin + lz * cos,
    ];

    // A shrub either side of the front, sized a little differently each.
    for (const side of [-1, 1]) {
      const [bx, bz] = toWorld(side * 2.25, 0.85);
      bushes.push({
        x: bx,
        z: bz,
        rotation: hash01(cell * 2 + side) * Math.PI * 2,
        scale: 0.8 + hash01(cell * 7 + side) * 0.4,
      });
    }

    // Path: from just in front of the door to the edge of the well, bowed to
    // one side by a stable amount so no two look ruled.
    const door = cottageDoor(variant);
    const [sx, sz] = toWorld(door.x, door.z + 0.55);
    const toDoorX = sx - centre.x;
    const toDoorZ = sz - centre.z;
    const length = Math.hypot(toDoorX, toDoorZ);
    if (length <= WELL_CLEARANCE_M + 0.5) return;
    const ex = centre.x + (toDoorX / length) * WELL_CLEARANCE_M;
    const ez = centre.z + (toDoorZ / length) * WELL_CLEARANCE_M;

    const bow = (hash01(cell * 13) - 0.5) * 2 * PATH_BOW_M;
    const mx = (sx + ex) / 2 + (-(ez - sz) / length) * bow;
    const mz = (sz + ez) / 2 + ((ex - sx) / length) * bow;

    const steps = Math.max(2, Math.ceil(length / PATH_STEP_M));
    const line = new Float64Array((steps + 1) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const x = u * u * sx + 2 * u * t * mx + t * t * ex;
      const z = u * u * sz + 2 * u * t * mz + t * t * ez;
      line[i * 2] = x;
      line[i * 2 + 1] = z;
      const under = worldToCell(spec, x, z);
      if (under >= 0) clearance[under] = 1;
    }
    paths.push(line);
  });

  return { cottages, well: { x: centre.x, z: centre.z }, paths, bushes, clearance };
}

export interface VillagePaths {
  readonly mesh: THREE.Mesh;
  dispose(): void;
}

/**
 * The paths as one mesh of draped ribbons.
 *
 * Three vertices across, each on the drawn ground plus a small lift, with the
 * ground's own normal so the path shades with the slope it crosses. The edges
 * fade out rather than ending in a line, and a little gravel speckle keeps the
 * surface from reading as a flat stripe of paint.
 */
export function createVillagePaths(
  plan: VillagePlan,
  ground: Float32Array,
  spec: GridSpec,
  curvature: CurvatureUniforms,
  gradientMap: THREE.Texture,
): VillagePaths {
  const positions: number[] = [];
  const normals: number[] = [];
  const edges: number[] = [];
  const indices: number[] = [];
  const normal = new THREE.Vector3();

  // The gravel patch round the well: rings of vertices draped on the ground,
  // with the edge coordinate running 0 at the middle to 1 at the rim so it
  // fades out the same way the paths' edges do.
  {
    const first = positions.length / 3;
    const { x: cx, z: cz } = plan.well;
    const y0 = sampleHeight(ground, spec, cx, cz) + PATH_LIFT_M;
    sampleNormal(ground, spec, cx, cz, normal);
    positions.push(cx, y0, cz);
    normals.push(normal.x, normal.y, normal.z);
    edges.push(0);
    for (let ring = 1; ring <= PATCH_RINGS; ring++) {
      const radius = (ring / PATCH_RINGS) * WELL_PATCH_M;
      for (let k = 0; k < PATCH_SEGMENTS; k++) {
        const angle = (k / PATCH_SEGMENTS) * Math.PI * 2;
        const x = cx + Math.cos(angle) * radius;
        const z = cz + Math.sin(angle) * radius;
        sampleNormal(ground, spec, x, z, normal);
        positions.push(x, sampleHeight(ground, spec, x, z) + PATH_LIFT_M, z);
        normals.push(normal.x, normal.y, normal.z);
        edges.push(ring / PATCH_RINGS);
      }
    }
    // Wound so faces point up: counter-clockwise seen from above, which with
    // x east and z south is decreasing angle.
    const vertex = (ring: number, k: number): number =>
      ring === 0 ? first : first + 1 + (ring - 1) * PATCH_SEGMENTS + (k % PATCH_SEGMENTS);
    for (let k = 0; k < PATCH_SEGMENTS; k++) {
      indices.push(vertex(0, 0), vertex(1, k + 1), vertex(1, k));
      for (let ring = 1; ring < PATCH_RINGS; ring++) {
        const a = vertex(ring, k);
        const b = vertex(ring, k + 1);
        const c = vertex(ring + 1, k);
        const d = vertex(ring + 1, k + 1);
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  for (const line of plan.paths) {
    const count = line.length / 2;
    const first = positions.length / 3;

    for (let i = 0; i < count; i++) {
      const before = Math.max(0, i - 1);
      const after = Math.min(count - 1, i + 1);
      let dx = line[after * 2] - line[before * 2];
      let dz = line[after * 2 + 1] - line[before * 2 + 1];
      const length = Math.hypot(dx, dz) || 1;
      dx /= length;
      dz /= length;

      for (const bank of [-1, 0, 1]) {
        const x = line[i * 2] - dz * PATH_HALF_WIDTH_M * bank;
        const z = line[i * 2 + 1] + dx * PATH_HALF_WIDTH_M * bank;
        // The highest ground a little either side along the path, so a crease
        // between two cross-sections cannot rise through it.
        const y =
          Math.max(
            sampleHeight(ground, spec, x, z),
            sampleHeight(ground, spec, x + dx * 0.3, z + dz * 0.3),
            sampleHeight(ground, spec, x - dx * 0.3, z - dz * 0.3),
          ) + PATH_LIFT_M;
        sampleNormal(ground, spec, x, z, normal);
        positions.push(x, y, z);
        normals.push(normal.x, normal.y, normal.z);
        edges.push(bank);
      }
    }

    for (let i = 0; i < count - 1; i++) {
      for (let k = 0; k < 2; k++) {
        // Same winding rule as the river ribbon: left to right, then onward.
        const a = first + i * 3 + k;
        const b = a + 1;
        const c = a + 3;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aEdge", new THREE.Float32BufferAttribute(edges, 1));
  geometry.setIndex(indices);

  const material = new THREE.MeshToonMaterial({
    color: 0xeadcc4,
    gradientMap,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aEdge;\nvarying float vEdge;\nvarying vec2 vPathWorld;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvEdge = aEdge;\nvPathWorld = (modelMatrix * vec4(transformed, 1.0)).xz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying float vEdge;
        varying vec2 vPathWorld;
        ${GLSL_NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          // Gravel: a speckle of lighter and darker stones about 12 cm across,
          // faded out once they would be smaller than a couple of pixels.
          vec2 stones = vPathWorld * 8.0;
          float speckle = cwHash(floor(stones));
          float resolved = 1.0 - smoothstep(0.15, 0.4, length(fwidth(stones)));
          diffuseColor.rgb *= 1.0 + (speckle - 0.5) * 0.16 * resolved;
          // Worn middle, grassy margins: slightly darker along the centre line
          // where feet go, and a soft fade at the edges into the ground.
          diffuseColor.rgb *= 1.0 - (1.0 - abs(vEdge)) * 0.04;
          diffuseColor.a *= 1.0 - smoothstep(0.55, 1.0, abs(vEdge));
        }`,
      );
  };
  applyCurvature(material, curvature, "path");

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  // Before the water (1) and the flood (2), after the opaque ground.
  mesh.renderOrder = 0;

  return {
    mesh,
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
