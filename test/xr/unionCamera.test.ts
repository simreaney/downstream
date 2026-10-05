/**
 * The culling camera under a scaled rig.
 *
 * three culls a headset's view against one camera built to enclose both eyes.
 * The property that matters is exactly that: whatever either eye can see, the
 * combined camera must contain — at the default zoom, and with the whole
 * catchment on the table, where three's own construction put the near plane
 * kilometres out and culled the character.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { correctUnionCamera } from "../../src/xr/unionCamera";

/** Half the distance between the eyes, in metres. */
const HALF_IPD = 0.032;

/** A Quest-like eye: tilted down, with the wider half of its view towards the outside. */
function eye(side: -1 | 1, near: number, far: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera();
  const outer = Math.tan(0.95) * near;
  const inner = Math.tan(0.75) * near;
  camera.projectionMatrix.makePerspective(
    side < 0 ? -outer : -inner,
    side < 0 ? inner : outer,
    Math.tan(0.85) * near,
    -Math.tan(0.95) * near,
    near,
    far,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  return camera;
}

function headset(scale: number) {
  const rig = new THREE.Group();
  rig.position.set(120, 400, -80);
  rig.rotation.y = 0.6;
  rig.scale.setScalar(scale);
  rig.updateMatrixWorld(true);

  const head = new THREE.Matrix4().compose(
    new THREE.Vector3(0.1, 1.6, 0.05),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0.3, 0, "YXZ")),
    new THREE.Vector3(1, 1, 1),
  );

  const xrCamera = new THREE.ArrayCamera();
  for (const side of [-1, 1] as const) {
    const camera = eye(side, 0.05, 1000);
    // What three's updateCamera leaves: pose in rig space, and in the world.
    camera.matrix.copy(head).multiply(new THREE.Matrix4().makeTranslation(side * HALF_IPD, 0, 0));
    camera.matrixWorld.multiplyMatrices(rig.matrixWorld, camera.matrix);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    xrCamera.cameras.push(camera);
  }
  return { rig, xrCamera };
}

function frustumOf(camera: THREE.Camera): THREE.Frustum {
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

/** World points spread through an eye's view, from just past the near plane to a few metres out. */
function samplesSeenBy(camera: THREE.Camera): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const toWorld = new THREE.Matrix4().multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
  for (const x of [-0.95, 0, 0.95]) {
    for (const y of [-0.95, 0, 0.95]) {
      // NDC depth for points from 6 cm to a few metres out.
      for (const z of [-0.7, 0, 0.9, 0.99]) points.push(new THREE.Vector3(x, y, z).applyMatrix4(toWorld));
    }
  }
  return points;
}

describe("correctUnionCamera", () => {
  for (const scale of [1, 18, 683]) {
    it(`encloses everything either eye sees, at a scale of ${scale}`, () => {
      const { rig, xrCamera } = headset(scale);
      correctUnionCamera(xrCamera, rig);
      const union = frustumOf(xrCamera);
      for (const camera of xrCamera.cameras) {
        for (const point of samplesSeenBy(camera)) expect(union.containsPoint(point)).toBe(true);
      }
    });
  }

  it("keeps the near plane by the eyes however far the world is scaled", () => {
    const { rig, xrCamera } = headset(683);
    correctUnionCamera(xrCamera, rig);
    // A figure 70 cm in front of the eyes, which is where the character stands.
    const ahead = new THREE.Vector3(0, 0, -0.7).applyMatrix4(xrCamera.cameras[0].matrixWorld);
    expect(frustumOf(xrCamera).containsPoint(ahead)).toBe(true);
  });
});
