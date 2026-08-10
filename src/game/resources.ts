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

  const scatter = (kind: NodeKind, cells: number[], count: number): void => {
    if (cells.length === 0) return;
    for (let i = 0; i < count; i++) {
      const cell = cells[rng.int(cells.length)];
      const position = cellToWorld(spec, cell, new THREE.Vector3());
      position.y = arrays.dem[cell];
      nodes.push({ id: nextId++, kind, cell, position, collected: false });
    }
  };

  scatter("wood", candidates(LandCover.Woodland), WOOD_NODES);

  // Stone comes off the rough ground where the boulders are.
  const stoneCells = [
    ...candidates(LandCover.Moorland),
    ...candidates(LandCover.ExtensiveGrassland),
  ];
  scatter("stone", stoneCells, STONE_NODES);

  // One spade, on open ground well away from where the player starts.
  const spadeCells: number[] = [];
  const startRow = (startCell / spec.width) | 0;
  const startCol = startCell % spec.width;
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
