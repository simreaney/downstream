/**
 * Village cottages and the fishery hut.
 *
 * Simple gabled boxes — a body, a pitched roof, a door. At the distance the
 * player usually sees them, roof pitch and colour are the only things that
 * register, so detail beyond that would be invisible and would cost draw calls
 * on the props that carry the game's feedback.
 */

import * as THREE from "three";
import { part, type PropAsset, type PropContext } from "./types";

/** Cottage walls, cycled so a village is not one repeated house. */
export const COTTAGE_COLOURS = [0xe8dcc4, 0xd9c9a8, 0xefe3cd, 0xe2d2b6];
const ROOF = 0x8f5a44;
const DOOR = 0x5d4632;

/** A gabled roof, as a prism lying along +x. */
function gable(width: number, depth: number, rise: number, y: number): THREE.BufferGeometry {
  const half = width / 2;
  const halfDepth = depth / 2;

  // Two slopes and two triangular ends, written out rather than lathed so the
  // ridge stays crisp under the toon ramp.
  const positions = new Float32Array([
    // north slope
    -half, y, -halfDepth, half, y, -halfDepth, half, y + rise, 0,
    -half, y, -halfDepth, half, y + rise, 0, -half, y + rise, 0,
    // south slope
    half, y, halfDepth, -half, y, halfDepth, -half, y + rise, 0,
    half, y, halfDepth, -half, y + rise, 0, half, y + rise, 0,
    // west end
    -half, y, -halfDepth, -half, y + rise, 0, -half, y, halfDepth,
    // east end
    half, y, halfDepth, half, y + rise, 0, half, y, -halfDepth,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function cottage(context: PropContext, wallColour: number): PropAsset {
  const width = 3.4;
  const depth = 2.6;
  const wallHeight = 2.2;

  const walls = new THREE.BoxGeometry(width, wallHeight, depth);
  walls.translate(0, wallHeight / 2, 0);

  const door = new THREE.BoxGeometry(0.7, 1.3, 0.12);
  door.translate(0, 0.65, depth / 2 + 0.02);

  return {
    parts: [
      part(walls, context.material(wallColour)),
      part(gable(width + 0.35, depth + 0.35, 1.35, wallHeight), context.material(ROOF)),
      part(door, context.material(DOOR)),
    ],
    radius: width / 2,
    height: wallHeight + 1.35,
  };
}

export function cottageA(context: PropContext): PropAsset {
  return cottage(context, COTTAGE_COLOURS[0]);
}

export function cottageB(context: PropContext): PropAsset {
  return cottage(context, COTTAGE_COLOURS[1]);
}

/**
 * The fishery hut, with a jetty running out over the water.
 *
 * The jetty matters more than the hut: it puts a place to stand at the water's
 * edge, which is where the player should be looking when they want to know
 * whether the fish have come back.
 */
export function fisheryHut(context: PropContext): PropAsset {
  const width = 2.6;
  const depth = 2.2;
  const wallHeight = 1.9;

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
      part(gable(width + 0.3, depth + 0.3, 1.0, wallHeight), context.material(ROOF)),
      part(deck, timber),
      ...posts.map((post) => part(post, timber)),
    ],
    radius: 2.2,
    height: wallHeight + 1.0,
  };
}
