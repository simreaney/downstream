/**
 * The catchment at life size, seen through the character's eyes.
 *
 * The alternative to the tabletop (`diorama.ts`): the rig is not scaled, so a
 * world metre is a real one, and it is placed so that the player's eyes are
 * where the character's would be. The character itself is hidden — the camera
 * is inside its head — and the placement ghost a few steps ahead is what the
 * player watches instead.
 *
 * Comfort rests on the same rules as the tabletop's, applied to a view that
 * moves far more. The head is still tracked one to one: leaning, crouching and
 * looking around are the player's own, and only the stick moves the body.
 * Turning is still in snaps. The horizon never tilts, and the eyes ride the
 * terrain through a short ease rather than every bump in the heightfield, which
 * read as a jolt at walking pace.
 *
 * The eye height is the character's, not the player's: the rig is raised or
 * lowered once, from the head's height when the session starts, so a seated
 * player sees the valley from the same height as a standing one.
 */

import * as THREE from "three";
import { approach } from "../core/clamp";
import { DEFAULT_CAMERA_DISTANCE } from "../render/camera";
import { SNAP_TURN_RAD } from "./diorama";
import type { XrView } from "./view";

/** World metres from the character's feet to its eyes. */
export const EYE_HEIGHT_M = 1.45;

/**
 * Where the dashboard is stood from, relative to the eyes when the session
 * starts: about where a lectern would be for someone standing at it.
 */
const DASH_BELOW_EYES_M = 0.5;
const DASH_DISTANCE_M = 0.55;

/** Seconds for the eyes to follow the ground up or down under the character. */
const RIDE_TAU = 0.12;

export interface FirstPersonOptions {
  /** The camera's parent. Its transform is rewritten every update. */
  readonly rig: THREE.Object3D;
}

export function createFirstPerson(options: FirstPersonOptions): XrView {
  const { rig } = options;

  let yaw = 0;
  let ground = 0;
  let initialised = false;
  /** The head's rig-space position when the session started; null until a pose arrives. */
  let origin: THREE.Vector3 | null = null;

  const anchor = new THREE.Vector3(0, 0, -DASH_DISTANCE_M);
  const offset = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const euler = new THREE.Euler(0, 0, 0, "YXZ");

  return {
    scale: 1,
    overview: 0,
    // Shadows sized as on the desktop at its default distance: the near view
    // is what a player at ground level looks at.
    viewDistance: DEFAULT_CAMERA_DISTANCE,
    get anchor() {
      return anchor;
    },
    get placed() {
      return origin !== null;
    },

    heading(headQuaternion) {
      // As the tabletop: yaw alone, and the headset looks down its own -z.
      euler.setFromQuaternion(headQuaternion, "YXZ");
      return yaw + euler.y + Math.PI;
    },

    turn(steps) {
      yaw += steps * SNAP_TURN_RAD;
    },

    cycleZoom() {
      // Nothing to zoom: the player's own eyes are the camera.
    },

    reset(heading) {
      yaw = heading - Math.PI;
      origin = null;
      initialised = false;
    },

    update(target, head, dt) {
      if (origin === null) {
        origin = head.clone();
        anchor.set(origin.x, origin.y - DASH_BELOW_EYES_M, origin.z - DASH_DISTANCE_M);
      }
      ground = initialised ? approach(ground, target.y, RIDE_TAU, dt) : target.y;

      // Solve for the rig that puts the starting head pose at the character's
      // eyes. The head is free to move from there, as a real one is:
      //   eyes = position + R(yaw) · origin
      rig.quaternion.setFromAxisAngle(up, yaw);
      rig.scale.setScalar(1);
      offset.copy(origin).applyQuaternion(rig.quaternion);
      rig.position.set(target.x - offset.x, ground + EYE_HEIGHT_M - offset.y, target.z - offset.z);

      initialised = true;
      rig.updateMatrixWorld(true);
    },
  };
}
