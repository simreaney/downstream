/**
 * Boulders — the stone the player gathers for pond construction.
 *
 * A squashed, jittered icosahedron sunk slightly into the ground so it reads as
 * embedded rather than dropped on the surface.
 */

import * as THREE from "three";
import { part, type PropAsset, type PropContext } from "./types";

export function boulder(context: PropContext): PropAsset {
  const geometry = new THREE.IcosahedronGeometry(0.85, 0);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;

  let hash = 0x517cc1b7;
  const random = (): number => {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    return hash / 4294967296;
  };

  for (let i = 0; i < position.count; i++) {
    position.setXYZ(
      i,
      position.getX(i) * (1 + (random() - 0.5) * 0.5),
      position.getY(i) * (0.62 + random() * 0.2),
      position.getZ(i) * (1 + (random() - 0.5) * 0.5),
    );
  }
  geometry.computeVertexNormals();
  // Bury the base, so the boulder sits in the ground rather than balancing on it.
  geometry.translate(0, 0.35, 0);

  return {
    parts: [part(geometry, context.material(0x9a9793))],
    radius: 0.9,
    height: 1.0,
  };
}
