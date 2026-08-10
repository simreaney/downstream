/**
 * Fish.
 *
 * The clearest signal in the game that the catchment is recovering, and
 * deliberately the least explained one — nobody needs telling that fish coming
 * back is good. A flattened body and a tail fin, instanced, with the count
 * driven by the fishery's clarity.
 */

import * as THREE from "three";
import { part, type PropAsset, type PropContext } from "./types";

export function fish(context: PropContext): PropAsset {
  const body = new THREE.SphereGeometry(0.22, 8, 6);
  // Flattened and stretched: at this size the silhouette is all that reads.
  body.scale(1.8, 0.75, 0.5);

  const tail = new THREE.ConeGeometry(0.16, 0.3, 4);
  tail.rotateZ(Math.PI / 2);
  tail.scale(1, 1, 0.4);
  tail.translate(-0.5, 0, 0);

  return {
    parts: [
      part(body, context.material(0x9a8f5c), { castShadow: false }),
      part(tail, context.material(0x8a7f4e), { castShadow: false }),
    ],
    radius: 0.4,
    height: 0.2,
  };
}
