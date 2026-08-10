/**
 * Trees.
 *
 * Chunky and low-poly: an icosahedron canopy on a tapered trunk, faceted rather
 * than smooth so the toon ramp's bands catch on flat planes instead of sliding
 * over a sphere. At the density this catchment needs — thousands of them —
 * silhouette is the only thing that reads at distance, so the detail budget goes
 * on the outline: a canopy lumpy enough to look grown rather than moulded, a
 * trunk that flares where it meets the ground, and a fir whose branch tiers step
 * outwards.
 *
 * Subdivision drops a level on low-power devices. A broadleaf canopy is 320
 * triangles at detail 2 and 80 at detail 1, and with thousands of instances each
 * drawn twice — once more for the shadow map — that one level is most of the
 * vegetation budget on a phone.
 *
 * Three species, and the distinction is functional rather than decorative.
 * Willow is reserved for riparian planting, so a continuous buffer along a
 * watercourse is legible as a buffer from across the valley without turning the
 * risk overlay on — the player can see their own work.
 */

import * as THREE from "three";
import { isLowPower } from "../config";
import { part, type PropAsset, type PropContext } from "./types";

/** Icosahedron subdivisions for a full-size canopy. */
const CANOPY_DETAIL = isLowPower() ? 1 : 2;

/** Sides and rings on a trunk. */
const TRUNK_SIDES = isLowPower() ? 6 : 9;
const TRUNK_RINGS = 4;

/** Sides on a fir crown, and the number of branch tiers stacked up it. */
const CONIFER_SIDES = isLowPower() ? 7 : 11;
const CONIFER_TIERS = 4;

/** Canopy lumpiness, as a fraction of the radius. */
const CANOPY_LUMP = 0.22;

/** How far the base of a trunk swells outwards, as a fraction of its radius. */
const ROOT_FLARE = 0.55;

/** Ring-to-ring step of a fir's branch tiers, and the ragged wobble on their tips. */
const TIER_STEP = 0.14;
const TIER_RAGGED = 0.06;

/**
 * A smooth, deterministic radial offset over the unit sphere.
 *
 * Continuous by construction, and that — rather than the shape it happens to
 * make — is the load-bearing property. Icosahedron geometry is non-indexed:
 * every facet carries its own copy of each corner, so displacing vertices by a
 * per-vertex random number pulls the copies of a shared corner apart and tears
 * the canopy into unconnected triangles. At detail 1 the gaps hid inside facets
 * large enough to read as intentional; four times as many facets would have made
 * them obvious. A function of *direction alone* hands every copy of a corner the
 * same answer, so the surface stays welded however finely it is subdivided.
 */
function lumpiness(x: number, y: number, z: number, phase: number): number {
  return (
    (Math.sin(x * 2.9 + phase) * 0.4 +
      Math.sin(y * 3.3 - phase * 1.7) * 0.28 +
      Math.sin(z * 4.1 + phase * 0.6) * 0.32 +
      Math.sin((x + y + z) * 5.7 - phase * 2.3) * 0.16) /
    1.16
  );
}

/** Phase offset for a species, so each one keeps a silhouette of its own. */
function phaseOf(seed: number): number {
  return (seed % 1024) * 0.0613;
}

/** Canopy geometry, pushed in and out so it is not an obvious solid. */
function canopy(radius: number, detail: number, squash: number, seed: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const phase = phaseOf(seed);

  // The geometry is shared by every instance, so this runs once and gives the
  // species a silhouette rather than giving each tree one.
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const inverse = 1 / Math.max(1e-6, Math.sqrt(x * x + y * y + z * z));
    const scale = 1 + lumpiness(x * inverse, y * inverse, z * inverse, phase) * CANOPY_LUMP;
    position.setXYZ(i, x * scale, y * scale * squash, z * scale);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Trunk, swelling into a root flare at the base.
 *
 * The flare matters more than its size suggests: a bare cylinder meeting the
 * ground at a hard edge is the detail that gives away a placed prop, and it is
 * exactly where the player stands when they gather wood.
 */
function trunk(bottom: number, top: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, TRUNK_SIDES, TRUNK_RINGS);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const t = Math.min(1, Math.max(0, (y + height / 2) / height));
    // Fourth power, so the swell is confined to the lowest ring or two rather
    // than turning the whole trunk into a cone.
    const flare = 1 + ROOT_FLARE * (1 - t) ** 4;
    position.setXYZ(i, position.getX(i) * flare, y, position.getZ(i) * flare);
  }
  geometry.computeVertexNormals();

  // Origin at the base, so an instance's transform is simply where the tree
  // stands rather than where its middle is.
  geometry.translate(0, height / 2, 0);
  return geometry;
}

/**
 * A fir crown: a cone whose rings step alternately in and out, so the profile
 * reads as stacked tiers of branches rather than as a traffic cone. The apex
 * vertices sit on the axis and are left alone, which keeps the tip sharp.
 */
function firCrown(radius: number, height: number, seed: number): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(radius, height, CONIFER_SIDES, CONIFER_TIERS);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const phase = phaseOf(seed);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const distance = Math.sqrt(x * x + z * z);
    if (distance < 1e-5) continue;

    const t = Math.min(1, Math.max(0, (y + height / 2) / height));
    const ring = Math.round(t * CONIFER_TIERS);
    // Wide ring: the underside of a tier of branches. Narrow ring: the stem
    // showing through between two of them.
    const tier = ring % 2 === 0 ? 1 + TIER_STEP : 1 - TIER_STEP;
    const ragged = 1 + TIER_RAGGED * Math.sin(Math.atan2(z, x) * 3 + phase + t * 4);
    const scale = tier * ragged;

    position.setXYZ(i, x * scale, y, z * scale);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function broadleaf(context: PropContext): PropAsset {
  const height = 4.2;
  const canopyGeometry = canopy(2.5, CANOPY_DETAIL, 0.85, 0x1234);
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
  const crown = firCrown(1.9, 6.4, 0x5e11);
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
  const canopyGeometry = canopy(2.9, CANOPY_DETAIL, 0.6, 0x9ab1);
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
  // One level below the mature canopies: a whip is under a metre across, so its
  // facets are already smaller on screen than a full canopy's at twice the
  // subdivision, and there can be hundreds of them in a new planting.
  const leaves = canopy(0.6, Math.max(0, CANOPY_DETAIL - 1), 1.1, 0x33cc);
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
