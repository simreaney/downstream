/**
 * Placing a feature, and everything that follows from it.
 *
 * This is the loop the whole project exists to serve: the player builds, the
 * model re-solves, and the map, the river and the score all move. It is one
 * module because those steps have to stay in step — a placement that updated the
 * props but not the model, or the model but not the river, would show the player
 * a world that disagrees with itself.
 *
 * Recompute is sent as the *complete* current set of features rather than as a
 * delta. That costs nothing measurable — the sweep is linear in the grid, not in
 * the number of features, and 60 of them recompute in the same 10 ms as one — and
 * it buys exact undo: removing a feature restores the catchment bit for bit,
 * with no accumulated drift for a long session to reveal.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import { cellAreaM2 } from "../core/grid";
import { capacityCells } from "../scimap/twi";
import type { WorldScene } from "../render/scene";
import { cellToWorld } from "../render/terrainMesh";
import type { BreakDto, CoverEditDto } from "../worker/protocol";
import type { SimClient } from "../worker/client";
import {
  coverOf,
  costOf,
  POND_DEPTH_M,
  POND_RADIUS_CELLS,
  storageOf,
  type Intervention,
  type InterventionKind,
} from "./interventions";
import type { Inventory } from "./inventory";
import { checkPlacement, discFootprint, plantingHelps, type PlacementContext } from "./validity";

/** Scale a newly planted tree is drawn at, and a stable per-tree rotation. */
const PLANTED_SCALE = 0.5;
const PLANTED_ROTATION = 2.399;

export interface BuildResult {
  readonly placed: boolean;
  readonly message: string;
}

export interface BuildController {
  readonly interventions: readonly Intervention[];
  readonly occupied: ReadonlySet<number>;
  context(): PlacementContext;
  /** Evaluate a target without committing to it, for the ghost. */
  preview(kind: InterventionKind, cell: number): ReturnType<typeof checkPlacement>;
  place(kind: InterventionKind, cell: number, at: number): Promise<BuildResult>;
  /**
   * Rebuild a saved list of features.
   *
   * Bypasses cost and validity: the placements were already paid for and already
   * legal when they were made, and re-checking them would fail wherever a later
   * feature changed the land cover the earlier one was judged against.
   */
  replay(features: readonly Intervention[]): Promise<void>;
  /** Remove the most recent feature. */
  undo(): Promise<BuildResult>;
}

export interface BuildOptions {
  readonly sim: SimClient;
  readonly scene: WorldScene;
  readonly spec: GridSpec;
  readonly inventory: Inventory;
  readonly currentLayer: () => Parameters<SimClient["recompute"]>[0];
  readonly onRecomputed: (overlay: Uint8Array<ArrayBuffer>, metrics: unknown) => void;
}

export function createBuildController(options: BuildOptions): BuildController {
  const { sim, scene, spec, inventory } = options;

  const interventions: Intervention[] = [];
  const occupied = new Set<number>();
  /** Prop handles, so undo can remove exactly what a placement added. */
  const propHandles = new Map<number, { batch: "willow" | "rock"; handle: number } | null>();
  const pondHandles = new Map<number, number>();
  const damGroups = new Map<number, THREE.Object3D>();
  let nextId = 1;

  const position = new THREE.Vector3();

  const buildContext = (): PlacementContext => ({
    arrays: scene.arrays,
    spec,
    wood: inventory.wood,
    stone: inventory.stone,
    hasSpade: inventory.hasSpade,
    occupied,
    interventions,
  });

  /** Put a feature's visible parts in the world. Shared by place and replay. */
  const addProps = (feature: Intervention, at: THREE.Vector3): void => {
    if (feature.kind === "tree") {
      // Willow, so a completed riparian buffer is legible as a buffer from
      // across the valley without turning the overlay on.
      //
      // Planted small. A mature willow is three times the player's height and,
      // placed a few metres in front of them, fills the screen and hides the
      // ground they are working on. Half scale reads as newly planted, which is
      // also what it is.
      const handle = scene.scatter.willow.add(at, PLANTED_ROTATION * feature.id, PLANTED_SCALE);
      propHandles.set(feature.id, { batch: "willow", handle });
    } else if (feature.kind === "pond") {
      // The bowl is render-only. Ponds deliberately stay out of the routing DEM
      // — see fill.ts — so the visible excavation must not feed back into the
      // model.
      excavate(scene, spec, feature.cell);
      pondHandles.set(
        feature.id,
        scene.ponds.add(
          at.clone().setY(at.y + 0.1),
          POND_RADIUS_CELLS * spec.cellSize * 0.85,
        ),
      );
      propHandles.set(feature.id, null);
    } else {
      damGroups.set(feature.id, scene.damFactory(at));
      propHandles.set(feature.id, null);
    }
  };

  /** Everything the worker needs to re-solve, rebuilt from the current list. */
  const collect = (): { breaks: BreakDto[]; coverEdits: CoverEditDto[] } => {
    const breaks: BreakDto[] = [];
    const coverEdits: CoverEditDto[] = [];
    const area = cellAreaM2(spec);

    for (const feature of interventions) {
      const storage = storageOf(feature.kind);
      if (storage > 0) {
        breaks.push({ cell: feature.cell, capacityCells: capacityCells(storage, area) });
      }
      const cover = coverOf(feature.kind);
      if (cover !== null) {
        if (feature.kind === "pond") {
          for (const cell of discFootprint(spec, feature.cell, POND_RADIUS_CELLS)) {
            coverEdits.push({ cell, cover });
          }
        } else {
          coverEdits.push({ cell: feature.cell, cover });
        }
      }
    }
    return { breaks, coverEdits };
  };

  const resolve = async (): Promise<void> => {
    const { breaks, coverEdits } = collect();
    const result = await sim.recompute(options.currentLayer(), breaks, coverEdits);
    scene.river.setReachRisk(result.reachRisk);
    options.onRecomputed(result.overlay, result.metrics);
  };

  return {
    interventions,
    occupied,
    context: buildContext,

    preview(kind, cell) {
      return checkPlacement(kind, buildContext(), cell);
    },

    async place(kind, cell, at) {
      const check = checkPlacement(kind, buildContext(), cell);
      if (!check.ok) return { placed: false, message: check.message };

      const cost = costOf(kind);
      if (!inventory.spend(cost.wood, cost.stone)) {
        return { placed: false, message: cost.wood > 0 ? "Not enough wood" : "Not enough stone" };
      }

      const feature: Intervention = { kind, id: nextId++, cell, at };
      interventions.push(feature);
      for (const footprintCell of check.footprint) occupied.add(footprintCell);

      cellToWorld(spec, cell, position);
      position.y = scene.arrays.dem[cell];

      addProps(feature, position);

      const helpful = kind !== "tree" || plantingHelps(scene.arrays, cell);
      await resolve();

      return {
        placed: true,
        message: helpful
          ? `${label(kind)} built — ${formatArea(check.interceptedAreaM2)} draining through`
          : `${label(kind)} planted — this cover was already lower-risk than woodland`,
      };
    },

    async replay(features) {
      for (const feature of features) {
        const restored: Intervention = { ...feature, id: nextId++ };
        interventions.push(restored);

        const footprint =
          feature.kind === "pond"
            ? discFootprint(spec, feature.cell, POND_RADIUS_CELLS)
            : [feature.cell];
        for (const cell of footprint) occupied.add(cell);

        cellToWorld(spec, feature.cell, position);
        position.y = scene.arrays.dem[feature.cell];
        addProps(restored, position);
      }
      await resolve();
    },

    async undo() {
      const feature = interventions.pop();
      if (!feature) return { placed: false, message: "Nothing to undo" };

      const cost = costOf(feature.kind);
      inventory.refund(cost.wood, cost.stone);

      const footprint =
        feature.kind === "pond"
          ? discFootprint(spec, feature.cell, POND_RADIUS_CELLS)
          : [feature.cell];
      for (const cell of footprint) occupied.delete(cell);

      const prop = propHandles.get(feature.id);
      if (prop?.batch === "willow") scene.scatter.willow.remove(prop.handle);
      propHandles.delete(feature.id);

      const pond = pondHandles.get(feature.id);
      if (pond !== undefined) {
        scene.ponds.remove(pond);
        pondHandles.delete(feature.id);
        restore(scene, spec, feature.cell);
      }

      const dam = damGroups.get(feature.id);
      if (dam) {
        dam.removeFromParent();
        damGroups.delete(feature.id);
      }

      await resolve();
      return { placed: true, message: `${label(feature.kind)} removed` };
    },
  };
}

function label(kind: InterventionKind): string {
  return kind === "pond" ? "Pond" : kind === "dam" ? "Leaky dam" : "Tree";
}

function formatArea(m2: number): string {
  const hectares = m2 / 10_000;
  return hectares >= 1 ? `${hectares.toFixed(1)} ha` : `${Math.round(m2)} m²`;
}

/** Lower the visible ground into a bowl. Render only — the model never sees it. */
function excavate(scene: WorldScene, spec: GridSpec, centre: number): void {
  const radius = POND_RADIUS_CELLS;
  const row = (centre / spec.width) | 0;
  const col = centre % spec.width;

  for (const cell of discFootprint(spec, centre, radius)) {
    const dRow = ((cell / spec.width) | 0) - row;
    const dCol = (cell % spec.width) - col;
    const distance = Math.hypot(dRow, dCol) / radius;
    // Cosine bowl, so the rim meets the surrounding ground without a step.
    scene.renderDem[cell] -= POND_DEPTH_M * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, distance)));
  }
  scene.terrain.updatePatch(scene.renderDem, col - radius, row - radius, radius * 2 + 1, radius * 2 + 1);
}

function restore(scene: WorldScene, spec: GridSpec, centre: number): void {
  const radius = POND_RADIUS_CELLS;
  const row = (centre / spec.width) | 0;
  const col = centre % spec.width;

  for (const cell of discFootprint(spec, centre, radius)) {
    scene.renderDem[cell] = scene.arrays.dem[cell];
  }
  scene.terrain.updatePatch(scene.renderDem, col - radius, row - radius, radius * 2 + 1, radius * 2 + 1);
}
