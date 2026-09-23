/**
 * Fish.
 *
 * The clearest signal in the game that the catchment is recovering, and
 * deliberately the least explained one — nobody needs telling that fish coming
 * back is good. A flattened body and a tail fin, instanced, with the count
 * driven by the fishery's clarity.
 */

import * as THREE from "three";
import { bakeSoftAo } from "../render/softFinish";
import { part, type PropAsset, type PropContext } from "./types";

export function fish(context: PropContext): PropAsset {
  const body = new THREE.SphereGeometry(0.22, 14, 10);
  // Flattened and stretched: at this size the silhouette is all that reads.
  body.scale(1.8, 0.75, 0.5);

  const tail = new THREE.ConeGeometry(0.16, 0.3, 10);
  tail.rotateZ(Math.PI / 2);
  tail.scale(1, 1, 0.4);
  tail.translate(-0.5, 0, 0);

  // Built around their own centre and drawn under the surface, so the contact
  // term `part()` would bake from y = 0 would dim the whole fish. Baked here with
  // a lift instead, leaving only the soft underside term.
  bakeSoftAo(body, 2);
  bakeSoftAo(tail, 2);

  return {
    parts: [
      part(body, context.material(0xf4ab8c), { castShadow: false }),
      part(tail, context.material(0xeb9477), { castShadow: false }),
    ],
    radius: 0.4,
    height: 0.2,
  };
}
