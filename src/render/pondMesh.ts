/**
 * Pond surfaces.
 *
 * One disc per pond, sharing the water material with the river so a pond and the
 * stream below it are visibly the same substance. The surface height is driven
 * during storms by how full the pond is, which is the only way the player sees
 * an attenuation pond doing its job — it fills as the storm peaks and drains
 * over the following day.
 *
 * Discs are pooled into a single instanced batch: ponds are added and removed
 * constantly as the player builds and undoes, and a mesh per pond would mean a
 * draw call per pond and an allocation per placement.
 */

import * as THREE from "three";

/** Segments around a pond's rim. Enough to read as round, few enough to stay chunky. */
const RIM_SEGMENTS = 14;

export interface PondSurfaces {
  readonly mesh: THREE.InstancedMesh;
  /** Add a pond, returning its handle. Radius and level are in metres. */
  add(centre: THREE.Vector3, radius: number): number;
  remove(handle: number): void;
  /** Set how full a pond is, 0 empty to 1 brim-full. */
  setLevel(handle: number, fill: number, depth: number): void;
  dispose(): void;
}

export function createPondSurfaces(material: THREE.Material, capacity = 200): PondSurfaces {
  // A unit disc lying in the ground plane, scaled per instance.
  const geometry = new THREE.CircleGeometry(1, RIM_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;

  // The shared water material declares three per-vertex attributes, so the disc
  // has to supply all of them or the shader reads undefined memory. Ponds carry
  // no reach risk of their own — their turbidity comes from the global uniform,
  // driven by the fishery's clarity — so risk and flow are zero.
  const position = geometry.getAttribute("position");
  geometry.setAttribute(
    "aReachRisk",
    new THREE.Float32BufferAttribute(new Float32Array(position.count), 1),
  );
  geometry.setAttribute(
    "aFlow",
    new THREE.Float32BufferAttribute(new Float32Array(position.count), 1),
  );

  // Bank runs 0 at the centre to 1 at the rim, so a pond gets the same depth
  // shading and foam edge as the river without any special-casing in the shader.
  const bank = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    bank[i] = Math.hypot(position.getX(i), position.getZ(i));
  }
  geometry.setAttribute("aBank", new THREE.Float32BufferAttribute(bank, 1));

  const slotOfHandle = new Map<number, number>();
  const handleOfSlot: number[] = [];
  const centres: THREE.Vector3[] = [];
  const radii: number[] = [];
  let nextHandle = 1;
  let count = 0;

  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const identity = new THREE.Quaternion();

  const write = (slot: number, y: number): void => {
    const centre = centres[slot];
    scale.set(radii[slot], 1, radii[slot]);
    matrix.compose(new THREE.Vector3(centre.x, y, centre.z), identity, scale);
    mesh.setMatrixAt(slot, matrix);
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    mesh,

    add(centre, radius) {
      if (count >= capacity) throw new RangeError(`Pond capacity ${capacity} exceeded`);
      const slot = count++;
      const handle = nextHandle++;

      slotOfHandle.set(handle, slot);
      handleOfSlot[slot] = handle;
      centres[slot] = centre.clone();
      radii[slot] = radius;

      write(slot, centre.y);
      mesh.count = count;
      return handle;
    },

    remove(handle) {
      const slot = slotOfHandle.get(handle);
      if (slot === undefined) return;

      const lastSlot = count - 1;
      if (slot !== lastSlot) {
        centres[slot] = centres[lastSlot];
        radii[slot] = radii[lastSlot];
        const movedHandle = handleOfSlot[lastSlot];
        slotOfHandle.set(movedHandle, slot);
        handleOfSlot[slot] = movedHandle;
        mesh.getMatrixAt(lastSlot, matrix);
        mesh.setMatrixAt(slot, matrix);
        mesh.instanceMatrix.needsUpdate = true;
      }

      slotOfHandle.delete(handle);
      count = lastSlot;
      mesh.count = count;
    },

    setLevel(handle, fill, depth) {
      const slot = slotOfHandle.get(handle);
      if (slot === undefined) return;
      // The surface rises from the bottom of the bowl to its rim as it fills.
      write(slot, centres[slot].y - depth * (1 - Math.min(1, Math.max(0, fill))));
    },

    dispose() {
      mesh.removeFromParent();
      mesh.dispose();
      geometry.dispose();
    },
  };
}
