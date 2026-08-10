/**
 * Trees.
 *
 * Chunky, low-poly and deliberately under-detailed: an icosahedron canopy on a
 * tapered trunk. At the density this catchment needs — thousands of them — silhouette
 * is the only thing that reads, and a low-detail icosahedron gives flat facets
 * that catch the toon ramp's bands cleanly. Anything smoother would grey out
 * into a blob at distance.
 *
 * Three species, and the distinction is functional rather than decorative.
 * Willow is reserved for riparian planting, so a continuous buffer along a
 * watercourse is legible as a buffer from across the valley without turning the
 * risk overlay on — the player can see their own work.
 */

import * as THREE from "three";
import { part, type PropAsset, type PropContext } from "./types";

/** Canopy geometry with the vertices jittered so it is not an obvious solid. */
function canopy(radius: number, detail: number, squash: number, seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;

  // Deterministic jitter: the geometry is shared by every instance, so this runs
  // once and gives the species a silhouette rather than giving each tree one.
  let hash = seed >>> 0;
  const random = (): number => {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    return hash / 4294967296;
  };

  for (let i = 0; i < position.count; i++) {
    const jitter = 1 + (random() - 0.5) * 0.28;
    position.setXYZ(
      i,
      position.getX(i) * jitter,
      position.getY(i) * jitter * squash,
      position.getZ(i) * jitter,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function trunk(bottom: number, top: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, 6, 1);
  // Origin at the base, so an instance's transform is simply where the tree
  // stands rather than where its middle is.
  geometry.translate(0, height / 2, 0);
  return geometry;
}

export function broadleaf(context: PropContext): PropAsset {
  const height = 4.2;
  const canopyGeometry = canopy(2.5, 1, 0.85, 0x1234);
  canopyGeometry.translate(0, height + 1.1, 0);

  return {
    parts: [
      part(trunk(0.36, 0.24, height), context.material(0x6b4a2f)),
      part(canopyGeometry, context.material(0x4f9440)),
    ],
    radius: 2.5,
    height: height + 3,
  };
}

export function conifer(context: PropContext): PropAsset {
  const height = 3.0;
  const crown = new THREE.ConeGeometry(1.9, 6.4, 7, 2);
  crown.translate(0, height + 3.0, 0);

  return {
    parts: [
      part(trunk(0.3, 0.2, height), context.material(0x5c3f2a)),
      part(crown, context.material(0x2f6b3c)),
    ],
    radius: 1.9,
    height: height + 6.4,
  };
}

/**
 * Willow: paler, wider and lower than the others.
 *
 * Planted only in the riparian zone, so its distinct silhouette doubles as a map
 * of where the player has already buffered the watercourse.
 */
export function willow(context: PropContext): PropAsset {
  const height = 2.6;
  const canopyGeometry = canopy(2.9, 1, 0.6, 0x9ab1);
  canopyGeometry.translate(0, height + 0.7, 0);

  return {
    parts: [
      part(trunk(0.42, 0.3, height), context.material(0x7a6248)),
      part(canopyGeometry, context.material(0x8fbc63)),
    ],
    radius: 2.9,
    height: height + 2.2,
  };
}

/** A freshly planted whip, before it matures into one of the species above. */
export function sapling(context: PropContext): PropAsset {
  const height = 1.1;
  const leaves = canopy(0.6, 0, 1.1, 0x33cc);
  leaves.translate(0, height + 0.35, 0);

  return {
    parts: [
      part(trunk(0.09, 0.07, height), context.material(0x7a6248)),
      part(leaves, context.material(0x93c95c)),
    ],
    radius: 0.6,
    height: height + 0.9,
  };
}
