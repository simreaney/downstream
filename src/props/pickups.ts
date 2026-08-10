/**
 * Gatherable markers.
 *
 * Resources have to be *visible* from a distance or gathering becomes wandering
 * with the E key held down. A stack of cut logs and a spade stuck in the ground
 * both read instantly at silhouette scale, which is the only scale that matters
 * when the player is scanning a hillside for something to pick up.
 */

import * as THREE from "three";
import { part, type PropAsset, type PropContext } from "./types";

const TIMBER = 0x8a6236;
const CUT_END = 0xc9a878;
const HANDLE = 0x7a5a38;
const BLADE = 0xb9c2c7;

/** A short stack of cut logs — the wood pickup. */
export function logPile(context: PropContext): PropAsset {
  const logs: THREE.BufferGeometry[] = [];
  const ends: THREE.BufferGeometry[] = [];

  // Two on the bottom, one nested on top: the way timber actually stacks, and
  // enough asymmetry that it does not read as a machined block.
  const layout: [number, number, number][] = [
    [-0.26, 0.24, 0],
    [0.26, 0.24, 0],
    [0, 0.68, 0.04],
  ];

  for (const [x, y, z] of layout) {
    const log = new THREE.CylinderGeometry(0.24, 0.24, 1.5, 8);
    log.rotateZ(Math.PI / 2);
    log.translate(x, y, z);
    logs.push(log);

    // Pale cut ends, so the pile reads as felled timber rather than as branches.
    for (const side of [-1, 1]) {
      const end = new THREE.CylinderGeometry(0.245, 0.245, 0.06, 8);
      end.rotateZ(Math.PI / 2);
      end.translate(x + side * 0.75, y, z);
      ends.push(end);
    }
  }

  return {
    parts: [
      part(merge(logs), context.material(TIMBER)),
      part(merge(ends), context.material(CUT_END)),
    ],
    radius: 0.9,
    height: 0.95,
  };
}

/** A spade stuck upright in the ground — the one-off tool pickup. */
export function spade(context: PropContext): PropAsset {
  const shaft = new THREE.CylinderGeometry(0.055, 0.05, 1.5, 6);
  shaft.translate(0, 0.95, 0);

  const grip = new THREE.TorusGeometry(0.13, 0.045, 6, 10);
  grip.rotateY(Math.PI / 2);
  grip.translate(0, 1.76, 0);

  const blade = new THREE.BoxGeometry(0.34, 0.42, 0.05);
  blade.translate(0, 0.28, 0);

  return {
    parts: [
      part(merge([shaft, grip]), context.material(HANDLE)),
      part(blade, context.material(BLADE)),
    ],
    radius: 0.35,
    height: 1.9,
  };
}

/** Concatenate geometries sharing a material, so a prop stays one draw call. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of parts) {
    vertexCount += geometry.getAttribute("position").count;
    indexCount += geometry.getIndex()?.count ?? 0;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const geometry of parts) {
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const index = geometry.getIndex();

    positions.set(position.array as Float32Array, vertexOffset * 3);
    normals.set(normal.array as Float32Array, vertexOffset * 3);
    if (index) {
      for (let i = 0; i < index.count; i++) {
        indices[indexOffset + i] = index.getX(i) + vertexOffset;
      }
      indexOffset += index.count;
    }
    vertexOffset += position.count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
}
