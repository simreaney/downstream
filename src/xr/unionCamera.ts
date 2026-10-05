/**
 * The camera three culls with in a headset, corrected for a scaled rig.
 *
 * Each frame three builds one camera that encloses both eyes and culls the
 * scene against it (`setProjectionFromUnion` in its WebXRManager). It measures
 * the distance between the eyes in world space and then treats that distance as
 * view-space metres. Under the diorama's rig the world-space distance is S times
 * the real one, so the combined camera is set S times too far behind the eyes
 * and its near plane S times too far in front of them: with the whole catchment
 * on the table, about ten kilometres out. Everything three is allowed to cull
 * disappears.
 *
 * Nearly every mesh in the game has culling switched off already, for the
 * curved world, which is why this did not show at once. It showed as a missing
 * plinth, missing controller markers and — worst — a character who vanished
 * as soon as the player zoomed out a little.
 *
 * So `mode.ts` stops three updating the XR camera on its own, updates it
 * itself, and then rebuilds the combined camera here in rig space, where a
 * metre is a metre. The construction is three's own; only the frame it is done
 * in differs. With an unscaled rig the two agree.
 */

import * as THREE from "three";

const unionLocal = new THREE.Matrix4();
const shift = new THREE.Matrix4();
const leftEye = new THREE.Vector3();
const rightEye = new THREE.Vector3();

/**
 * Rebuild `xrCamera`'s world matrix and projection to enclose both eyes.
 *
 * Call after three's `WebXRManager.updateCamera`, which leaves each eye's
 * `matrix` (rig space) and `projectionMatrix` current. No-op for a single view.
 */
export function correctUnionCamera(xrCamera: THREE.ArrayCamera, rig: THREE.Object3D): void {
  const [left, right] = xrCamera.cameras;
  if (!left || !right) return;

  // The one change from three: measured between the eyes in rig space.
  leftEye.setFromMatrixPosition(left.matrix);
  rightEye.setFromMatrixPosition(right.matrix);
  const ipd = leftEye.distanceTo(rightEye);

  // As three does: both eyes share near and far, and the left eye's top and
  // bottom extents.
  const projL = left.projectionMatrix.elements;
  const projR = right.projectionMatrix.elements;
  const near = projL[14] / (projL[10] - 1);
  const far = projL[14] / (projL[10] + 1);
  const topFov = (projL[9] + 1) / projL[5];
  const bottomFov = (projL[9] - 1) / projL[5];
  const leftFov = (projL[8] - 1) / projL[0];
  const rightFov = (projR[8] + 1) / projR[0];

  // Back from the left eye and across towards the right, far enough that one
  // frustum encloses both.
  const zOffset = ipd / (-leftFov + rightFov);
  const xOffset = zOffset * -leftFov;

  unionLocal.copy(left.matrix).multiply(shift.makeTranslation(xOffset, 0, zOffset));
  xrCamera.matrixWorld.multiplyMatrices(rig.matrixWorld, unionLocal);
  xrCamera.matrixWorldInverse.copy(xrCamera.matrixWorld).invert();

  if (projL[10] === -1) {
    // An infinite far plane: the left eye's projection, from the shifted
    // origin, already encloses both.
    xrCamera.projectionMatrix.copy(left.projectionMatrix);
  } else {
    const near2 = near + zOffset;
    const far2 = far + zOffset;
    xrCamera.projectionMatrix.makePerspective(
      near * leftFov - xOffset,
      near * rightFov + (ipd - xOffset),
      ((topFov * far) / far2) * near2,
      ((bottomFov * far) / far2) * near2,
      near2,
      far2,
    );
  }
  xrCamera.projectionMatrixInverse.copy(xrCamera.projectionMatrix).invert();
}
