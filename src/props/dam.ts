/**
 * Leaky wooden dam.
 *
 * A few stacked logs pinned between driven stakes, with gaps between them —
 * that porosity is the whole point of the structure and it should be visible.
 * A solid barrier would read as a weir, which is a different thing that does a
 * different job and is generally bad for a watercourse.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { part, type PropAsset, type PropContext } from "./types";

const LOG_COLOUR = 0xc29a70;
const STAKE_COLOUR = 0xa7825f;

export function leakyDam(context: PropContext): PropAsset {
  const width = 3.4;
  const logRadius = 0.22;

  const logs: THREE.BufferGeometry[] = [];
  // Three courses with a gap between each, so water is visibly meant to pass.
  for (let course = 0; course < 3; course++) {
    const log = new THREE.CylinderGeometry(logRadius, logRadius * 0.92, width, 14);
    log.rotateZ(Math.PI / 2);
    // Alternate the ends slightly, the way stacked timber actually sits.
    log.translate((course % 2 === 0 ? 1 : -1) * 0.12, 0.3 + course * 0.55, 0);
    logs.push(log);
  }

  const stakes: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const stake = new THREE.CylinderGeometry(0.14, 0.11, 2.4, 12);
    stake.translate((side * width) / 2, 1.0, 0);
    stakes.push(stake);
  }

  return {
    parts: [
      part(mergeGeometries(logs), context.material(LOG_COLOUR)),
      part(mergeGeometries(stakes), context.material(STAKE_COLOUR)),
    ],
    radius: width / 2,
    height: 1.9,
  };
}
