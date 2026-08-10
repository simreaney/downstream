/**
 * Populate the catchment with the vegetation and stone its land cover implies.
 *
 * The woodland cells the generator produced have to become actual trees, or the
 * landscape reads as a painted map rather than a place. Scattering is seeded
 * from the world seed so a reloaded save grows the same wood in the same spot.
 *
 * Density is per land-cover class, and one instance is emitted per *sample*
 * rather than per cell — a 4 m cell of woodland holds more than one tree, and a
 * grazed field holds the occasional hedgerow specimen rather than none at all.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import { createRng, splitSeed, type Rng } from "../core/rng";
import { isLowPower } from "../config";
import { LandCover } from "../scimap/constants";
import { leakyDam } from "../props/dam";
import { cottageA, cottageB, fisheryHut } from "../props/building";
import { fish } from "../props/fauna";
import { logPile, spade } from "../props/pickups";
import { boulder } from "../props/rock";
import { broadleaf, conifer, willow } from "../props/tree";
import { getProp, registerProp } from "../props/registry";
import type { PropContext } from "../props/types";
import { createInstancedBatch, type InstancedBatch } from "./instancing";
import { sampleHeight } from "./terrainMesh";

registerProp("treeBroadleaf", broadleaf);
registerProp("treeConifer", conifer);
registerProp("treeWillow", willow);
registerProp("rock", boulder);
registerProp("dam", leakyDam);
registerProp("logPile", logPile);
registerProp("spade", spade);
registerProp("cottageA", cottageA);
registerProp("cottageB", cottageB);
registerProp("fisheryHut", fisheryHut);
registerProp("fish", fish);

/** Trees per cell, by land cover. Woodland is dense; grazing is hedgerow-sparse. */
const TREE_DENSITY: Partial<Record<LandCover, number>> = {
  [LandCover.Woodland]: 0.55,
  [LandCover.Moorland]: 0.004,
  [LandCover.ExtensiveGrassland]: 0.006,
  [LandCover.ImprovedGrassland]: 0.002,
};

const ROCK_DENSITY: Partial<Record<LandCover, number>> = {
  [LandCover.Moorland]: 0.02,
  [LandCover.ExtensiveGrassland]: 0.006,
  [LandCover.Woodland]: 0.004,
};

/**
 * Instance budgets, thinned on low-power devices.
 *
 * Vegetation is the only thing scaled: it is by far the largest instance count
 * and the least load-bearing. The catchment still reads as wooded where the
 * model says it is wooded — there are simply fewer trees doing it.
 */
const DENSITY_SCALE = isLowPower() ? 0.45 : 1;

const BROADLEAF_CAPACITY = 9000;
const CONIFER_CAPACITY = 3500;
const WILLOW_CAPACITY = 1200;
const ROCK_CAPACITY = 2500;

export interface Scatter {
  readonly broadleaf: InstancedBatch;
  readonly conifer: InstancedBatch;
  readonly willow: InstancedBatch;
  readonly rock: InstancedBatch;
  dispose(): void;
}

/** Slight per-instance tint, so a wood is not one flat colour. */
function tint(rng: Rng, out: THREE.Color): THREE.Color {
  const shade = 0.86 + rng.next() * 0.28;
  return out.setRGB(shade, shade * (0.96 + rng.next() * 0.08), shade * 0.94);
}

export function scatterVegetation(
  scene: THREE.Object3D,
  context: PropContext,
  dem: Float32Array,
  landCover: Uint8Array,
  spec: GridSpec,
  seed: number,
): Scatter {
  const rng = createRng(splitSeed(seed, "scatter"));

  const batches = {
    broadleaf: createInstancedBatch(getProp("treeBroadleaf", context), BROADLEAF_CAPACITY),
    conifer: createInstancedBatch(getProp("treeConifer", context), CONIFER_CAPACITY),
    willow: createInstancedBatch(getProp("treeWillow", context), WILLOW_CAPACITY),
    rock: createInstancedBatch(getProp("rock", context), ROCK_CAPACITY),
  };

  for (const batch of Object.values(batches)) batch.addTo(scene);

  const position = new THREE.Vector3();
  const colour = new THREE.Color();
  const halfWidth = (spec.width * spec.cellSize) / 2;
  const halfHeight = (spec.height * spec.cellSize) / 2;

  const place = (
    batch: InstancedBatch,
    x: number,
    z: number,
    scaleLow: number,
    scaleHigh: number,
  ): void => {
    if (batch.count >= batch.capacity) return;
    position.set(x, sampleHeight(dem, spec, x, z), z);
    batch.add(position, rng.range(0, Math.PI * 2), rng.range(scaleLow, scaleHigh), tint(rng, colour));
  };

  for (let row = 0; row < spec.height; row++) {
    for (let col = 0; col < spec.width; col++) {
      const cell = row * spec.width + col;
      const cover = landCover[cell] as LandCover;

      const trees = TREE_DENSITY[cover] ?? 0;
      const rocks = ROCK_DENSITY[cover] ?? 0;
      if (trees === 0 && rocks === 0) continue;

      // Jitter within the cell so the wood does not sit on a visible lattice.
      const baseX = (col + 0.5) * spec.cellSize - halfWidth;
      const baseZ = (row + 0.5) * spec.cellSize - halfHeight;
      const jitter = spec.cellSize * 0.5;

      if (rng.next() < trees * DENSITY_SCALE) {
        // Conifers on the high ground, broadleaf below — a plantation-and-copse
        // mix rather than one species everywhere.
        const batch = cover === LandCover.Moorland ? batches.conifer : batches.broadleaf;
        place(
          batch,
          baseX + rng.range(-jitter, jitter),
          baseZ + rng.range(-jitter, jitter),
          0.75,
          1.35,
        );
      }

      if (rng.next() < rocks * DENSITY_SCALE) {
        place(
          batches.rock,
          baseX + rng.range(-jitter, jitter),
          baseZ + rng.range(-jitter, jitter),
          0.7,
          1.7,
        );
      }
    }
  }

  return {
    ...batches,
    dispose() {
      for (const batch of Object.values(batches)) batch.dispose();
    },
  };
}
