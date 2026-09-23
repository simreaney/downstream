/**
 * Village cottages and the fishery hut.
 *
 * Built like painted wooden toys: rounded-box walls, a roof of two thick soft
 * slabs meeting over a ridge roll, a rounded chimney, and a window with a
 * flower box either side of a pastel door. Every edge is bevelled, because a
 * hard 90-degree corner is the one thing that breaks the soft diorama look
 * under the gradient toon ramp — it shows as a crisp line where every other
 * surface in the world rolls.
 *
 * None of it is instanced — a village is at most a handful of cottages plus one
 * hut, all drawn as ordinary meshes — so the extra parts cost a few draw calls
 * total, not per-instance the way a tree's would.
 */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { part, type PropAsset, type PropContext, type PropPart } from "./types";

/** Cottage walls and roofs, paired and cycled so a village is not one repeated house. */
export const COTTAGE_COLOURS = [0xf7ecd9, 0xf6e0d2, 0xeef0dc, 0xf3e6ea];
const COTTAGE_ROOFS = [0xe7a08e, 0x9cc6b4, 0xe9b97e, 0xa9b8dc];
const CHIMNEY = 0xd9cfc4;
const DOOR = 0x93bcc9;
const FRAME = 0xfdf9f2;
const GLASS = 0xcfe7f1;
const PLANTER = 0xc9a07c;
const FLOWERS = 0xf4a7b9;
const PLINTH = 0xd6cdc2;

/**
 * A stone plinth under the walls, running well below ground.
 *
 * A cottage stands at its plot's centre height, so on a slope its downhill
 * corner lifts off the ground. The plinth fills that gap the way a real
 * foundation course does: on level ground only a lip shows, on a slope a
 * wedge of stonework appears under the low side, which reads as a hillside
 * house rather than one that has not been put down properly.
 */
function plinth(context: PropContext, width: number, depth: number): PropPart {
  return part(rounded(width + 0.3, 1.5, depth + 0.3, 0.12, 0, -0.6, 0), context.material(PLINTH));
}

/** A rounded box, translated into place. */
function rounded(
  width: number,
  height: number,
  depth: number,
  radius: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const geometry = new RoundedBoxGeometry(width, height, depth, 3, Math.min(radius, width / 2, height / 2, depth / 2) * 0.999);
  geometry.translate(x, y, z);
  return geometry;
}

/**
 * The triangular gable ends under the roof, in the wall colour.
 *
 * A prism lying along +x, each triangle wound so its face normal points
 * outward. The roof slabs cover its slopes; only the two ends show.
 */
function gable(width: number, depth: number, rise: number, y: number): THREE.BufferGeometry {
  const half = width / 2;
  const halfDepth = depth / 2;

  const positions = new Float32Array([
    // north slope
    -half, y, -halfDepth, half, y + rise, 0, half, y, -halfDepth,
    -half, y, -halfDepth, -half, y + rise, 0, half, y + rise, 0,
    // south slope
    half, y, halfDepth, -half, y + rise, 0, -half, y, halfDepth,
    half, y, halfDepth, half, y + rise, 0, -half, y + rise, 0,
    // west end
    -half, y, -halfDepth, -half, y, halfDepth, -half, y + rise, 0,
    // east end
    half, y, halfDepth, half, y, -halfDepth, half, y + rise, 0,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Two thick, soft-edged roof slabs meeting at the ridge, plus a ridge roll.
 *
 * Each slab is a rounded box tilted to the roof pitch and pushed out along its
 * own normal by half its thickness, so its underside lies on the gable rather
 * than cutting through it.
 */
function roof(
  context: PropContext,
  colour: number,
  roofWidth: number,
  roofDepth: number,
  rise: number,
  wallHeight: number,
): PropPart[] {
  const thickness = 0.24;
  const halfDepth = roofDepth / 2;
  const angle = Math.atan2(rise, halfDepth);
  const length = Math.hypot(halfDepth, rise) + 0.12;

  const slabs: PropPart[] = [];
  for (const side of [-1, 1]) {
    const slab = new RoundedBoxGeometry(roofWidth, thickness, length, 3, 0.1);
    slab.rotateX(side * angle);
    const normalY = Math.cos(angle);
    const normalZ = side * Math.sin(angle);
    slab.translate(
      0,
      wallHeight + rise / 2 + normalY * (thickness / 2),
      (side * halfDepth) / 2 + normalZ * (thickness / 2),
    );
    slabs.push(part(slab, context.material(colour)));
  }

  const ridge = new THREE.CylinderGeometry(0.17, 0.17, roofWidth + 0.08, 12);
  ridge.rotateZ(Math.PI / 2);
  ridge.translate(0, wallHeight + rise + thickness * 0.75, 0);
  const ridgeColour = new THREE.Color(colour).multiplyScalar(0.9).getHex();
  slabs.push(part(ridge, context.material(ridgeColour)));

  return slabs;
}

/** A rounded window with a pale frame, glazing, and a flower box underneath. */
function windowParts(context: PropContext, x: number, y: number, wallFace: number): PropPart[] {
  const out = Math.sign(wallFace);
  return [
    part(rounded(0.72, 0.72, 0.1, 0.1, x, y, wallFace), context.material(FRAME)),
    part(rounded(0.52, 0.52, 0.1, 0.08, x, y, wallFace + out * 0.03), context.material(GLASS)),
    part(rounded(0.82, 0.2, 0.26, 0.07, x, y - 0.46, wallFace + out * 0.1), context.material(PLANTER)),
    part(rounded(0.7, 0.16, 0.18, 0.08, x, y - 0.32, wallFace + out * 0.1), context.material(FLOWERS)),
  ];
}

function cottage(context: PropContext, variant: number, mirror: boolean): PropAsset {
  const width = 3.4;
  const depth = 2.6;
  const wallHeight = 2.1;
  const rise = 1.35;
  const roofWidth = width + 0.45;
  const roofDepth = depth + 0.45;
  const side = mirror ? -1 : 1;
  const wallColour = COTTAGE_COLOURS[variant % COTTAGE_COLOURS.length];
  const roofColour = COTTAGE_ROOFS[variant % COTTAGE_ROOFS.length];

  const shaftHeight = rise + 0.6;
  const chimneyX = side * roofWidth * 0.26;

  return {
    parts: [
      plinth(context, width, depth),
      part(rounded(width, wallHeight, depth, 0.18, 0, wallHeight / 2, 0), context.material(wallColour)),
      part(gable(width - 0.02, depth - 0.02, rise * 0.92, wallHeight - 0.01), context.material(wallColour)),
      ...roof(context, roofColour, roofWidth, roofDepth, rise, wallHeight),
      part(
        rounded(0.46, shaftHeight, 0.46, 0.1, chimneyX, wallHeight + shaftHeight / 2, 0.2),
        context.material(CHIMNEY),
      ),
      part(rounded(0.78, 1.36, 0.14, 0.12, side * 0.55, 0.68, depth / 2 + 0.02), context.material(DOOR)),
      ...windowParts(context, -side * 0.85, 1.3, depth / 2 + 0.02),
    ],
    radius: width / 2,
    height: wallHeight + rise + 0.7,
  };
}

export function cottageA(context: PropContext): PropAsset {
  return cottage(context, 0, false);
}

export function cottageB(context: PropContext): PropAsset {
  return cottage(context, 1, true);
}

export function cottageC(context: PropContext): PropAsset {
  return cottage(context, 2, false);
}

export function cottageD(context: PropContext): PropAsset {
  return cottage(context, 3, true);
}

/**
 * Where a cottage's front door is, in its own frame: the door's centre on the
 * wall face. Mirrored variants hang it on the other side, like the chimney.
 */
export function cottageDoor(variant: number): { x: number; z: number } {
  return { x: variant % 2 === 1 ? -0.55 : 0.55, z: 1.3 };
}

/**
 * The fishery hut, with a jetty running out over the water.
 *
 * The jetty matters more than the hut: it puts a place to stand at the water's
 * edge, which is where the player should be looking when they want to know
 * whether the fish have come back. The hut gets the same soft roof as a
 * cottage, but no chimney or windows — its job is silhouette, not character.
 */
export function fisheryHut(context: PropContext): PropAsset {
  const width = 2.6;
  const depth = 2.2;
  const wallHeight = 1.9;
  const rise = 1.0;
  const roofWidth = width + 0.4;
  const roofDepth = depth + 0.4;
  const walls = 0xeedfc6;

  const posts: PropPart[] = [];
  const timber = context.material(0xcaa682);
  for (const z of [1.6, 3.2, 4.8]) {
    for (const x of [-0.65, 0.65]) {
      const post = new THREE.CylinderGeometry(0.12, 0.12, 1.4, 10);
      post.translate(x, -0.2, depth / 2 + z);
      posts.push(part(post, timber));
    }
  }

  return {
    parts: [
      plinth(context, width, depth),
      part(rounded(width, wallHeight, depth, 0.16, 0, wallHeight / 2, 0), context.material(walls)),
      part(gable(width - 0.02, depth - 0.02, rise * 0.9, wallHeight - 0.01), context.material(walls)),
      ...roof(context, 0x8fc4ba, roofWidth, roofDepth, rise, wallHeight),
      part(rounded(0.7, 1.25, 0.14, 0.12, 0, 0.62, depth / 2 + 0.02), context.material(DOOR)),
      part(rounded(1.6, 0.18, 5.5, 0.07, 0, 0.42, depth / 2 + 2.6), timber),
      ...posts,
    ],
    radius: 2.2,
    height: wallHeight + rise,
  };
}

/**
 * The village well, at the middle of the green.
 *
 * Gives the village a centre, which scattered cottages on their own do not
 * have, and something for the paths to lead to. A round stone wall under a
 * little pitched roof on two posts, with a bucket hanging from the winch.
 */
export function well(context: PropContext): PropAsset {
  const stone = context.material(0xd9d2c7);
  const timber = context.material(0xc49a6c);

  const wall = new THREE.CylinderGeometry(0.82, 0.9, 0.78, 20);
  wall.translate(0, 0.39, 0);
  const rim = new THREE.TorusGeometry(0.8, 0.14, 10, 24);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.8, 0);
  const water = new THREE.CircleGeometry(0.7, 20);
  water.rotateX(-Math.PI / 2);
  water.translate(0, 0.62, 0);

  const posts: PropPart[] = [];
  for (const side of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.08, 0.09, 1.55, 10);
    post.translate(side * 0.86, 1.35, 0);
    posts.push(part(post, timber));
  }
  const winch = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 10);
  winch.rotateZ(Math.PI / 2);
  winch.translate(0, 1.72, 0);
  const bucket = new THREE.CylinderGeometry(0.17, 0.14, 0.26, 12);
  bucket.translate(0, 1.16, 0);

  return {
    parts: [
      part(wall, stone),
      part(rim, stone),
      part(water, context.material(0x8fc6e2), { castShadow: false }),
      ...posts,
      part(winch, timber),
      part(bucket, timber),
      ...roof(context, 0xe7a08e, 2.1, 1.5, 0.55, 2.1),
    ],
    radius: 1.0,
    height: 2.9,
  };
}
