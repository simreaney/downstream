/**
 * Instanced batches of a single prop.
 *
 * A catchment carries thousands of trees, and each one as its own mesh would be
 * thousands of draw calls and thousands of matrix uploads per frame. One
 * InstancedMesh per prop part turns that into one draw call per part — two for a
 * tree — regardless of how many the player plants.
 *
 * Removal is swap-with-last rather than leaving a hole, so the instance array
 * stays dense and `count` alone tells the GPU how much to draw. Handles are
 * stable across removals because the batch remaps them: felling a tree in the
 * middle of the array must not invalidate the handle of the one at the end.
 */

import * as THREE from "three";
import type { PropAsset } from "../props/types";

export interface InstancedBatch {
  /** Add an instance, returning a stable handle. */
  add(position: THREE.Vector3, rotationY: number, scale: number, tint?: THREE.Color): number;
  remove(handle: number): void;
  update(handle: number, position: THREE.Vector3, rotationY: number, scale: number): void;
  readonly count: number;
  readonly capacity: number;
  /**
   * Draw only the first `n` instances.
   *
   * For populations that grow and shrink continuously — the shoal at the
   * fishery — where adding and removing instances every frame would churn the
   * transforms for no visual gain.
   */
  setVisibleCount(n: number): void;
  addTo(scene: THREE.Object3D): void;
  dispose(): void;
}

export function createInstancedBatch(asset: PropAsset, capacity: number): InstancedBatch {
  const meshes = asset.parts.map((part) => {
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
    mesh.castShadow = part.castShadow;
    mesh.receiveShadow = part.receiveShadow;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    // The curvature shader displaces instances, so the computed bounds no longer
    // describe what is on screen; three would cull a batch that is visible.
    mesh.frustumCulled = false;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  });

  // handle -> slot, and slot -> handle, so a swap can fix up the moved entry.
  const slotOfHandle = new Map<number, number>();
  const handleOfSlot: number[] = [];
  let nextHandle = 1;
  let count = 0;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);
  const white = new THREE.Color(1, 1, 1);

  const writeSlot = (
    slot: number,
    position: THREE.Vector3,
    rotationY: number,
    scale: number,
    tint?: THREE.Color,
  ): void => {
    quaternion.setFromAxisAngle(axis, rotationY);
    scaleVector.setScalar(scale);
    matrix.compose(position, quaternion, scaleVector);

    for (const mesh of meshes) {
      mesh.setMatrixAt(slot, matrix);
      mesh.setColorAt(slot, tint ?? white);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };

  return {
    get count() {
      return count;
    },
    get capacity() {
      return capacity;
    },

    add(position, rotationY, scale, tint) {
      if (count >= capacity) throw new RangeError(`Instance batch full at ${capacity}`);

      const slot = count++;
      const handle = nextHandle++;
      slotOfHandle.set(handle, slot);
      handleOfSlot[slot] = handle;

      writeSlot(slot, position, rotationY, scale, tint);
      for (const mesh of meshes) mesh.count = count;
      return handle;
    },

    remove(handle) {
      const slot = slotOfHandle.get(handle);
      if (slot === undefined) return;

      const lastSlot = count - 1;
      if (slot !== lastSlot) {
        // Move the last instance into the freed slot and repoint its handle.
        const movedHandle = handleOfSlot[lastSlot];
        for (const mesh of meshes) {
          mesh.getMatrixAt(lastSlot, matrix);
          mesh.setMatrixAt(slot, matrix);
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) {
            const source = lastSlot * 3;
            const target = slot * 3;
            const array = mesh.instanceColor.array as Float32Array;
            array[target] = array[source];
            array[target + 1] = array[source + 1];
            array[target + 2] = array[source + 2];
            mesh.instanceColor.needsUpdate = true;
          }
        }
        slotOfHandle.set(movedHandle, slot);
        handleOfSlot[slot] = movedHandle;
      }

      slotOfHandle.delete(handle);
      count = lastSlot;
      for (const mesh of meshes) mesh.count = count;
    },

    update(handle, position, rotationY, scale) {
      const slot = slotOfHandle.get(handle);
      if (slot === undefined) return;
      writeSlot(slot, position, rotationY, scale);
    },

    setVisibleCount(visible) {
      const clamped = Math.max(0, Math.min(count, Math.floor(visible)));
      for (const mesh of meshes) mesh.count = clamped;
    },

    addTo(scene) {
      for (const mesh of meshes) scene.add(mesh);
    },

    dispose() {
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.dispose();
      }
    },
  };
}
