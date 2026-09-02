/**
 * Village cottages and the fishery hut.
 *
 * Gabled boxes with the trim that makes a roof read as finished rather than
 * pasted on: a ridge cap to crisp up the peak, a chimney, and a window either
 * side of the door. None of it is instanced — a village is at most a handful
 * of cottages plus one hut, all drawn as ordinary meshes — so the extra parts
 * cost a few draw calls total, not per-instance the way a tree's would.
 */

import * as THREE from "three";
import { part, type PropAsset, type PropContext, type PropPart } from "./types";

/** Cottage walls, cycled so a village is not one repeated house. */
export const COTTAGE_COLOURS = [0xe8dcc4, 0xd9c9a8, 0xefe3cd, 0xe2d2b6];
const ROOF = 0x8f5a44;
const RIDGE = 0x6d4433;
const CHIMNEY = 0x9c9182;
const DOOR = 0x5d4632;
const GLASS = 0xaed0d6;

/**
 * A gabled roof, as a prism lying along +x.
 *
 * Two slopes and two triangular ends, written out rather than lathed so the
 * ridge stays crisp under the toon ramp. Winding matters here in a way it
 * would not for a lathed shape: each triangle is listed so its face normal
 * points outward — up and away from the ridge for the slopes, away from the
 * centre for the gable ends. The camera never gets below eave height, so a
 * face wound the other way is simply never drawn.
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

/** A capping strip along the ridge line, so the peak reads as built rather than a bare seam. */
function ridgeCap(roofWidth: number, ridgeY: number): THREE.BufferGeometry {
  const cap = new THREE.BoxGeometry(roofWidth + 0.1, 0.14, 0.22);
  cap.translate(0, ridgeY, 0);
  return cap;
}

/** A chimney stack: a shaft through the roof plane, capped, offset toward one gable end. */
function chimneyStack(
  wallHeight: number,
  rise: number,
  x: number,
  z: number,
): THREE.BufferGeometry[] {
  const shaftHeight = rise + 0.55;
  const shaft = new THREE.BoxGeometry(0.38, shaftHeight, 0.38);
  shaft.translate(x, wallHeight + shaftHeight / 2, z);

  const crown = new THREE.BoxGeometry(0.52, 0.14, 0.52);
  crown.translate(x, wallHeight + shaftHeight + 0.07, z);

  return [shaft, crown];
}

/** A window flush with a wall: glazing behind a crossed mullion. */
function windowParts(context: PropContext, x: number, y: number, wallFace: number): PropPart[] {
  const glass = new THREE.BoxGeometry(0.55, 0.55, 0.06);
  glass.translate(x, y, wallFace);

  const mullionZ = wallFace + Math.sign(wallFace) * 0.03;
  const horizontal = new THREE.BoxGeometry(0.58, 0.06, 0.08);
  horizontal.translate(x, y, mullionZ);
  const vertical = new THREE.BoxGeometry(0.06, 0.58, 0.08);
  vertical.translate(x, y, mullionZ);

  return [
    part(glass, context.material(GLASS)),
    part(horizontal, context.material(DOOR)),
    part(vertical, context.material(DOOR)),
  ];
}

function cottage(context: PropContext, wallColour: number, mirror: boolean): PropAsset {
  const width = 3.4;
  const depth = 2.6;
  const wallHeight = 2.2;
  const rise = 1.35;
  const roofWidth = width + 0.35;
  const roofDepth = depth + 0.35;
  const side = mirror ? -1 : 1;

  const walls = new THREE.BoxGeometry(width, wallHeight, depth);
  walls.translate(0, wallHeight / 2, 0);

  const door = new THREE.BoxGeometry(0.7, 1.3, 0.12);
  door.translate(0, 0.65, depth / 2 + 0.02);

  const chimneyX = side * roofWidth * 0.24;
  const chimney = chimneyStack(wallHeight, rise, chimneyX, 0.18);

  return {
    parts: [
      part(walls, context.material(wallColour)),
      part(gable(roofWidth, roofDepth, rise, wallHeight), context.material(ROOF)),
      part(ridgeCap(roofWidth, wallHeight + rise), context.material(RIDGE)),
      ...chimney.map((geometry) => part(geometry, context.material(CHIMNEY))),
      part(door, context.material(DOOR)),
      ...windowParts(context, -side * 1.0, 1.35, depth / 2 + 0.02),
    ],
    radius: width / 2,
    height: wallHeight + rise + 0.7,
  };
}

export function cottageA(context: PropContext): PropAsset {
  return cottage(context, COTTAGE_COLOURS[0], false);
}

export function cottageB(context: PropContext): PropAsset {
  return cottage(context, COTTAGE_COLOURS[1], true);
}

/**
 * The fishery hut, with a jetty running out over the water.
 *
 * The jetty matters more than the hut: it puts a place to stand at the water's
 * edge, which is where the player should be looking when they want to know
 * whether the fish have come back. The hut gets the same finished roof as a
 * cottage, but no chimney or windows — its job is silhouette, not character.
 */
export function fisheryHut(context: PropContext): PropAsset {
  const width = 2.6;
  const depth = 2.2;
  const wallHeight = 1.9;
  const rise = 1.0;
  const roofWidth = width + 0.3;
  const roofDepth = depth + 0.3;

  const walls = new THREE.BoxGeometry(width, wallHeight, depth);
  walls.translate(0, wallHeight / 2, 0);

  const deck = new THREE.BoxGeometry(1.6, 0.16, 5.5);
  deck.translate(0, 0.42, depth / 2 + 2.6);

  const posts: THREE.BufferGeometry[] = [];
  for (const z of [1.6, 3.2, 4.8]) {
    for (const x of [-0.65, 0.65]) {
      const post = new THREE.CylinderGeometry(0.1, 0.1, 1.4, 5);
      post.translate(x, -0.2, depth / 2 + z);
      posts.push(post);
    }
  }

  const timber = context.material(0x8a6a48);
  return {
    parts: [
      part(walls, context.material(0xd6c3a4)),
      part(gable(roofWidth, roofDepth, rise, wallHeight), context.material(ROOF)),
      part(ridgeCap(roofWidth, wallHeight + rise), context.material(RIDGE)),
      part(deck, timber),
      ...posts.map((post) => part(post, timber)),
    ],
    radius: 2.2,
    height: wallHeight + rise,
  };
}
