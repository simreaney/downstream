/**
 * Third-person follow camera, framed as a tilted 3/4 diorama, with zoom.
 *
 * Orbits a point on the player from well back and well up, through the narrow
 * field of view set in `renderer.ts`, so the world reads like a miniature on a
 * tabletop seen from a chair: the ground plane is clearly visible around the
 * character, the chibi figure is seen from slightly above, and perspective is
 * gentle. It lags slightly so the frame breathes rather than being welded to
 * the character.
 *
 * Pitch is clamped to a band around 45 degrees. Lower and the diorama feel is
 * lost to an over-the-shoulder view; much steeper and the risk map turns into a
 * flat plan view where the terrain stops helping the player interpret it.
 *
 * ## Zoom
 *
 * The player can pull back from a close view of the character to an overview
 * of a good part of the catchment. Two things change with distance besides the
 * distance itself. The pitch leans further over as the camera rises, up to
 * about 57 degrees at full zoom-out, because from that far a low camera looks
 * mostly at sky and the overview is only useful if it shows ground. And
 * `main.ts` flattens the curved world and widens the shadowed area to match
 * (see `curvature.ts`, `lighting.ts`), so the overview reads as a map rather
 * than as a small planet with shadows round the player's feet.
 *
 * The camera also lifts over rising ground, which for a heightfield is cheaper
 * and steadier than a collision test — the ground is a function, so the answer
 * is a sample rather than a sweep.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import { sampleHeight } from "./terrainMesh";

/** Distance from the focus point at the default zoom, in metres. */
export const DEFAULT_CAMERA_DISTANCE = 24;
/** Closest and furthest zoom, in metres. */
const MIN_DISTANCE = 11;
const MAX_DISTANCE = 190;
/** Stops the gamepad's zoom button steps through, in metres. */
const ZOOM_STOPS = [DEFAULT_CAMERA_DISTANCE, 70, MAX_DISTANCE];
/** Time constant of the zoom easing, in seconds. */
const ZOOM_TAU = 0.14;

const HEIGHT_OVER_TARGET = 1.1;
const MIN_PITCH = 0.5;
const MAX_PITCH = 1.05;
const DEFAULT_PITCH = 0.72;
/** Pitch added at full zoom-out, blended in with log distance, and its ceiling. */
const OVERVIEW_PITCH_BIAS = 0.28;
const OVERVIEW_MAX_PITCH = 1.3;
/** Metres of clearance kept between the camera and the ground below it. */
const GROUND_CLEARANCE = 1.6;

export interface FollowCamera {
  /** Orbit angle about Y, which movement is expressed relative to. */
  readonly yaw: number;
  /** Current distance from the focus point, in metres, after easing. */
  readonly distance: number;
  /**
   * `zoom` is a change in the log of the distance, as `InputState.zoom`
   * reports it: positive pulls back.
   */
  update(target: THREE.Vector3, lookX: number, lookY: number, dt: number, zoom?: number): void;
  /** Step to the next zoom stop outwards, wrapping back in from the furthest. */
  cycleZoom(): void;
}

export function createFollowCamera(
  camera: THREE.PerspectiveCamera,
  dem: Float32Array,
  spec: GridSpec,
  initialYaw = 0,
): FollowCamera {
  let yaw = initialYaw;
  let pitch = DEFAULT_PITCH;
  let distance = DEFAULT_CAMERA_DISTANCE;
  let targetDistance = DEFAULT_CAMERA_DISTANCE;

  const focus = new THREE.Vector3();
  const wanted = new THREE.Vector3();
  let initialised = false;

  const logSpan = Math.log(MAX_DISTANCE / DEFAULT_CAMERA_DISTANCE);

  return {
    get yaw() {
      return yaw;
    },

    get distance() {
      return distance;
    },

    cycleZoom() {
      const next = ZOOM_STOPS.find((stop) => stop > targetDistance * 1.05);
      targetDistance = next ?? ZOOM_STOPS[0];
    },

    update(target, lookX, lookY, dt, zoom = 0) {
      yaw += lookX;
      pitch = THREE.MathUtils.clamp(pitch + lookY, MIN_PITCH, MAX_PITCH);

      targetDistance = THREE.MathUtils.clamp(targetDistance * Math.exp(zoom), MIN_DISTANCE, MAX_DISTANCE);
      // Eased in log space, so a zoom from 24 m to 190 m takes as long to
      // settle as one from 11 m to 24 m.
      const ease = initialised ? 1 - Math.exp(-dt / ZOOM_TAU) : 1;
      distance = Math.exp(Math.log(distance) + (Math.log(targetDistance) - Math.log(distance)) * ease);

      const overview = THREE.MathUtils.clamp(Math.log(distance / DEFAULT_CAMERA_DISTANCE) / logSpan, 0, 1);
      const viewPitch = Math.min(pitch + overview * OVERVIEW_PITCH_BIAS, OVERVIEW_MAX_PITCH);

      // The focus tracks the player exactly and only the camera's position is
      // eased (below), so the character stays centred while the frame still
      // breathes behind it.
      focus.set(target.x, target.y + HEIGHT_OVER_TARGET, target.z);

      const horizontal = Math.cos(viewPitch) * distance;
      wanted.set(
        focus.x - Math.sin(yaw) * horizontal,
        focus.y + Math.sin(viewPitch) * distance,
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
