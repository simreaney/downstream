/**
 * A base for the board.
 *
 * The terrain is a single sheet. On a screen nobody sees its edge side-on, but
 * a catchment shrunk onto a table is looked at from every angle, and a sheet
 * seen edge-on reads as a cut-out with nothing under it. So in a headset it
 * stands on a block, as a model railway or a museum diorama does: the soil in
 * section along each edge, following the ground's own profile, over a level
 * wooden plinth.
 *
 * The section's top row is built from the very vertices the terrain mesh puts
 * at the border cells, so the two meet without a seam. Hidden off the headset,
 * where the follow camera never shows the catchment's edge side-on.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import { reliefFor } from "../config";
import { cellToWorld } from "../render/terrainMesh";

/**
 * Soil, lighter at the surface. A warm, milky brown rather than a true earth
 * colour: the side facing away from the sun is a wall the size of the board,
 * and the art direction does not let anything go dark.
 */
const SOIL_TOP = new THREE.Color(0xc29d72);
const SOIL_BOTTOM = new THREE.Color(0xa9845e);
/** Honey-coloured wood, a little darker towards the table. */
const WOOD_TOP = new THREE.Color(0xd2a46c);
const WOOD_BOTTOM = new THREE.Color(0xb98a55);

/** Soil showing below the lowest point of the catchment, as a fraction of its relief. */
const SOIL_BELOW_FRACTION = 0.04;
/** Height of the wooden plinth, as a fraction of the catchment's relief. */
const PLINTH_FRACTION = 0.16;

interface Side {
  /** Border cells in walking order. */
  readonly cells: number[];
  readonly normal: THREE.Vector3;
}

/**
 * The four edges, each walked so that the outward normal is (-step.z, 0,
 * step.x). With the quads wound (top, bottom, next bottom), that makes every
 * face point outwards with no per-face check — winding that matters, since a
 * flipped face here would be shaded by the hemisphere light's ground colour,
 * as the river once was.
 */
function sides(spec: GridSpec): Side[] {
  const { width, height } = spec;
  const range = (n: number, reverse: boolean): number[] => {
    const values = Array.from({ length: n }, (_, i) => i);
    return reverse ? values.reverse() : values;
  };
  return [
    // Row 0 is the -z edge; walk towards -x.
    { cells: range(width, true).map((col) => col), normal: new THREE.Vector3(0, 0, -1) },
    // Last row is the +z edge; walk towards +x.
    { cells: range(width, false).map((col) => (height - 1) * width + col), normal: new THREE.Vector3(0, 0, 1) },
    // Column 0 is the -x edge; walk towards +z.
    { cells: range(height, false).map((row) => row * width), normal: new THREE.Vector3(-1, 0, 0) },
    // Last column is the +x edge; walk towards -z.
    { cells: range(height, true).map((row) => row * width + width - 1), normal: new THREE.Vector3(1, 0, 0) },
  ];
}

export function createPlinth(dem: Float32Array, spec: GridSpec): THREE.Mesh {
  let lowest = Infinity;
  for (let i = 0; i < dem.length; i++) lowest = Math.min(lowest, dem[i]);
  const relief = reliefFor(spec);
  const soilBottom = lowest - relief * SOIL_BELOW_FRACTION;
  const base = soilBottom - relief * PLINTH_FRACTION;

  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const at = new THREE.Vector3();

  const vertex = (x: number, y: number, z: number, normal: THREE.Vector3, colour: THREE.Color): number => {
    positions.push(x, y, z);
    normals.push(normal.x, normal.y, normal.z);
    colours.push(colour.r, colour.g, colour.b);
    return positions.length / 3 - 1;
  };

  /** Two triangles joining column a to column b, top and bottom rows given. */
  const quad = (aTop: number, aBottom: number, bTop: number, bBottom: number): void => {
    indices.push(aTop, aBottom, bBottom, aTop, bBottom, bTop);
  };

  for (const side of sides(spec)) {
    const columns: number[][] = [];
    for (const cell of side.cells) {
      cellToWorld(spec, cell, at);
      const surface = dem[cell];
      columns.push([
        vertex(at.x, surface, at.z, side.normal, SOIL_TOP),
        vertex(at.x, soilBottom, at.z, side.normal, SOIL_BOTTOM),
        // Repeated at the same height in the wood's colour, so the seam
        // between soil and plinth is a crisp line rather than a blend.
        vertex(at.x, soilBottom, at.z, side.normal, WOOD_TOP),
        vertex(at.x, base, at.z, side.normal, WOOD_BOTTOM),
      ]);
    }
    for (let i = 0; i + 1 < columns.length; i++) {
      const [aSoil, aSoilFoot, aWood, aWoodFoot] = columns[i];
      const [bSoil, bSoilFoot, bWood, bWoodFoot] = columns[i + 1];
      quad(aSoil, aSoilFoot, bSoil, bSoilFoot);
      quad(aWood, aWoodFoot, bWood, bWoodFoot);
    }
  }

  // The underside, in case anyone crouches to look.
  const down = new THREE.Vector3(0, -1, 0);
  const first = cellToWorld(spec, 0, new THREE.Vector3());
  const last = cellToWorld(spec, spec.width * spec.height - 1, new THREE.Vector3());
  const a = vertex(first.x, base, first.z, down, WOOD_BOTTOM);
  const b = vertex(last.x, base, first.z, down, WOOD_BOTTOM);
  const c = vertex(last.x, base, last.z, down, WOOD_BOTTOM);
  const d = vertex(first.x, base, last.z, down, WOOD_BOTTOM);
  indices.push(a, b, c, a, c, d);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.visible = false;
  return mesh;
}
