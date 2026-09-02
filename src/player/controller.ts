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

/**
 * Radius of the player's own footprint, in metres.
 *
 * Added to every obstacle's radius so the character stops with their shoulder
 * against a wall rather than with their centre on it, which at this camera
 * distance is the difference between standing beside a cottage and standing
 * half inside one.
 */
const PLAYER_RADIUS_M = 0.45;

/** A solid circular footprint in the ground plane. */
export interface Obstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface Player {
  readonly position: THREE.Vector3;
  /** Facing, in radians about Y. */
  readonly yaw: number;
  /** Current ground speed in metres per second. */
  readonly speed: number;
  update(input: InputState, cameraYaw: number, dt: number): void;
}

/**
 * Push a candidate position out of anything solid it has ended up inside.
 *
 * Projecting back onto the circle's edge rather than refusing the step, so that
 * walking into a wall at an angle slides along it. Refusing outright would stop
 * the player dead against a cottage they were only brushing past, which reads
 * as the controls sticking.
 *
 * Resolved against every obstacle in turn, and the order is not significant
 * here because buildings are sited far enough apart that their footprints do
 * not overlap — if they ever do, a corner between two of them would need a
 * second pass to settle.
 */
function pushOut(
  obstacles: readonly Obstacle[],
  x: number,
  z: number,
  out: { x: number; z: number },
): void {
  out.x = x;
  out.z = z;

  for (const obstacle of obstacles) {
    const reach = obstacle.radius + PLAYER_RADIUS_M;
    const dx = out.x - obstacle.x;
    const dz = out.z - obstacle.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= reach * reach) continue;

    // Dead centre has no direction to be pushed in. Only reachable by starting
    // inside a footprint, so any consistent choice will do.
    if (distanceSq < 1e-8) {
      out.x = obstacle.x + reach;
      continue;
    }

    const distance = Math.sqrt(distanceSq);
    out.x = obstacle.x + (dx / distance) * reach;
    out.z = obstacle.z + (dz / distance) * reach;
  }
}

export function createPlayer(
  dem: Float32Array,
  spec: GridSpec,
  start: THREE.Vector3,
  obstacles: readonly Obstacle[] = [],
): Player {
  const position = start.clone();
  position.y = sampleHeight(dem, spec, position.x, position.z);

  let yaw = 0;
  let speed = 0;

  const desired = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const resolved = { x: 0, z: 0 };
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
      //
      // Both terms are negated relative to the textbook rotation matrix. The z
      // negation is because the camera's own forward axis (see
      // `createFollowCamera`) is +z at yaw zero, while "forward" input arrives
      // as z = -1 (screen-space up). The x negation is because that same camera
      // has its screen-right axis at world -x when yaw is zero (it orbits behind
      // the target rather than sitting in front of it), while "right" input
      // arrives as x = +1. Using the unnegated matrix rotates the *input's*
      // frame instead of mapping it onto the camera's, which mirrors the
      // controls: forward/backward walks the player backward at yaw zero, and
      // left/right walks them the wrong way at every yaw.
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      desired.set(
        -(inputX * cos + inputZ * sin) / magnitude,
        0,
        (inputX * sin - inputZ * cos) / magnitude,
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
        // The edge clamp still runs after the push-out, which in principle
        // could put the player back inside something. It cannot in practice:
        // buildings are sited on the valley floor, and the clamp only bites
        // within a cell of the catchment boundary.
        pushOut(obstacles, nextX, nextZ, resolved);
        position.x = THREE.MathUtils.clamp(resolved.x, -halfExtentX, halfExtentX);
        position.z = THREE.MathUtils.clamp(resolved.z, -halfExtentZ, halfExtentZ);
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
