/**
 * Third-person follow camera.
 *
 * Orbits a point above the player at a fixed distance, lagging slightly so the
 * frame breathes rather than being welded to the character. Pitch is clamped to
 * a shallow band: the catchment is read at a low oblique angle, and letting the
 * player look straight down turns the risk map into a flat plan view where the
 * terrain stops helping them interpret it.
 *
 * The camera also lifts over rising ground, which for a heightfield is cheaper
 * and steadier than a collision test — the ground is a function, so the answer
 * is a sample rather than a sweep.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import { sampleHeight } from "./terrainMesh";

const DISTANCE = 17;
const HEIGHT_OVER_TARGET = 2.1;
const MIN_PITCH = 0.14;
const MAX_PITCH = 0.72;
/** Metres of clearance kept between the camera and the ground below it. */
const GROUND_CLEARANCE = 1.6;

export interface FollowCamera {
  /** Orbit angle about Y, which movement is expressed relative to. */
  readonly yaw: number;
  update(target: THREE.Vector3, lookX: number, lookY: number, dt: number): void;
}

export function createFollowCamera(
  camera: THREE.PerspectiveCamera,
  dem: Float32Array,
  spec: GridSpec,
  initialYaw = 0,
): FollowCamera {
  let yaw = initialYaw;
  let pitch = 0.42;

  const focus = new THREE.Vector3();
  const wanted = new THREE.Vector3();
  let initialised = false;

  return {
    get yaw() {
      return yaw;
    },

    update(target, lookX, lookY, dt) {
      yaw += lookX;
      pitch = THREE.MathUtils.clamp(pitch + lookY, MIN_PITCH, MAX_PITCH);

      // Lag the focus point rather than the camera position. Smoothing the
      // camera directly makes fast turns swing wide; smoothing what it looks at
      // keeps the character centred while the frame still settles.
      focus.set(target.x, target.y + HEIGHT_OVER_TARGET, target.z);

      const horizontal = Math.cos(pitch) * DISTANCE;
      wanted.set(
        focus.x - Math.sin(yaw) * horizontal,
        focus.y + Math.sin(pitch) * DISTANCE,
        focus.z - Math.cos(yaw) * horizontal,
      );

      // Never let the camera end up inside a hill behind the player.
      const groundHere = sampleHeight(dem, spec, wanted.x, wanted.z);
      wanted.y = Math.max(wanted.y, groundHere + GROUND_CLEARANCE);

      if (!initialised) {
        camera.position.copy(wanted);
        initialised = true;
      } else {
        // Framerate-independent smoothing; a plain lerp would make the follow
        // distance depend on frame rate.
        camera.position.lerp(wanted, 1 - Math.exp(-dt / 0.07));
      }
      camera.lookAt(focus);
    },
  };
}
