/**
 * Gatherable wood, stone and the spade.
 *
 * Wood comes from the existing woodland and stone from the boulder fields, so
 * the player's supply lines are themselves part of the landscape: the material
 * to build a buffer has to be carried from wherever the trees already are.
 *
 * The spade is placed deliberately rather than randomly — far enough from the
 * start that the player has walked the catchment and read the risk map before
 * ponds become available, which is the order the game wants those ideas in.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import { createRng, splitSeed } from "../core/rng";
import { LandCover } from "../scimap/constants";
import { MAX_WALK_SLOPE_DEG } from "../player/controller";
import { cellToWorld } from "../render/terrainMesh";
import type { MainThreadArrays } from "../worker/client";

export type NodeKind = "wood" | "stone" | "spade";

export interface ResourceNode {
  readonly id: number;
  readonly kind: NodeKind;
  readonly cell: number;
  readonly position: THREE.Vector3;
  collected: boolean;
}

/** Metres within which a node can be picked up. */
export const PICKUP_RADIUS_M = 3.5;

const WOOD_NODES = 90;
const STONE_NODES = 55;

/**
 * Wood nodes reserved for the woodland nearest the start.
 *
 * Scattering uniformly leaves the first stand the player reaches holding one or
 * two piles out of ninety, because that stand is a small share of the
 * catchment's woodland — measured across seeds, the nearest node sits 74 to 173
 * metres out and the median one is over half a kilometre away. The walk is not
 * the problem and is not being removed; arriving at trees and finding nothing
 * to gather is. These bias the *first* stand into being worth the trip.
 */
const WOOD_NEAR_START = 10;

/** How much of the catchment counts as "near the start", as a fraction of its width. */
const NEAR_START_FRACTION = 0.25;

export const WOOD_PER_NODE = 4;
export const STONE_PER_NODE = 3;

export interface Resources {
  readonly nodes: readonly ResourceNode[];
  /** Nearest uncollected node within reach, or null. */
  nearest(x: number, z: number): ResourceNode | null;
  collect(node: ResourceNode): void;
}

export function createResources(
  arrays: MainThreadArrays,
  spec: GridSpec,
  seed: number,
  startCell: number,
): Resources {
  const rng = createRng(splitSeed(seed, "resources"));
  const nodes: ResourceNode[] = [];
  let nextId = 1;

  const candidates = (cover: LandCover): number[] => {
    const cells: number[] = [];
    for (let cell = 0; cell < arrays.landCover.length; cell++) {
      if (arrays.landCover[cell] !== cover) continue;
      if (arrays.channelMask[cell]) continue;
      // Must be reachable. Tied to the controller's own limit rather than a
      // separate number: relict woodland sits on 26-30 degree ground, so an
      // independent 25-degree filter silently produced *zero* wood nodes while
      // leaving the rest of the game working perfectly.
      if (arrays.slopeDeg[cell] > MAX_WALK_SLOPE_DEG - 1) continue;
      cells.push(cell);
    }
    return cells;
  };

  // One node per cell. Drawing with replacement stacked two piles on the same
  // spot often enough to matter — a few of the ninety were invisible, sitting
  // inside each other, and the second was unreachable because `nearest` returns
  // the first within range and the player has already taken it.
  const used = new Set<number>();

  const scatter = (kind: NodeKind, cells: number[], count: number): void => {
    if (cells.length === 0) return;
    for (let i = 0; i < count; i++) {
      let cell = cells[rng.int(cells.length)];
      // A bounded retry rather than filtering the candidate list: the lists run
      // to thousands of cells against fewer than a hundred draws, so a collision
      // is rare and rebuilding the pool to guarantee one would cost more than it
      // saves. Giving up after a few tries keeps this terminating even when the
      // pool is genuinely smaller than the count asked for.
      for (let retry = 0; retry < 8 && used.has(cell); retry++) {
        cell = cells[rng.int(cells.length)];
      }
      if (used.has(cell)) continue;
      used.add(cell);

      const position = cellToWorld(spec, cell, new THREE.Vector3());
      position.y = arrays.dem[cell];
      nodes.push({ id: nextId++, kind, cell, position, collected: false });
    }
  };

  const startRow = (startCell / spec.width) | 0;
  const startCol = startCell % spec.width;

  const woodCells = candidates(LandCover.Woodland);
  const nearRadius = spec.width * NEAR_START_FRACTION;
  const nearStart = woodCells.filter((cell) => {
    const dRow = ((cell / spec.width) | 0) - startRow;
    const dCol = (cell % spec.width) - startCol;
    return Math.hypot(dRow, dCol) <= nearRadius;
  });

  // The near pool first, so those cells are claimed before the uniform scatter
  // spends the budget. If the start happens to sit in open country with no
  // woodland inside the radius, this places nothing and the uniform scatter
  // below is unchanged — the guarantee is best-effort by construction.
  scatter("wood", nearStart, Math.min(WOOD_NEAR_START, nearStart.length));
  scatter("wood", woodCells, WOOD_NODES - WOOD_NEAR_START);

  // Stone comes off the rough ground where the boulders are.
  const stoneCells = [
    ...candidates(LandCover.Moorland),
    ...candidates(LandCover.ExtensiveGrassland),
  ];
  scatter("stone", stoneCells, STONE_NODES);

  // One spade, on open ground well away from where the player starts.
  const spadeCells: number[] = [];
  const minDistance = spec.width * 0.35;

  for (let cell = 0; cell < arrays.landCover.length; cell++) {
    if (arrays.channelMask[cell] || arrays.slopeDeg[cell] > 12) continue;
    const dRow = ((cell / spec.width) | 0) - startRow;
    const dCol = (cell % spec.width) - startCol;
    if (Math.hypot(dRow, dCol) < minDistance) continue;
    spadeCells.push(cell);
  }
  scatter("spade", spadeCells, 1);

  return {
    nodes,

    nearest(x, z) {
      let best: ResourceNode | null = null;
      let bestDistance = PICKUP_RADIUS_M;

      for (const node of nodes) {
        if (node.collected) continue;
        const distance = Math.hypot(node.position.x - x, node.position.z - z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node;
        }
      }
      return best;
    },

    collect(node) {
      node.collected = true;
    },
  };
}
