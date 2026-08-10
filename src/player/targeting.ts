/**
 * Which cell the player is about to build on.
 *
 * Taken from where the avatar is standing and facing, in grid coordinates —
 * **not** from a mouse raycast. That is a design decision, not a shortcut, and
 * the reason is the curved world.
 *
 * The curvature shader displaces vertices in the vertex stage, so the pixels on
 * screen no longer correspond to the CPU-side geometry a raycast would test. At
 * 30 metres the discrepancy is already metres wide, and it grows quadratically:
 * the player would click a spot and watch the ghost appear somewhere else, worse
 * the further away they aimed. Unbending the ray is possible but means inverting
 * a per-vertex transform against a heightfield, for a result that still fights
 * the player's eye.
 *
 * Animal Crossing itself targets the tile the character faces, and it turns out
 * to be better on every axis that matters here: exact at any distance, identical
 * on touch and gamepad, and it puts the player physically at the place they are
 * changing, which is the right relationship to a landscape you are meant to be
 * walking around and reading.
 */

import type { GridSpec } from "../core/grid";
import { worldToCell } from "../render/terrainMesh";

/** How far in front of the player the target sits, in metres. */
const REACH_M = 3.2;

export interface Target {
  /** Grid cell, or -1 when facing off the edge of the catchment. */
  readonly cell: number;
  readonly x: number;
  readonly z: number;
}

export function facingTarget(
  spec: GridSpec,
  playerX: number,
  playerZ: number,
  yaw: number,
  out: { cell: number; x: number; z: number },
): Target {
  // Matches the controller's convention: yaw 0 faces +z, and increases towards
  // +x. Getting this wrong puts the target behind the player, which looks like a
  // broken control rather than a sign convention.
  const x = playerX + Math.sin(yaw) * REACH_M;
  const z = playerZ + Math.cos(yaw) * REACH_M;

  out.x = x;
  out.z = z;
  out.cell = worldToCell(spec, x, z);
  return out;
}
