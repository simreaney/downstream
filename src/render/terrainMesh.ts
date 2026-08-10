/**
 * The terrain mesh: one BufferGeometry, one draw call.
 *
 * 65,536 vertices and 130,050 triangles is nothing for any GPU that can run
 * WebGL2, so chunking the terrain would buy no performance and cost LOD seams,
 * per-chunk material patching and a bounding-volume bug for every one of them.
 * A single mesh also means the risk overlay is a single texture bind.
 *
 * One vertex per grid cell, positioned at the cell centre and carrying that
 * cell's elevation. The world is centred on the origin so the catchment spans
 * [-512, 512] metres in x and z, which keeps float precision comfortable and
 * makes the curved-world bend symmetric about the player.
 *
 * `uv` is the cell coordinate, so the overlay texture is sampled directly with
 * no transform — the fragment shader reads risk for the cell it is standing on.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";

export interface TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  /** Rewrite elevations for a rectangular patch, e.g. when a pond is dug. */
  updatePatch(dem: Float32Array, x: number, y: number, w: number, h: number): void;
}

/** World-space position of a cell centre, given the centred layout. */
export function cellToWorld(spec: GridSpec, cell: number, out: THREE.Vector3): THREE.Vector3 {
  const halfWidth = (spec.width * spec.cellSize) / 2;
  const halfHeight = (spec.height * spec.cellSize) / 2;
  const row = (cell / spec.width) | 0;
  const col = cell % spec.width;
  return out.set(
    (col + 0.5) * spec.cellSize - halfWidth,
    0,
    (row + 0.5) * spec.cellSize - halfHeight,
  );
}

/** Grid cell containing a world position, or -1 if outside the catchment. */
export function worldToCell(spec: GridSpec, x: number, z: number): number {
  const halfWidth = (spec.width * spec.cellSize) / 2;
  const halfHeight = (spec.height * spec.cellSize) / 2;
  const col = Math.floor((x + halfWidth) / spec.cellSize);
  const row = Math.floor((z + halfHeight) / spec.cellSize);
  if (row < 0 || row >= spec.height || col < 0 || col >= spec.width) return -1;
  return row * spec.width + col;
}

/**
 * Ground height at a world position, bilinearly interpolated.
 *
 * The player follows this rather than raycasting the terrain mesh. A raycast
 * against 130,000 triangles every frame is wasteful when the surface is a
 * heightfield on a regular grid and the answer is four array reads — and it
 * would also disagree with the visible ground, since the curvature shader
 * displaces the rendered geometry away from what the CPU has.
 */
export function sampleHeight(dem: Float32Array, spec: GridSpec, x: number, z: number): number {
  const { width, height, cellSize } = spec;
  const halfWidth = (width * cellSize) / 2;
  const halfHeight = (height * cellSize) / 2;

  // Vertices sit at cell centres, so shift by half a cell before interpolating.
  const gx = (x + halfWidth) / cellSize - 0.5;
  const gz = (z + halfHeight) / cellSize - 0.5;

  const col = Math.min(Math.max(Math.floor(gx), 0), width - 2);
  const row = Math.min(Math.max(Math.floor(gz), 0), height - 2);
  const fx = Math.min(Math.max(gx - col, 0), 1);
  const fz = Math.min(Math.max(gz - row, 0), 1);

  const i = row * width + col;
  const nw = dem[i];
  const ne = dem[i + 1];
  const sw = dem[i + width];
  const se = dem[i + width + 1];

  return (
    nw * (1 - fx) * (1 - fz) + ne * fx * (1 - fz) + sw * (1 - fx) * fz + se * fx * fz
  );
}

/** Surface normal at a world position, from the same heightfield. */
export function sampleNormal(
  dem: Float32Array,
  spec: GridSpec,
  x: number,
  z: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const step = spec.cellSize;
  const dx = sampleHeight(dem, spec, x + step, z) - sampleHeight(dem, spec, x - step, z);
  const dz = sampleHeight(dem, spec, x, z + step) - sampleHeight(dem, spec, x, z - step);
  return out.set(-dx, 2 * step, -dz).normalize();
}

export function createTerrainMesh(
  dem: Float32Array,
  spec: GridSpec,
  material: THREE.Material,
): TerrainMesh {
  const { width, height, cellSize } = spec;
  const vertexCount = width * height;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  const halfWidth = (width * cellSize) / 2;
  const halfHeight = (height * cellSize) / 2;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      positions[i * 3] = (col + 0.5) * cellSize - halfWidth;
      positions[i * 3 + 1] = dem[i];
      positions[i * 3 + 2] = (row + 0.5) * cellSize - halfHeight;

      // Sample the overlay at this cell's centre, so a nearest-filtered texture
      // lines up with the grid the data actually lives on.
      uvs[i * 2] = (col + 0.5) / width;
      uvs[i * 2 + 1] = (row + 0.5) / height;
    }
  }

  // Two triangles per quad. Uint32 indices are required: 65,536 vertices is
  // exactly one past what Uint16 can address, and the overflow would silently
  // wrap the last row onto the first.
  const quadCount = (width - 1) * (height - 1);
  const indices = new Uint32Array(quadCount * 6);
  let cursor = 0;
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  computeNormals(positions, normals, spec, 0, 0, width, height);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  // The curvature shader displaces vertices, so the CPU bounding sphere no
  // longer describes what is on screen and three would cull the terrain just as
  // the player looked at the horizon.
  mesh.frustumCulled = false;

  return {
    mesh,
    geometry,
    updatePatch(nextDem, x, y, w, h) {
      const x0 = Math.max(0, x);
      const y0 = Math.max(0, y);
      const x1 = Math.min(width, x + w);
      const y1 = Math.min(height, y + h);

      for (let row = y0; row < y1; row++) {
        for (let col = x0; col < x1; col++) {
          const i = row * width + col;
          positions[i * 3 + 1] = nextDem[i];
        }
      }

      // Normals need a one-cell halo, because a moved vertex changes the facets
      // of every neighbour that shares it.
      computeNormals(positions, normals, spec, x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);

      const first = y0 * width + x0;
      const count = (y1 - 1) * width + x1 - first;
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
      position.addUpdateRange(first * 3, count * 3);
      normal.addUpdateRange(first * 3, count * 3);
      position.needsUpdate = true;
      normal.needsUpdate = true;
    },
  };
}

/**
 * Normals from central differences on the height field.
 *
 * Cheaper and smoother than accumulating face normals: the surface is a
 * heightfield on a regular grid, so the analytic normal is exact and needs no
 * neighbour-triangle bookkeeping.
 */
function computeNormals(
  positions: Float32Array,
  normals: Float32Array,
  spec: GridSpec,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { width, height, cellSize } = spec;
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + w);
  const y1 = Math.min(height, y + h);
  const twoCells = 2 * cellSize;

  for (let row = y0; row < y1; row++) {
    const rUp = Math.max(row - 1, 0);
    const rDown = Math.min(row + 1, height - 1);
    for (let col = x0; col < x1; col++) {
      const cLeft = Math.max(col - 1, 0);
      const cRight = Math.min(col + 1, width - 1);

      const dzdx = (positions[(row * width + cRight) * 3 + 1] -
        positions[(row * width + cLeft) * 3 + 1]) / twoCells;
      const dzdy = (positions[(rDown * width + col) * 3 + 1] -
        positions[(rUp * width + col) * 3 + 1]) / twoCells;

      const inverse = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const i = (row * width + col) * 3;
      normals[i] = -dzdx * inverse;
      normals[i + 1] = inverse;
      normals[i + 2] = -dzdy * inverse;
    }
  }
}
