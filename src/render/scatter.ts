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
import type { Obstacle } from "../player/controller";
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

/**
 * Trees per cell, by land cover. Woodland is dense; grazing is hedgerow-sparse.
 *
 * The open classes carry most of the change from the first pass at these
 * numbers, and deliberately. A wood at 0.55 already read as a wood; what made
 * the catchment look bare was the ground between the woods, where a hedgerow
 * specimen every five hundred cells is functionally no trees at all. Tripling a
 * number that small costs a few hundred instances across the whole map, while
 * the same proportional rise in woodland would cost thousands.
 */
const TREE_DENSITY: Partial<Record<LandCover, number>> = {
  [LandCover.Woodland]: 0.78,
  [LandCover.Moorland]: 0.014,
  [LandCover.ExtensiveGrassland]: 0.022,
  [LandCover.ImprovedGrassland]: 0.009,
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

/**
 * Headroom over the expected instance count, and the floor under it.
 *
 * Capacities are computed from a census of the land cover rather than written
 * down, because a fixed number is a silent failure: `place` drops an instance
 * when the batch is full, and scattering runs in row-major order, so
 * overrunning the budget does not thin the wood evenly — it shaves every tree
 * off the bottom edge of the map and leaves a straight line across the
 * landscape. The margin covers the binomial spread around the expected count.
 */
const CAPACITY_MARGIN = 1.25;
const CAPACITY_FLOOR = 256;

/** Height above which woodland is conifer, as a fraction of the catchment's relief. */
const CONIFER_ELEVATION = 0.62;

/**
 * Willows are never scattered — the batch exists for what the player plants —
 * so its budget is a design limit on riparian planting rather than a census.
 */
const WILLOW_CAPACITY = 1200;

export interface Scatter {
  readonly broadleaf: InstancedBatch;
  readonly conifer: InstancedBatch;
  readonly willow: InstancedBatch;
  readonly rock: InstancedBatch;
  /** Footprints of the scattered boulders, solid like a building's. */
  readonly rockObstacles: readonly Obstacle[];
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

  // Elevation above which woodland is planted as conifer, as a fraction of the
  // catchment's relief.
  //
  // Without this, conifers were reachable only through moorland's 0.014, which
  // over a whole 1 km catchment came to between three and fifteen trees — a
  // species that existed in the code and not in the landscape. Splitting the
  // woodland by height is what the "plantation above, copse below" line has
  // always claimed, and it puts a visible treeline on the valley sides.
  let lowest = Infinity;
  let highest = -Infinity;
  for (let i = 0; i < dem.length; i++) {
    if (dem[i] < lowest) lowest = dem[i];
    if (dem[i] > highest) highest = dem[i];
  }
  const coniferLine = lowest + (highest - lowest) * CONIFER_ELEVATION;

  /** Which species a tree on this cell is. Shared by the census and placement. */
  const isConifer = (cell: number, cover: LandCover): boolean =>
    cover === LandCover.Moorland || (cover === LandCover.Woodland && dem[cell] >= coniferLine);

  // Census, so each batch is sized for the cover *this* seed produced. Woodland
  // swings from 12% to 20% of the catchment between seeds, which is more spread
  // than any fixed budget's margin. Counted with the same predicate placement
  // uses rather than by land cover alone: the species split is now a function of
  // elevation, so a per-cover budget would no longer describe either batch.
  let expectedBroadleaf = 0;
  let expectedConifer = 0;
  let expectedRock = 0;
  for (let cell = 0; cell < landCover.length; cell++) {
    const cover = landCover[cell] as LandCover;
    const trees = (TREE_DENSITY[cover] ?? 0) * DENSITY_SCALE;
    if (isConifer(cell, cover)) expectedConifer += trees;
    else expectedBroadleaf += trees;
    expectedRock += (ROCK_DENSITY[cover] ?? 0) * DENSITY_SCALE;
  }

  const budgetFor = (expected: number): number =>
    Math.max(CAPACITY_FLOOR, Math.ceil(expected * CAPACITY_MARGIN));

  const batches = {
    broadleaf: createInstancedBatch(
      getProp("treeBroadleaf", context),
      budgetFor(expectedBroadleaf),
    ),
    conifer: createInstancedBatch(getProp("treeConifer", context), budgetFor(expectedConifer)),
    willow: createInstancedBatch(getProp("treeWillow", context), WILLOW_CAPACITY),
    rock: createInstancedBatch(getProp("rock", context), budgetFor(expectedRock)),
  };

  for (const batch of Object.values(batches)) batch.addTo(scene);

  const position = new THREE.Vector3();
  const colour = new THREE.Color();
  const halfWidth = (spec.width * spec.cellSize) / 2;
  const halfHeight = (spec.height * spec.cellSize) / 2;
  const rockObstacles: Obstacle[] = [];
  const rockRadius = getProp("rock", context).radius;

  /** Places an instance and returns the scale it was drawn at, for callers that need a footprint. */
  const place = (
    batch: InstancedBatch,
    x: number,
    z: number,
    scaleLow: number,
    scaleHigh: number,
  ): number | null => {
    if (batch.count >= batch.capacity) return null;
    const rotation = rng.range(0, Math.PI * 2);
    const scale = rng.range(scaleLow, scaleHigh);
    position.set(x, sampleHeight(dem, spec, x, z), z);
    batch.add(position, rotation, scale, tint(rng, colour));
    return scale;
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
        const batch = isConifer(cell, cover) ? batches.conifer : batches.broadleaf;
        place(
          batch,
          baseX + rng.range(-jitter, jitter),
          baseZ + rng.range(-jitter, jitter),
          0.75,
          1.35,
        );
      }

      if (rng.next() < rocks * DENSITY_SCALE) {
        const x = baseX + rng.range(-jitter, jitter);
        const z = baseZ + rng.range(-jitter, jitter);
        const scale = place(batches.rock, x, z, 0.7, 1.7);
        if (scale !== null) rockObstacles.push({ x, z, radius: rockRadius * scale });
      }
    }
  }

  return {
    ...batches,
    rockObstacles,
    dispose() {
      for (const batch of Object.values(batches)) batch.dispose();
    },
  };
}
