/**
 * The tabletop rig.
 *
 * None of this can be seen without a headset, and every way of getting it
 * wrong still renders *something*: a sign error puts the table behind the
 * player, a rotation about the wrong point swings the character out of view on
 * every snap turn, and a heading off by a half turn walks the character
 * towards the player when they push forward. So the geometry is pinned here,
 * against the one property each piece exists for.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GridSpec } from "../../src/core/grid";
import { cellToWorld } from "../../src/render/terrainMesh";
import { createPlayer } from "../../src/player/controller";
import { createDiorama, DEFAULT_XR_SCALE, SNAP_TURN_RAD } from "../../src/xr/diorama";

const SPEC: GridSpec = { width: 64, height: 64, cellSize: 4 };
const FLAT = new Float32Array(SPEC.width * SPEC.height);
/** A standing player, looking straight ahead. */
const HEAD = new THREE.Vector3(0, 1.6, 0);
const DT = 1 / 72;

function rigFor(dem: Float32Array = FLAT, centreElevation = 0) {
  const rig = new THREE.Group();
  const diorama = createDiorama({ rig, dem, spec: SPEC, centreElevation });
  return { rig, diorama };
}

/** Where a rig-space point ends up in the world. */
function toWorld(rig: THREE.Object3D, local: THREE.Vector3): THREE.Vector3 {
  return rig.localToWorld(local.clone());
}

function settle(diorama: ReturnType<typeof rigFor>["diorama"], target: THREE.Vector3, zoom = 0): void {
  for (let frame = 0; frame < 400; frame++) diorama.update(target, HEAD, DT, frame === 0 ? zoom : 0);
}

describe("createDiorama", () => {
  it("stands the character on a table in front of the player, below their eyes", () => {
    const { rig, diorama } = rigFor();
    diorama.reset(0);
    const feet = new THREE.Vector3(20, 3, -14);
    diorama.update(feet, HEAD, DT, 0);

    const table = diorama.anchor;
    expect(toWorld(rig, table).distanceTo(feet)).toBeLessThan(1e-6);
    expect(table.z).toBeLessThan(0); // in front: the headset looks down -z
    expect(table.y).toBeLessThan(HEAD.y);
    expect(table.y).toBeGreaterThan(0.3);
    expect(diorama.scale).toBeCloseTo(DEFAULT_XR_SCALE, 6);
  });

  it("scales the world down by the rig's scale", () => {
    const { rig, diorama } = rigFor();
    diorama.reset(0);
    diorama.update(new THREE.Vector3(), HEAD, DT, 0);
    // A real metre between two rig-space points is S world metres apart.
    const a = toWorld(rig, new THREE.Vector3(0, 1, -0.5));
    const b = toWorld(rig, new THREE.Vector3(1, 1, -0.5));
    expect(a.distanceTo(b)).toBeCloseTo(DEFAULT_XR_SCALE, 6);
  });

  it("turns the table about the character, not about the player", () => {
    const { rig, diorama } = rigFor();
    diorama.reset(0);
    const feet = new THREE.Vector3(-30, 2, 40);
    diorama.update(feet, HEAD, DT, 0);
    const yawBefore = diorama.yaw;

    diorama.turn(1);
    diorama.update(feet, HEAD, DT, 0);

    expect(diorama.yaw - yawBefore).toBeCloseTo(SNAP_TURN_RAD, 10);
    expect(toWorld(rig, diorama.anchor).distanceTo(feet)).toBeLessThan(1e-6);
  });

  it("walks the character the way the player is looking", () => {
    const { rig, diorama } = rigFor();
    diorama.reset(1.1);
    diorama.turn(-2);
    diorama.update(new THREE.Vector3(), HEAD, DT, 0);

    // Head turned 40 degrees left and pitched 50 degrees down at the table.
    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.87, 0.7, 0, "YXZ"));
    const heading = diorama.heading(look);

    // Where that head actually faces in the world, flattened.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(look).applyQuaternion(rig.quaternion);
    forward.y = 0;
    forward.normalize();

    // The player controller's own reading of "forward" at that heading.
    const player = createPlayer(FLAT, SPEC, new THREE.Vector3());
    const state = { moveX: 0, moveZ: -1, lookX: 0, lookY: 0, sprint: false, zoom: 0 };
    for (let frame = 0; frame < 30; frame++) player.update(state, heading, DT);
    const walked = player.position.clone().setY(0).normalize();

    expect(walked.dot(forward)).toBeGreaterThan(0.999);
  });

  it("opens facing where the page's camera was", () => {
    const { diorama } = rigFor();
    diorama.reset(2.4);
    expect(diorama.heading(new THREE.Quaternion())).toBeCloseTo(2.4, 10);
  });

  it("zooms out to the whole catchment centred on the table", () => {
    const { rig, diorama } = rigFor(FLAT, 7);
    diorama.reset(0);
    const feet = new THREE.Vector3(60, 0, -60);
    settle(diorama, feet, 50);

    expect(diorama.overview).toBeCloseTo(1, 6);
    const middle = toWorld(rig, diorama.anchor);
    expect(middle.x).toBeCloseTo(0, 3);
    expect(middle.z).toBeCloseTo(0, 3);
    expect(middle.y).toBeCloseTo(7, 3);
    // The catchment fits within arm's reach either side of the table's middle.
    const extent = SPEC.width * SPEC.cellSize;
    expect(extent / diorama.scale).toBeLessThan(1.6);
  });

  it("steps through its zoom stops and back to the start", () => {
    const { diorama } = rigFor();
    diorama.reset(0);
    const feet = new THREE.Vector3();
    const seen: number[] = [];
    for (let step = 0; step < 3; step++) {
      diorama.cycleZoom();
      settle(diorama, feet);
      seen.push(diorama.scale);
    }
    expect(seen[0]).toBeGreaterThan(DEFAULT_XR_SCALE);
    expect(seen[1]).toBeGreaterThan(seen[0]);
    expect(seen[2]).toBeCloseTo(DEFAULT_XR_SCALE, 3);
  });

  it("sinks the world rather than put the player's eyes inside a hill", () => {
    // A 45-degree ramp rising towards +z, which is behind the player at this
    // heading: the slope climbs past their eyes.
    const ramp = new Float32Array(SPEC.width * SPEC.height);
    const at = new THREE.Vector3();
    for (let cell = 0; cell < ramp.length; cell++) ramp[cell] = Math.max(0, cellToWorld(SPEC, cell, at).z);
    const { rig, diorama } = rigFor(ramp);
    diorama.reset(Math.PI);
    diorama.update(new THREE.Vector3(0, 0, 0), HEAD, DT, 0);

    const eye = toWorld(rig, HEAD);
    const groundUnderEye = Math.max(0, eye.z);
    expect(eye.y).toBeGreaterThanOrEqual(groundUnderEye + 0.15 * diorama.scale - 1e-6);
  });
});
