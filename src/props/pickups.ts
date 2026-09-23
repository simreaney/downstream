/**
 * Gatherable markers.
 *
 * Resources have to be *visible* from a distance or gathering becomes wandering
 * with the E key held down. A stack of cut logs and a spade stuck in the ground
 * both read instantly at silhouette scale, which is the only scale that matters
 * when the player is scanning a hillside for something to pick up.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { part, type PropAsset, type PropContext } from "./types";

const TIMBER = 0xc49a6c;
const CUT_END = 0xf2dfbc;
const HANDLE = 0xb58c64;
const BLADE = 0xcdd8e0;

/**
 * A stack of cut logs, with two leaning against it — the wood pickup.
 *
 * Sized against what it has to compete with rather than against itself. A stack
 * a metre wide and knee high is a correct woodpile and was invisible in play:
 * it sits *inside* woodland, where the things around it are seven metres tall,
 * so from any distance worth scanning from it was a brown speck under a canopy.
 * The leaning pair is the cheap half of the fix — height reads at distance where
 * bulk does not, and two uprights break the horizontal line of everything else
 * on the forest floor.
 */
export function logPile(context: PropContext): PropAsset {
  const logs: THREE.BufferGeometry[] = [];
  const ends: THREE.BufferGeometry[] = [];

  const length = 1.9;
  const radius = 0.3;

  // Two on the bottom, one nested on top: the way timber actually stacks, and
  // enough asymmetry that it does not read as a machined block.
  const layout: [number, number, number][] = [
    [-0.32, 0.3, 0],
    [0.32, 0.3, 0],
    [0, 0.85, 0.05],
  ];

  for (const [x, y, z] of layout) {
    const log = new THREE.CylinderGeometry(radius, radius, length, 14);
    log.rotateZ(Math.PI / 2);
    log.translate(x, y, z);
    logs.push(log);

    // Pale cut ends, so the pile reads as felled timber rather than as branches.
    for (const side of [-1, 1]) {
      const end = new THREE.CylinderGeometry(radius + 0.005, radius + 0.005, 0.06, 14);
      end.rotateZ(Math.PI / 2);
      end.translate(x + side * (length / 2), y, z);
      ends.push(end);
    }
  }

  // Two leaning against the stack, tilted out of plane so the silhouette is not
  // symmetrical from every angle.
  for (const [tilt, offset] of [[0.42, -0.55], [-0.34, 0.62]] as const) {
    const leaning = new THREE.CylinderGeometry(radius * 0.8, radius * 0.85, 2.3, 12);
    leaning.translate(0, 1.15, 0);
    leaning.rotateX(tilt * 0.5);
    leaning.rotateZ(tilt);
    leaning.translate(offset, 0.1, offset * 0.35);
    logs.push(leaning);
  }

  return {
    parts: [
      part(mergeGeometries(logs), context.material(TIMBER)),
      part(mergeGeometries(ends), context.material(CUT_END)),
    ],
    radius: 1.1,
    height: 2.2,
  };
}

/** A spade stuck upright in the ground — the one-off tool pickup. */
export function spade(context: PropContext): PropAsset {
  const shaft = new THREE.CylinderGeometry(0.06, 0.055, 1.5, 10);
  shaft.translate(0, 0.95, 0);

  const grip = new THREE.TorusGeometry(0.13, 0.05, 8, 16);
  grip.rotateY(Math.PI / 2);
  grip.translate(0, 1.76, 0);

  const blade = new THREE.CapsuleGeometry(0.15, 0.18, 4, 12);
  blade.scale(1.1, 1, 0.3);
  blade.translate(0, 0.28, 0);

  return {
    parts: [
      part(mergeGeometries([shaft, grip]), context.material(HANDLE)),
      part(blade, context.material(BLADE)),
    ],
    radius: 0.35,
    height: 1.9,
  };
}
