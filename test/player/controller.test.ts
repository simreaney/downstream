/**
 * Walking, and what stops it.
 *
 * The collision here is a circle push-out rather than a refused step, and the
 * difference only shows in one case: approaching a wall at an angle. A refusal
 * stops the player dead against a cottage they were walking past, which reads
 * as the controls sticking rather than as a wall — so "slides along" is the
 * behaviour under test, not merely "does not pass through".
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GridSpec } from "../../src/core/grid";
import { createPlayer, type Obstacle } from "../../src/player/controller";
import type { InputState } from "../../src/player/input";

const SPEC: GridSpec = { width: 64, height: 64, cellSize: 4 };

/** Dead flat, so nothing but the obstacles can refuse a step. */
const FLAT = new Float32Array(SPEC.width * SPEC.height).fill(10);

function input(moveX: number, moveZ: number): InputState {
  return { moveX, moveZ, lookX: 0, lookY: 0, sprint: false };
}

/** Walk for two seconds of frames, with the camera facing down +z. */
function walk(player: ReturnType<typeof createPlayer>, state: InputState): void {
  for (let frame = 0; frame < 120; frame++) player.update(state, 0, 1 / 60);
}

describe("createPlayer", () => {
  it("walks freely with nothing in the way", () => {
    const player = createPlayer(FLAT, SPEC, new THREE.Vector3(0, 0, 0));
    walk(player, input(0, 1));
    expect(player.position.z).toBeGreaterThan(5);
  });

  it("cannot walk through a building", () => {
    const house: Obstacle = { x: 0, z: 12, radius: 2.3 };
    const player = createPlayer(FLAT, SPEC, new THREE.Vector3(0, 0, 0), [house]);

    // Straight at it, long enough to have crossed it several times over.
    walk(player, input(0, 1));

    const distance = Math.hypot(player.position.x - house.x, player.position.z - house.z);
    expect(distance).toBeGreaterThanOrEqual(house.radius);
    // Stopped in front of it, not teleported past it.
    expect(player.position.z).toBeLessThan(house.z);
  });

  it("slides along a wall approached at an angle instead of sticking", () => {
    const house: Obstacle = { x: 0, z: 12, radius: 2.3 };
    const player = createPlayer(FLAT, SPEC, new THREE.Vector3(-1.5, 0, 0), [house]);

    walk(player, input(0, 1));

    // Pushed around the side rather than held on the centre line it started on.
    expect(Math.abs(player.position.x)).toBeGreaterThan(1.5);
    expect(Math.hypot(player.position.x - house.x, player.position.z - house.z))
      .toBeGreaterThanOrEqual(house.radius);
  });

  it("pushes out of a footprint it somehow started inside", () => {
    // Reachable only through a save restored against different scenery, but a
    // player wedged permanently inside a wall is unrecoverable, so it must not
    // depend on never happening.
    const house: Obstacle = { x: 0, z: 0, radius: 3 };
    const player = createPlayer(FLAT, SPEC, new THREE.Vector3(0, 0, 0), [house]);

    walk(player, input(0, 1));

    expect(Math.hypot(player.position.x, player.position.z)).toBeGreaterThanOrEqual(house.radius);
  });

  it("keeps the player inside the catchment", () => {
    const player = createPlayer(FLAT, SPEC, new THREE.Vector3(0, 0, 0));
    for (let frame = 0; frame < 600; frame++) player.update(input(0, 1), 0, 1 / 60);

    const halfExtent = (SPEC.height * SPEC.cellSize) / 2;
    expect(player.position.z).toBeLessThanOrEqual(halfExtent);
  });
});
