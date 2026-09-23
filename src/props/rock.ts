/**
 * Boulders — the stone the player gathers for pond construction.
 *
 * A soft, pebble-like lump rather than a jagged rock: a squashed sphere with a
 * smooth, low-frequency wobble and welded normals, sunk slightly into the
 * ground so it reads as embedded rather than dropped on the surface. Sharp
 * facets are the one thing the toy-diorama look cannot absorb, and a boulder is
 * where they would otherwise be most obvious.
 */

import * as THREE from "three";
import { smoothNormals } from "../render/softFinish";
import { part, type PropAsset, type PropContext } from "./types";

export function boulder(context: PropContext): PropAsset {
  const raw = new THREE.IcosahedronGeometry(0.85, 2);
  const position = raw.getAttribute("position") as THREE.BufferAttribute;

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const length = Math.max(1e-6, Math.hypot(x, y, z));
    // A function of direction, so duplicated corners move together and the
    // weld below finds them.
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const wobble = 1 + Math.sin(nx * 2.3 + 1.1) * 0.1 + Math.sin(nz * 2.9 - ny * 1.3) * 0.08;
    position.setXYZ(i, x * wobble * 1.12, y * wobble * 0.68, z * wobble * 0.95);
  }

  const geometry = smoothNormals(raw);
  // Bury the base, so the boulder sits in the ground rather than balancing on it.
  geometry.translate(0, 0.3, 0);

  return {
    parts: [part(geometry, context.material(0xc4c0bb))],
    radius: 0.9,
    height: 1.0,
  };
}
