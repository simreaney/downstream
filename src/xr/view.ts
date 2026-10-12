/**
 * What a headset view has to provide, so `mode.ts` can run either.
 *
 * Two views share the one camera rig: the tabletop diorama (`diorama.ts`),
 * where the world is scaled down onto a table, and first person
 * (`firstPerson.ts`), where it is life-size and the player's eyes are the
 * character's. The player picks one on the page before entering VR.
 */

import type * as THREE from "three";

export type XrViewKind = "tabletop" | "firstPerson";

export interface XrView {
  /** World metres per real metre, after easing. */
  readonly scale: number;
  /** 0 at the default zoom and closer, 1 with the whole catchment on the table. */
  readonly overview: number;
  /**
   * World-space distance from the eyes to what they are looking at: what the
   * desktop follow camera calls its distance, for sizing the shadowed region.
   */
  readonly viewDistance: number;
  /** Where the dashboard is stood from, in rig space (real metres), once a head pose has fixed it. */
  readonly anchor: THREE.Vector3;
  /** Whether `anchor` has been fixed from a head pose yet. */
  readonly placed: boolean;
  /**
   * Movement heading for the player controller, in the follow camera's
   * convention: forward is (sin h, 0, cos h) in world space. Taken from the
   * head's yaw, so pushing the stick forward walks the way the player looks.
   */
  heading(headQuaternion: THREE.Quaternion): number;
  /** Turn by whole snaps. Positive turns the view left, as the gamepad's orbit does. */
  turn(steps: number): void;
  /** Step to the next zoom stop, where the view has any. */
  cycleZoom(): void;
  /**
   * Start afresh, for a new session: forget the head pose, snap rather than
   * ease on the next update, and face along `heading` (same convention as
   * `heading()`), so the headset opens looking where the screen was.
   */
  reset(heading: number): void;
  /**
   * Place the rig for this frame.
   *
   * `target` is the character's feet. `head` is the headset's position in rig
   * space — the XR reference space, in real metres. `zoom` is a change in the
   * log of the scale, as `InputState.zoom` reports it: positive pulls back.
   */
  update(target: THREE.Vector3, head: THREE.Vector3, dt: number, zoom: number): void;
}
