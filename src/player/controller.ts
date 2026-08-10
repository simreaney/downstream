/**
 * Player movement over the heightfield.
 *
 * The character walks on the sampled terrain rather than being simulated by a
 * physics engine, which for a heightfield is both exact and free. Height comes
 * from `sampleHeight`, not from a raycast: the curvature shader displaces the
 * rendered ground away from the CPU geometry, so a raycast would put the player
 * where the terrain *isn't*.
 *
 * Movement is in camera space, the Animal Crossing convention — pressing forward
 * walks away from the camera whatever direction it faces — and the character
 * turns to face the direction of travel rather than the camera.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import { approach } from "../core/clamp";
import { sampleHeight, sampleNormal } from "../render/terrainMesh";
import type { InputState } from "./input";

const WALK_SPEED = 8.5;
const SPRINT_SPEED = 15;
/** Seconds to close most of the gap when turning to face travel. */
const TURN_TAU = 0.06;

/**
 * Slope the player cannot climb, in degrees.
 *
 * Set just below the 33-degree talus angle the terrain is relaxed to, so
 * anywhere material would come to rest is walkable and the few faces steeper
 * than that read honestly as cliffs.
 */
export const MAX_WALK_SLOPE_DEG = 31;

export interface Player {
  readonly position: THREE.Vector3;
  /** Facing, in radians about Y. */
  readonly yaw: number;
  /** Current ground speed in metres per second. */
  readonly speed: number;
  update(input: InputState, cameraYaw: number, dt: number): void;
}

export function createPlayer(
  dem: Float32Array,
  spec: GridSpec,
  start: THREE.Vector3,
): Player {
  const position = start.clone();
  position.y = sampleHeight(dem, spec, position.x, position.z);

  let yaw = 0;
  let speed = 0;

  const desired = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const halfExtentX = (spec.width * spec.cellSize) / 2 - spec.cellSize;
  const halfExtentZ = (spec.height * spec.cellSize) / 2 - spec.cellSize;

  const cosMaxSlope = Math.cos((MAX_WALK_SLOPE_DEG * Math.PI) / 180);

  return {
    position,
    get yaw() {
      return yaw;
    },
    get speed() {
      return speed;
    },

    update(input, cameraYaw, dt) {
      const inputX = input.moveX;
      const inputZ = input.moveZ;
      const magnitude = Math.hypot(inputX, inputZ);

      if (magnitude < 1e-4) {
        speed = approach(speed, 0, 0.08, dt);
        return;
      }

      // Rotate the intent into world space so "forward" means away from the
      // camera, then normalise so diagonals are not faster than cardinals.
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      desired.set(
        (inputX * cos - inputZ * sin) / magnitude,
        0,
        (inputX * sin + inputZ * cos) / magnitude,
      );

      const target = input.sprint ? SPRINT_SPEED : WALK_SPEED;
      speed = approach(speed, target, 0.09, dt);

      const step = speed * dt;
      const nextX = THREE.MathUtils.clamp(
        position.x + desired.x * step,
        -halfExtentX,
        halfExtentX,
      );
      const nextZ = THREE.MathUtils.clamp(
        position.z + desired.z * step,
        -halfExtentZ,
        halfExtentZ,
      );

      // Refuse the step if the ground there is too steep to stand on. Checking
      // the destination rather than the current cell means the player stops at
      // the foot of a cliff instead of walking onto it and sliding.
      sampleNormal(dem, spec, nextX, nextZ, normal);
      if (normal.y >= cosMaxSlope) {
        position.x = nextX;
        position.z = nextZ;
      } else {
        speed *= 0.4;
      }

      position.y = sampleHeight(dem, spec, position.x, position.z);

      // Face the direction of travel, damped so a sharp input reversal reads as
      // a turn rather than an instant flip.
      const targetYaw = Math.atan2(desired.x, desired.z);
      let delta = targetYaw - yaw;
      // Take the short way round, or a turn past due south spins the long way.
      delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (delta < -Math.PI) delta += Math.PI * 2;
      yaw += delta * (1 - Math.exp(-dt / TURN_TAU));
    },
  };
}
