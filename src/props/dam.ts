/**
 * Leaky wooden dam.
 *
 * A few stacked logs pinned between driven stakes, with gaps between them —
 * that porosity is the whole point of the structure and it should be visible.
 * A solid barrier would read as a weir, which is a different thing that does a
 * different job and is generally bad for a watercourse.
 */

import * as THREE from "three";
import { part, type PropAsset, type PropContext } from "./types";

const LOG_COLOUR = 0x7a5a38;
const STAKE_COLOUR = 0x5f472c;

export function leakyDam(context: PropContext): PropAsset {
  const width = 3.4;
  const logRadius = 0.22;

  const logs: THREE.BufferGeometry[] = [];
  // Three courses with a gap between each, so water is visibly meant to pass.
  for (let course = 0; course < 3; course++) {
    const log = new THREE.CylinderGeometry(logRadius, logRadius * 0.92, width, 7);
    log.rotateZ(Math.PI / 2);
    // Alternate the ends slightly, the way stacked timber actually sits.
    log.translate((course % 2 === 0 ? 1 : -1) * 0.12, 0.3 + course * 0.55, 0);
    logs.push(log);
  }

  const stakes: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const stake = new THREE.CylinderGeometry(0.14, 0.11, 2.4, 6);
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

/**
 * Concatenate geometries sharing a material into one buffer.
 *
 * Avoids pulling in three's BufferGeometryUtils for a job this small, and keeps
 * a dam to two draw calls however many logs it is built from.
 */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
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
