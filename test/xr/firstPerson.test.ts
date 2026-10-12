/**
 * The first-person rig.
 *
 * As with the tabletop, none of this can be seen without a headset, and a
 * wrong sign still renders something: eyes a metre behind the character, a
 * snap turn that swings the player round a point in the next field, or a
 * forward that walks backwards. Each test pins one of those.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GridSpec } from "../../src/core/grid";
import { createPlayer } from "../../src/player/controller";
import { SNAP_TURN_RAD } from "../../src/xr/diorama";
import { createFirstPerson, EYE_HEIGHT_M } from "../../src/xr/firstPerson";

const SPEC: GridSpec = { width: 64, height: 64, cellSize: 4 };
const FLAT = new Float32Array(SPEC.width * SPEC.height);
/** A standing player, a little off the middle of their play space. */
const HEAD = new THREE.Vector3(0.3, 1.7, -0.2);
const DT = 1 / 72;

function rigFor() {
  const rig = new THREE.Group();
  const view = createFirstPerson({ rig });
  return { rig, view };
}

function toWorld(rig: THREE.Object3D, local: THREE.Vector3): THREE.Vector3 {
  return rig.localToWorld(local.clone());
}

describe("createFirstPerson", () => {
  it("puts the player's eyes at the character's, at life size", () => {
    const { rig, view } = rigFor();
    view.reset(0.8);
    const feet = new THREE.Vector3(20, 3, -14);
    view.update(feet, HEAD, DT, 0);

    const eye = toWorld(rig, HEAD);
    expect(eye.x).toBeCloseTo(feet.x, 6);
    expect(eye.z).toBeCloseTo(feet.z, 6);
    expect(eye.y).toBeCloseTo(feet.y + EYE_HEIGHT_M, 6);
    expect(view.scale).toBe(1);
  });

  it("sets the same eye height for a seated player", () => {
    const { rig, view } = rigFor();
    view.reset(0);
    const seated = new THREE.Vector3(0, 1.1, 0);
    const feet = new THREE.Vector3(0, 5, 0);
    view.update(feet, seated, DT, 0);
    expect(toWorld(rig, seated).y).toBeCloseTo(feet.y + EYE_HEIGHT_M, 6);
  });

  it("leaves the head free to move from where it started", () => {
    const { rig, view } = rigFor();
    view.reset(0);
    const feet = new THREE.Vector3(10, 0, 10);
    view.update(feet, HEAD, DT, 0);

    // Crouching and leaning to one side after the session has started.
    const moved = HEAD.clone().add(new THREE.Vector3(0.2, -0.4, 0));
    view.update(feet, moved, DT, 0);
    const before = toWorld(rig, HEAD);
    const after = toWorld(rig, moved);
    expect(after.distanceTo(before)).toBeCloseTo(Math.hypot(0.2, 0.4), 6);
  });

  it("turns about the character", () => {
    const { rig, view } = rigFor();
    view.reset(0);
    const feet = new THREE.Vector3(-30, 2, 40);
    view.update(feet, HEAD, DT, 0);
    const before = rig.quaternion.clone();

    view.turn(1);
    view.update(feet, HEAD, DT, 0);

    expect(rig.quaternion.angleTo(before)).toBeCloseTo(SNAP_TURN_RAD, 6);
    const eye = toWorld(rig, HEAD);
    expect(eye.x).toBeCloseTo(feet.x, 6);
    expect(eye.z).toBeCloseTo(feet.z, 6);
  });

  it("eases the eyes over a step in the ground rather than jolting", () => {
    const { rig, view } = rigFor();
    view.reset(0);
    view.update(new THREE.Vector3(0, 0, 0), HEAD, DT, 0);
    view.update(new THREE.Vector3(0, 1, 0), HEAD, DT, 0);
    const risen = toWorld(rig, HEAD).y - EYE_HEIGHT_M;
    expect(risen).toBeGreaterThan(0);
    expect(risen).toBeLessThan(0.5);

    for (let frame = 0; frame < 200; frame++) view.update(new THREE.Vector3(0, 1, 0), HEAD, DT, 0);
    expect(toWorld(rig, HEAD).y).toBeCloseTo(1 + EYE_HEIGHT_M, 4);
  });

  it("walks the character the way the player is looking", () => {
    const { rig, view } = rigFor();
    view.reset(1.1);
    view.turn(-2);
    view.update(new THREE.Vector3(), HEAD, DT, 0);

    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.7, 0, "YXZ"));
    const heading = view.heading(look);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(look).applyQuaternion(rig.quaternion);
    forward.y = 0;
    forward.normalize();

    const player = createPlayer(FLAT, SPEC, new THREE.Vector3());
    const state = { moveX: 0, moveZ: -1, lookX: 0, lookY: 0, sprint: false, zoom: 0 };
    for (let frame = 0; frame < 30; frame++) player.update(state, heading, DT);
    const walked = player.position.clone().setY(0).normalize();

    expect(walked.dot(forward)).toBeGreaterThan(0.999);
  });

  it("opens facing where the page's camera was", () => {
    const { view } = rigFor();
    view.reset(2.4);
    expect(view.heading(new THREE.Quaternion())).toBeCloseTo(2.4, 10);
  });

  it("stands the dashboard in front of and below the starting eyes", () => {
    const { view } = rigFor();
    view.reset(0);
    expect(view.placed).toBe(false);
    view.update(new THREE.Vector3(), HEAD, DT, 0);
    expect(view.placed).toBe(true);
    expect(view.anchor.y).toBeLessThan(HEAD.y);
    expect(view.anchor.z).toBeLessThan(HEAD.z);
  });
});
