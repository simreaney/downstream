/**
 * Assembles the visible world from a generated catchment.
 *
 * One place that knows how the render layer is put together, so `main.ts` stays
 * a boot sequence and the pieces below stay independent of each other. Nothing
 * here reaches back into the simulation; it consumes the arrays the worker
 * hands over and nothing else.
 */

import * as THREE from "three";
import { GRID } from "../config";
import type { GridSpec } from "../core/grid";
import type { Obstacle } from "../player/controller";
import { createCharacter, type Character } from "../props/character";
import { getProp } from "../props/registry";
import { createPropContext, type PropContext } from "../props/types";
import type { GeneratedWorld } from "../worker/client";
import { createCurvatureUniforms, type CurvatureUniforms } from "./curvature";
import { createLighting, type Lighting } from "./lighting";
import { createSky, type Sky } from "./sky";
import {
  createLandCoverTexture,
  createOverlayTexture,
  createTerrainMaterial,
  type TerrainMaterial,
} from "./terrainMaterial";
import { createFloodPlane, type FloodPlane } from "./floodPlane";
import { createPondSurfaces, type PondSurfaces } from "./pondMesh";
import { createRiverMesh, type RiverMesh } from "./riverMesh";
import { createInstancedBatch, type InstancedBatch } from "./instancing";
import { scatterVegetation, type Scatter } from "./scatter";
import { createWaterMaterial, type WaterMaterial } from "./waterMaterial";
import { cellToWorld, createTerrainMesh, type TerrainMesh } from "./terrainMesh";
import { createToonRamp } from "./toonRamp";

export interface WorldScene {
  readonly spec: GridSpec;
  readonly terrain: TerrainMesh;
  readonly terrainMaterial: TerrainMaterial;
  readonly overlayTexture: THREE.DataTexture;
  readonly landCoverTexture: THREE.DataTexture;
  readonly lighting: Lighting;
  readonly sky: Sky;
  readonly curvature: CurvatureUniforms;
  readonly props: PropContext;
  readonly scatter: Scatter;
  readonly character: Character;
  readonly river: RiverMesh;
  readonly ponds: PondSurfaces;
  readonly water: WaterMaterial;
  readonly flood: FloodPlane;
  /** Shoal at the fishery; its count is the clearest signal of recovery. */
  readonly fish: InstancedBatch;
  /** The layers placement validation reads, kept on the main thread. */
  readonly arrays: GeneratedWorld["arrays"];
  /** Solid footprints the player cannot walk through. */
  readonly obstacles: readonly Obstacle[];
  /**
   * Elevation as *drawn*, which diverges from the model's DEM once ponds are
   * dug. Excavating a bowl is a visual change only: ponds deliberately stay out
   * of the routing DEM, so the two must be separate arrays or digging would
   * silently re-route the catchment.
   */
  readonly renderDem: Float32Array;
  /** Build a leaky dam at a world position and add it to the scene. */
  damFactory(position: THREE.Vector3): THREE.Object3D;
  readonly pickups: Record<"wood" | "stone" | "spade", InstancedBatch>;
  /** Upload a freshly packed overlay from the worker. */
  setOverlay(rgba: Uint8Array<ArrayBuffer>): void;
  dispose(): void;
}

export function buildWorldScene(
  scene: THREE.Scene,
  world: GeneratedWorld,
  spec: GridSpec = GRID,
): WorldScene {
  const curvature = createCurvatureUniforms();
  const gradientMap = createToonRamp();

  const landCoverTexture = createLandCoverTexture(world.arrays.landCover, spec);
  const overlayTexture = createOverlayTexture(world.overlay, spec);

  const terrainMaterial = createTerrainMaterial({
    landCover: landCoverTexture,
    overlay: overlayTexture,
    gradientMap,
    curvature,
    spec,
  });

  const renderDem = Float32Array.from(world.arrays.dem);
  const terrain = createTerrainMesh(renderDem, spec, terrainMaterial.material);
  scene.add(terrain.mesh);

  const lighting = createLighting(scene);
  const sky = createSky(scene);

  const props = createPropContext(curvature, gradientMap);
  const scatter = scatterVegetation(
    scene,
    props,
    world.arrays.dem,
    world.arrays.landCover,
    spec,
    world.seed,
  );

  const character = createCharacter(props);
  scene.add(character.root);

  const damAsset = getProp("dam", props);

  // Pickups are instanced so that a hundred of them cost two draw calls, and so
  // collecting one is a swap-with-last rather than a scene-graph removal.
  const pickups = {
    wood: createInstancedBatch(getProp("logPile", props), 200),
    stone: createInstancedBatch(getProp("rock", props), 200),
    spade: createInstancedBatch(getProp("spade", props), 4),
  };
  for (const batch of Object.values(pickups)) batch.addTo(scene);

  const water = createWaterMaterial(curvature, gradientMap);
  const river = createRiverMesh(
    world.reaches,
    world.arrays.dem,
    spec,
    // Widths are scaled against the outlet's contributing area, which is the
    // whole catchment by construction.
    spec.width * spec.height,
    water.material,
  );
  scene.add(river.mesh);

  const ponds = createPondSurfaces(water.material);
  scene.add(ponds.mesh);

  const flood = createFloodPlane(renderDem, spec, water.material);
  scene.add(flood.mesh);

  // Settlements. Placed once from the sites the worker chose out of the
  // hydrology, so the receptors sit where the model says they should.
  const settlements = new THREE.Group();
  scene.add(settlements);

  // A building is solid. Collected here rather than derived later because this
  // is the only place that knows where each one ended up, and a second pass
  // over `settlements` would have to re-derive a footprint from meshes that
  // have already been rotated into place.
  const obstacles: Obstacle[] = [];

  const place = (id: Parameters<typeof getProp>[0], cell: number, rotation: number): void => {
    const asset = getProp(id, props);
    const group = new THREE.Group();
    for (const piece of asset.parts) {
      const mesh = new THREE.Mesh(piece.geometry, piece.material);
      mesh.castShadow = piece.castShadow;
      mesh.receiveShadow = piece.receiveShadow;
      group.add(mesh);
    }
    cellToWorld(spec, cell, group.position);
    group.position.y = world.arrays.dem[cell];
    group.rotation.y = rotation;
    settlements.add(group);

    // The prop's own radius is its half-width, which for a gabled box is the
    // short way across. A circle on that radius would let the player walk
    // through the corners of a cottage, so the footprint is grown to cover the
    // longer axis — a little generous at the corners, which reads as not quite
    // being able to scrape the wall rather than as a bug.
    obstacles.push({ x: group.position.x, z: group.position.z, radius: asset.radius * 1.35 });
  };

  world.sites.cottageCells.forEach((cell, index) => {
    place(index % 2 === 0 ? "cottageA" : "cottageB", cell, (index * 1.13) % (Math.PI * 2));
  });
  place("fisheryHut", world.sites.fisheryCell, Math.PI * 0.25);

  // Fish sit just under the surface of the pool by the fishery. The batch is
  // sized for the maximum shoal and its visible count is driven by clarity.
  const fishBatch = createInstancedBatch(getProp("fish", props), 64);
  fishBatch.addTo(scene);

  const pool = world.sites.poolCells;
  const fishAnchor = new THREE.Vector3();
  for (let i = 0; i < 64 && pool.length > 0; i++) {
    cellToWorld(spec, pool[i % pool.length], fishAnchor);
    fishAnchor.y = world.arrays.dem[pool[i % pool.length]] - 0.18;
    fishBatch.add(fishAnchor, (i * 2.399) % (Math.PI * 2), 0.85);
  }
  // Hidden until the water is clear enough for anything to live in it.
  fishBatch.setVisibleCount(0);

  // Fog matched to the sky's horizon colour, starting beyond the far divide so
  // it softens the very edge of the catchment without hazing the playfield.
  const extent = spec.width * spec.cellSize;
  scene.fog = new THREE.Fog(0xcfe9f5, extent * 0.55, extent * 1.15);
  sky.setStorminess(0);

  return {
    spec,
    terrain,
    terrainMaterial,
    overlayTexture,
    landCoverTexture,
    lighting,
    sky,
    curvature,
    props,
    scatter,
    character,
    river,
    ponds,
    water,
    flood,
    fish: fishBatch,
    arrays: world.arrays,
    obstacles,
    renderDem,
    pickups,

    damFactory(position) {
      const group = new THREE.Group();
      for (const damPart of damAsset.parts) {
        const mesh = new THREE.Mesh(damPart.geometry, damPart.material);
        mesh.castShadow = damPart.castShadow;
        mesh.receiveShadow = damPart.receiveShadow;
        group.add(mesh);
      }
      group.position.copy(position);
      group.rotation.y = Math.PI * 0.5;
      scene.add(group);
      return group;
    },

    setOverlay(rgba) {
      // The DataTexture wraps the worker's buffer directly, so replacing the
      // view and flagging it is the whole upload — no per-cell copy.
      overlayTexture.image.data = rgba;
      overlayTexture.needsUpdate = true;
    },

    dispose() {
      river.dispose();
      flood.dispose();
      fishBatch.dispose();
      settlements.removeFromParent();
      ponds.dispose();
      water.material.dispose();
      scatter.dispose();
      for (const batch of Object.values(pickups)) batch.dispose();
      scene.remove(character.root);
      scene.remove(terrain.mesh);
      terrain.geometry.dispose();
      terrainMaterial.material.dispose();
      landCoverTexture.dispose();
      overlayTexture.dispose();
      gradientMap.dispose();
    },
  };
}
