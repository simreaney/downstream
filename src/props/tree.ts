/**
 * Trees.
 *
 * Soft toy trees: a short, chunky trunk under an oversized rounded canopy, with
 * smooth normals so the gradient toon ramp rolls over the crown instead of
 * catching on facets. The proportions are chibi on purpose — big heads on small
 * bodies — which is what lets a wood read as a cosy cluster of rounded shapes
 * from the diorama camera rather than as a dark wall.
 *
 * A broadleaf crown is a cluster of overlapping blobs rather than one sphere.
 * One sphere reads as a lollipop; three read as foliage.
 *
 * Subdivision drops a level on low-power devices. With thousands of instances
 * each drawn twice — once more for the shadow map — that one level is most of
 * the vegetation budget on a phone.
 *
 * Three species, and the distinction is functional rather than decorative.
 * Willow is reserved for riparian planting, so a continuous buffer along a
 * watercourse is legible as a buffer from across the valley without turning the
 * risk overlay on — the player can see their own work.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { isLowPower } from "../config";
import { smoothNormals } from "../render/softFinish";
import { part, type PropAsset, type PropContext } from "./types";

/**
 * Icosahedron subdivisions for each blob of a full-size canopy.
 *
 * Detail 2 for all three blobs is 540 triangles a tree (three's subdivision
 * is linear: 20 × (detail + 1)² faces per blob), three times the old faceted
 * crown. It is spent deliberately: with smooth normals the shading no
 * longer hides the polygon count, so the silhouette is the only place facets
 * show, and at one level lower a crown near the camera has visibly straight
 * edges. Phones get detail 1.
 */
const CANOPY_DETAIL = isLowPower() ? 1 : 2;

/** Sides on a trunk. */
const TRUNK_SIDES = isLowPower() ? 7 : 10;
const TRUNK_RINGS = 3;

/** Sides on each tier of a fir, and the number of tiers stacked up it. */
const CONIFER_SIDES = isLowPower() ? 8 : 12;
const CONIFER_TIERS = 3;

/** Canopy lumpiness, as a fraction of the radius. Low and soft: a cushion, not a rock. */
const CANOPY_LUMP = 0.1;

/** How far the base of a trunk swells outwards, as a fraction of its radius. */
const ROOT_FLARE = 0.6;

/**
 * A smooth, deterministic radial offset over the unit sphere.
 *
 * A function of direction alone, so every copy of a shared corner gets the same
 * answer and the surface stays welded however finely it is subdivided.
 */
function lumpiness(x: number, y: number, z: number, phase: number): number {
  return (
    (Math.sin(x * 2.1 + phase) * 0.45 +
      Math.sin(y * 2.4 - phase * 1.7) * 0.3 +
      Math.sin(z * 2.7 + phase * 0.6) * 0.35) /
    1.1
  );
}

/** Phase offset for a species, so each one keeps a silhouette of its own. */
function phaseOf(seed: number): number {
  return (seed % 1024) * 0.0613;
}

/** One soft blob: a gently lumpy, smooth-shaded sphere. */
function blob(
  radius: number,
  detail: number,
  squash: number,
  seed: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const raw = new THREE.IcosahedronGeometry(radius, detail);
  const position = raw.getAttribute("position") as THREE.BufferAttribute;
  const phase = phaseOf(seed);

  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const inverse = 1 / Math.max(1e-6, Math.sqrt(px * px + py * py + pz * pz));
    const scale = 1 + lumpiness(px * inverse, py * inverse, pz * inverse, phase) * CANOPY_LUMP;
    position.setXYZ(i, px * scale, py * scale * squash, pz * scale);
  }

  const geometry = smoothNormals(raw);
  geometry.translate(x, y, z);
  return geometry;
}

/**
 * A broadleaf crown: one main blob with two smaller ones bulging from its
 * shoulders, so the outline is a soft cloud rather than a ball.
 */
function crown(radius: number, squash: number, seed: number, centreY: number): THREE.BufferGeometry {
  return mergeGeometries([
    blob(radius, CANOPY_DETAIL, squash, seed, 0, centreY, 0),
    blob(radius * 0.62, CANOPY_DETAIL, squash, seed + 7, radius * 0.62, centreY - radius * 0.22, radius * 0.18),
    blob(radius * 0.58, CANOPY_DETAIL, squash, seed + 13, -radius * 0.48, centreY - radius * 0.18, -radius * 0.42),
  ]);
}

/**
 * Trunk, swelling into a root flare at the base.
 *
 * Welded so the cap and the side share normals along the rim, which rounds the
 * top edge off instead of leaving a machined crease.
 */
function trunk(bottom: number, top: number, height: number): THREE.BufferGeometry {
  const raw = new THREE.CylinderGeometry(top, bottom, height, TRUNK_SIDES, TRUNK_RINGS);
  const position = raw.getAttribute("position") as THREE.BufferAttribute;

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const t = Math.min(1, Math.max(0, (y + height / 2) / height));
    // Fourth power, so the swell is confined to the lowest ring rather than
    // turning the whole trunk into a cone.
    const flare = 1 + ROOT_FLARE * (1 - t) ** 4;
    position.setXYZ(i, position.getX(i) * flare, y, position.getZ(i) * flare);
  }

  const geometry = smoothNormals(raw);
  // Origin at the base, so an instance's transform is simply where the tree
  // stands rather than where its middle is.
  geometry.translate(0, height / 2, 0);
  return geometry;
}

/**
 * One tier of a fir: a rounded bell, widest just above its base and curling
 * under at the rim, so a stack of them reads as a soft gumdrop pine.
 */
function firTier(radius: number, height: number, y: number): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(radius * 0.7, 0.0),
    new THREE.Vector2(radius * 0.97, height * 0.08),
    new THREE.Vector2(radius, height * 0.18),
    new THREE.Vector2(radius * 0.84, height * 0.38),
    new THREE.Vector2(radius * 0.52, height * 0.68),
    new THREE.Vector2(radius * 0.2, height * 0.92),
    new THREE.Vector2(0.001, height),
  ];
  const geometry = smoothNormals(new THREE.LatheGeometry(profile, CONIFER_SIDES));
  geometry.translate(0, y, 0);
  return geometry;
}

function firCrown(radius: number, height: number): THREE.BufferGeometry {
  const tiers: THREE.BufferGeometry[] = [];
  const tierHeight = (height / CONIFER_TIERS) * 1.45;
  for (let i = 0; i < CONIFER_TIERS; i++) {
    const t = i / CONIFER_TIERS;
    tiers.push(firTier(radius * (1 - t * 0.32), tierHeight * (1 - t * 0.12), height * t * 0.72));
  }
  return mergeGeometries(tiers);
}

export function broadleaf(context: PropContext): PropAsset {
  const height = 2.6;
  const canopyRadius = 2.7;
  const canopyGeometry = crown(canopyRadius, 0.86, 0x1234, height + canopyRadius * 0.62);

  return {
    parts: [
      part(trunk(0.46, 0.32, height + 0.8), context.material(0xb08a66)),
      part(canopyGeometry, context.material(0x7fc08c)),
    ],
    radius: canopyRadius,
    height: height + canopyRadius * 1.5,
  };
}

export function conifer(context: PropContext): PropAsset {
  const height = 1.8;
  const crownHeight = 6.0;
  const crownGeometry = firCrown(2.1, crownHeight);
  crownGeometry.translate(0, height, 0);

  return {
    parts: [
      part(trunk(0.38, 0.26, height + 0.6), context.material(0xa07c5c)),
      part(crownGeometry, context.material(0x62ab93)),
    ],
    radius: 2.1,
    height: height + crownHeight,
  };
}

/**
 * Willow: paler, wider and lower than the others.
 *
 * Planted only in the riparian zone, so its distinct silhouette doubles as a map
 * of where the player has already buffered the watercourse.
 */
export function willow(context: PropContext): PropAsset {
  const height = 1.9;
  const canopyRadius = 3.0;
  const canopyGeometry = crown(canopyRadius, 0.62, 0x9ab1, height + canopyRadius * 0.45);

  return {
    parts: [
      part(trunk(0.5, 0.36, height + 0.6), context.material(0xb89878)),
      part(canopyGeometry, context.material(0xb9dc8c)),
    ],
    radius: canopyRadius,
    height: height + canopyRadius,
  };
}

/**
 * A round flowering shrub for cottage gardens.
 *
 * A soft blob with a few pastel blossoms dotted over its crown — the cheapest
 * thing that makes a plot read as a garden rather than as field with a house
 * put down on it.
 */
export function bush(context: PropContext): PropAsset {
  const leaves = blob(0.62, Math.max(0, CANOPY_DETAIL - 1), 0.78, 0x5a17, 0, 0.42, 0);

  const blossoms: THREE.BufferGeometry[] = [];
  const spots: [number, number, number][] = [
    [0.28, 0.78, 0.22],
    [-0.3, 0.72, 0.18],
    [0.05, 0.86, -0.3],
    [-0.12, 0.62, 0.46],
    [0.42, 0.55, -0.2],
  ];
  for (const [x, y, z] of spots) {
    const blossom = new THREE.SphereGeometry(0.085, 8, 6);
    blossom.translate(x, y, z);
    blossoms.push(smoothNormals(blossom));
  }

  return {
    parts: [
      part(leaves, context.material(0x8fcf8f)),
      part(mergeGeometries(blossoms), context.material(0xf7b6c8), { castShadow: false }),
    ],
    radius: 0.62,
    height: 0.95,
  };
}
