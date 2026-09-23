/**
 * Pond surfaces.
 *
 * One disc per pond, sharing the water material with the river so a pond and the
 * stream below it are visibly the same substance. The surface sits at the rim
 * of the dug bowl; the storm model tracks how full each pond gets, but the disc
 * does not yet rise and fall with it.
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
  dispose(): void;
}

export function createPondSurfaces(material: THREE.Material, capacity = 200): PondSurfaces {
  // A unit disc lying in the ground plane, scaled per instance.
  const geometry = new THREE.CircleGeometry(1, RIM_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  // Hidden while empty, as in instancing.ts: an empty InstancedMesh still costs
  // a program bind and a draw, and ponds are empty for most of a game.
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;

  // The shared water material declares four per-vertex attributes, so the disc
  // has to supply all of them or the shader reads undefined memory. Ponds carry
  // no reach risk of their own — their turbidity comes from the global uniform,
  // driven by the fishery's clarity — so risk is zero.
  const position = geometry.getAttribute("position");
  geometry.setAttribute(
    "aReachRisk",
    new THREE.Float32BufferAttribute(new Float32Array(position.count), 1),
  );

  // Still water: no travel coordinate, so no flow streaks, and no velocity, so
  // the ripples only drift.
  geometry.setAttribute(
    "aTravel",
    new THREE.Float32BufferAttribute(new Float32Array(position.count).fill(-1), 1),
  );
  geometry.setAttribute(
    "aDir",
    new THREE.Float32BufferAttribute(new Float32Array(position.count * 2), 2),
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

  const at = new THREE.Vector3();
  const write = (slot: number, y: number): void => {
    const centre = centres[slot];
    scale.set(radii[slot], 1, radii[slot]);
    matrix.compose(at.set(centre.x, y, centre.z), identity, scale);
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
      mesh.visible = true;
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
      mesh.visible = count > 0;
    },


    dispose() {
      mesh.removeFromParent();
      mesh.dispose();
      geometry.dispose();
    },
  };
}
