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
import { markSquare, type GridSpec } from "../core/grid";
import type { Obstacle } from "../player/controller";
import { createCharacter, type Character } from "../props/character";
import { getProp } from "../props/registry";
import { createPropContext, type PropAsset, type PropContext } from "../props/types";
import type { GeneratedWorld } from "../worker/client";
import { createCurvatureUniforms, type CurvatureUniforms } from "./curvature";
import { createLighting, type Lighting } from "./lighting";
import { createOcclusionFade } from "./occlusionFade";
import { createSky, type Sky } from "./sky";
import {
  createCoverPatternTexture,
  createLandCoverTexture,
  createOverlayTexture,
  createTerrainMaterial,
  type TerrainMaterial,
} from "./terrainMaterial";
import { bakeTerrainData } from "./terrainData";
import { createFloodPlane, type FloodPlane } from "./floodPlane";
import { createPondSurfaces, type PondSurfaces } from "./pondMesh";
import { carveRiverBed, createRiverMesh, layoutRiver, type RiverMesh } from "./riverMesh";
import { createInstancedBatch, type InstancedBatch } from "./instancing";
import { scatterVegetation, type Scatter } from "./scatter";
import { createWaterMaterial, type WaterMaterial } from "./waterMaterial";
import { cellToWorld, createTerrainMesh, sampleHeight, type TerrainMesh } from "./terrainMesh";
import { createToonRamp } from "./toonRamp";
import { createVillagePaths, planVillage } from "./village";

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
   * Elevation as *drawn*, which diverges from the model's DEM: river beds are
   * carved into it at load (see `riverMesh.ts`) and pond bowls as they are dug.
   * Both are visual changes only — the model routes on its own DEM, so the two
   * must be separate arrays or drawing a river bed would silently re-route the
   * catchment.
   */
  readonly renderDem: Float32Array;
  /**
   * The drawn ground before any pond was dug: the model's DEM with the river
   * beds carved in. What the player walks on, and what a filled-in pond is
   * restored to.
   */
  readonly groundDem: Float32Array;
  /**
   * Build a leaky dam at a world position and add it to the scene.
   *
   * `rotationY` orients the dam across the local channel — see
   * `buildController.ts`'s `damRotation`, which derives it from steepest
   * descent so the dam spans whichever way the watercourse actually runs
   * instead of a fixed compass direction.
   */
  damFactory(position: THREE.Vector3, rotationY: number): THREE.Object3D;
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
  const coverPatternTexture = createCoverPatternTexture(world.arrays.landCover, spec);
  const overlayTexture = createOverlayTexture(world.overlay, spec);
  const terrainData = bakeTerrainData(world.arrays.dem, world.arrays.accum, spec);

  const terrainMaterial = createTerrainMaterial({
    landCover: landCoverTexture,
    coverPattern: coverPatternTexture,
    overlay: overlayTexture,
    terrainData: terrainData.texture,
    gradientMap,
    curvature,
    spec,
  });

  // Rivers first: their beds are carved into the ground everything else then
  // stands on. Widths are scaled against the outlet's contributing area, which
  // is the whole catchment by construction.
  const outletAccum = spec.width * spec.height;
  const riverLayout = layoutRiver(world.reaches, world.arrays.dem, spec, outletAccum);
  const groundDem = Float32Array.from(world.arrays.dem);
  const riverFootprint = carveRiverBed(groundDem, spec, riverLayout);

  const renderDem = Float32Array.from(groundDem);
  const terrain = createTerrainMesh(renderDem, spec, terrainMaterial.material);
  scene.add(terrain.mesh);

  const lighting = createLighting(scene);
  const sky = createSky(scene);

  const village = planVillage(world.sites, spec);
  const fishery = fisherySiting(spec, world.sites.fisheryCell, world.arrays.channelMask);

  // Trees and boulders stay out of the water, off the cottage plots and the
  // paths, and away from the fishery hut.
  const clearOfProps = Uint8Array.from(riverFootprint);
  for (let i = 0; i < clearOfProps.length; i++) clearOfProps[i] |= village.clearance[i];
  markSquare(clearOfProps, spec, fishery.cell, 1);

  const props = createPropContext(curvature, gradientMap, createOcclusionFade());
  const scatter = scatterVegetation(
    scene,
    props,
    groundDem,
    world.arrays.landCover,
    spec,
    world.seed,
    clearOfProps,
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
  const river = createRiverMesh(world.reaches, world.arrays.dem, spec, outletAccum, water.material, {
    layout: riverLayout,
    ground: groundDem,
  });
  scene.add(river.mesh);

  const ponds = createPondSurfaces(water.material);
  scene.add(ponds.mesh);

  const flood = createFloodPlane(terrain.geometry, renderDem, spec, water.material);
  scene.add(flood.mesh);

  // Settlements. Placed once from the sites the worker chose out of the
  // hydrology, so the receptors sit where the model says they should.
  const settlements = new THREE.Group();
  scene.add(settlements);

  // A building is solid, and so is a boulder. Buildings are collected here
  // rather than derived later because this is the only place that knows where
  // each one ended up, and a second pass over `settlements` would have to
  // re-derive a footprint from meshes that have already been rotated into
  // place; the scattered rocks' footprints come from `scatter`, which is the
  // only place that knows their per-instance scale.
  const obstacles: Obstacle[] = [...scatter.rockObstacles];

  const place = (
    id: Parameters<typeof getProp>[0],
    x: number,
    y: number,
    z: number,
    rotation: number,
    footprintScale = 1.35,
  ): void => {
    const asset = getProp(id, props);
    const group = groupOf(asset);
    group.position.set(x, y, z);
    group.rotation.y = rotation;
    settlements.add(group);

    // The prop's own radius is its half-width, which for a gabled box is the
    // short way across. A circle on that radius would let the player walk
    // through the corners of a cottage, so the footprint is grown to cover the
    // longer axis — a little generous at the corners, which reads as not quite
    // being able to scrape the wall rather than as a bug.
    obstacles.push({ x, z, radius: asset.radius * footprintScale });
  };

  const COTTAGES = ["cottageA", "cottageB", "cottageC", "cottageD"] as const;
  for (const cottage of village.cottages) {
    place(COTTAGES[cottage.variant], cottage.x, groundDem[cottage.cell], cottage.z, cottage.rotation);
  }
  place("well", village.well.x, sampleHeight(groundDem, spec, village.well.x, village.well.z), village.well.z, 0, 1.1);

  const paths = createVillagePaths(village, groundDem, spec, curvature, gradientMap);
  scene.add(paths.mesh);

  const bushes = createInstancedBatch(getProp("bush", props), Math.max(1, village.bushes.length));
  bushes.addTo(scene);
  const bushAt = new THREE.Vector3();
  for (const bush of village.bushes) {
    bushAt.set(bush.x, sampleHeight(groundDem, spec, bush.x, bush.z), bush.z);
    bushes.add(bushAt, bush.rotation, bush.scale);
    obstacles.push({ x: bush.x, z: bush.z, radius: 0.5 * bush.scale });
  }

  // The hut stands on the bank at its natural height — the carved bed reaches
  // under the bank's edge, and the plinth covers the difference — with the
  // jetty run out over the pool the fish come back to.
  const hutAt = cellToWorld(spec, fishery.cell, new THREE.Vector3());
  place("fisheryHut", hutAt.x, world.arrays.dem[fishery.cell], hutAt.z, fishery.rotation);

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

  // Aerial perspective, matched to the sky's horizon colour.
  //
  // Exponential rather than the linear fog this started as, and reaching well
  // into the playfield rather than sitting beyond the far divide. Linear fog has
  // to choose between touching the middle distance and blanking the far one,
  // because it runs from nothing to total over its range; the squared
  // exponential is nearly nothing up close and never quite total, which is both
  // what haze does and what the depth cue needs. A density of one reciprocal
  // catchment-width puts about a fifth of the horizon colour over ground 500 m
  // off and leaves the far divide reading as distance rather than as a cut.
  const extent = spec.width * spec.cellSize;
  scene.fog = new THREE.FogExp2(0xf5ecdc, 1 / extent);
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
    groundDem,
    pickups,

    damFactory(position, rotationY) {
      const group = groupOf(damAsset);
      group.position.copy(position);
      group.rotation.y = rotationY;
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
      paths.dispose();
      bushes.dispose();
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
      coverPatternTexture.dispose();
      overlayTexture.dispose();
      terrainData.dispose();
      gradientMap.dispose();
    },
  };
}

/**
 * Where the fishery hut stands, and which way it faces.
 *
 * The site the worker picks is a *channel* cell — where the jetty meets the
 * water — and the hut used to be put down on it, in the river. It now stands
 * on the neighbouring bank cell with the fewest other channel cells around it
 * (so it is on a plain bank, not wedged into a confluence), turned so its
 * jetty runs out over that channel cell.
 */
function fisherySiting(
  spec: GridSpec,
  fisheryCell: number,
  channelMask: Uint8Array,
): { cell: number; rotation: number } {
  const row = (fisheryCell / spec.width) | 0;
  const col = fisheryCell % spec.width;
  let best = -1;
  let bestCrowding = Infinity;

  for (let dRow = -1; dRow <= 1; dRow++) {
    for (let dCol = -1; dCol <= 1; dCol++) {
      if (dRow === 0 && dCol === 0) continue;
      const r = row + dRow;
      const c = col + dCol;
      if (r < 1 || r >= spec.height - 1 || c < 1 || c >= spec.width - 1) continue;
      const cell = r * spec.width + c;
      if (channelMask[cell]) continue;

      let crowding = 0;
      for (let nRow = -1; nRow <= 1; nRow++) {
        for (let nCol = -1; nCol <= 1; nCol++) {
          crowding += channelMask[(r + nRow) * spec.width + (c + nCol)];
        }
      }
      // Cardinal neighbours first on a tie: the jetty is shorter than a
      // diagonal step would need.
      const score = crowding + (dRow !== 0 && dCol !== 0 ? 0.5 : 0);
      if (score < bestCrowding) {
        bestCrowding = score;
        best = cell;
      }
    }
  }

  if (best < 0) return { cell: fisheryCell, rotation: Math.PI * 0.25 };
  const hut = cellToWorld(spec, best, new THREE.Vector3());
  const water = cellToWorld(spec, fisheryCell, new THREE.Vector3());
  return { cell: best, rotation: Math.atan2(water.x - hut.x, water.z - hut.z) };
}

/**
 * One ordinary mesh per part of a prop, grouped — for props placed a handful
 * of times (buildings, dams) rather than instanced.
 *
 * Culling off, like every other curved mesh: the curvature shader draws
 * distant geometry lower than its bounding sphere says, so a building just
 * above the top of the view would be culled even though the bend brings it
 * into frame.
 */
function groupOf(asset: PropAsset): THREE.Group {
  const group = new THREE.Group();
  for (const piece of asset.parts) {
    const mesh = new THREE.Mesh(piece.geometry, piece.material);
    mesh.castShadow = piece.castShadow;
    mesh.receiveShadow = piece.receiveShadow;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
