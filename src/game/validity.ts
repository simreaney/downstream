/**
 * Where each feature may be built.
 *
 * Every rule here is a hydrological or practical constraint rather than a game
 * balance knob, and the rejection messages say which — a player who is told
 * "ponds in the channel block fish passage" has learned something, where "can't
 * build here" teaches nothing.
 *
 * These run on the main thread's copies of the terrain layers, so the placement
 * ghost can be re-evaluated every frame as the player walks without a worker
 * round trip. The arrays involved change only when a feature is built.
 */

import type { GridSpec } from "../core/grid";
import { cellAreaM2 } from "../core/grid";
import { channelThresholdCells, LandCover } from "../scimap/constants";
import { isPlantable, isWorthPlanting } from "../scimap/landcover";
import type { MainThreadArrays } from "../worker/client";
import type { Intervention, InterventionKind } from "./interventions";
import { POND_RADIUS_CELLS } from "./interventions";

export type PlacementReason =
  | "ok"
  | "offMap"
  | "needSpade"
  | "needWood"
  | "needStone"
  | "occupied"
  | "tooSteep"
  | "notAHollow"
  | "tooLittleUpslope"
  | "inChannel"
  | "notInChannel"
  | "channelTooLarge"
  | "tooCloseToDam"
  | "alreadyWooded"
  | "onWater";

export interface PlacementCheck {
  readonly ok: boolean;
  readonly reason: PlacementReason;
  /** Human-readable, and where possible explaining the hydrology. */
  readonly message: string;
  /** Upslope area draining through this cell, in square metres. */
  readonly interceptedAreaM2: number;
  /** Cells the feature occupies, for the ghost footprint. */
  readonly footprint: readonly number[];
}

const MESSAGES: Record<PlacementReason, string> = {
  ok: "",
  offMap: "Outside the catchment",
  needSpade: "You need a spade to dig",
  needWood: "Not enough wood",
  needStone: "Not enough stone",
  occupied: "Something is already here",
  tooSteep: "Too steep to hold water",
  notAHollow: "This sheds water — find a hollow",
  tooLittleUpslope: "Almost nothing drains through here",
  inChannel: "Not in the watercourse — an online pond blocks fish passage",
  notInChannel: "Leaky dams go in a watercourse",
  channelTooLarge: "This reach is too big — a leaky dam would wash out",
  tooCloseToDam: "Too close to another dam to add much",
  alreadyWooded: "Already wooded",
  onWater: "Can't plant on water",
};

function fail(reason: PlacementReason, area = 0): PlacementCheck {
  return { ok: false, reason, message: MESSAGES[reason], interceptedAreaM2: area, footprint: [] };
}

function pass(area: number, footprint: readonly number[]): PlacementCheck {
  return { ok: true, reason: "ok", message: "", interceptedAreaM2: area, footprint };
}

export interface PlacementContext {
  readonly arrays: MainThreadArrays;
  readonly spec: GridSpec;
  readonly wood: number;
  readonly stone: number;
  readonly hasSpade: boolean;
  /** Cells already carrying a feature. */
  readonly occupied: ReadonlySet<number>;
  readonly interventions: readonly Intervention[];
}

/** Pond siting rules. */
export function checkPond(context: PlacementContext, cell: number): PlacementCheck {
  const { arrays, spec } = context;
  if (cell < 0) return fail("offMap");

  const area = arrays.accum[cell] * cellAreaM2(spec);
  if (!context.hasSpade) return fail("needSpade", area);
  if (context.stone < 8) return fail("needStone", area);

  // An online pond in a watercourse traps channel sediment and blocks fish
  // passage. Offline attenuation ponds are the defensible practice, and refusing
  // the alternative is the clearest way to teach the difference.
  if (arrays.channelMask[cell]) return fail("inChannel", area);

  // A pond that intercepts nothing does nothing. This is the rule that stops a
  // player dotting ponds across a hilltop and wondering why the score is flat.
  if (arrays.accum[cell] < 30) return fail("tooLittleUpslope", area);

  if (arrays.slopeDeg[cell] > 5) return fail("tooSteep", area);

  // Negative curvature is concave — a bowl water can sit in. On a convex nose it
  // would simply run round the sides.
  if (arrays.curvature[cell] > 0) return fail("notAHollow", area);

  const footprint = discFootprint(spec, cell, POND_RADIUS_CELLS);
  for (const occupied of footprint) {
    if (context.occupied.has(occupied)) return fail("occupied", area);
  }
  return pass(area, footprint);
}

/** Leaky dam siting rules. */
export function checkLeakyDam(context: PlacementContext, cell: number): PlacementCheck {
  const { arrays, spec } = context;
  if (cell < 0) return fail("offMap");

  const area = arrays.accum[cell] * cellAreaM2(spec);
  if (context.wood < 6) return fail("needWood", area);
  if (!arrays.channelMask[cell]) return fail("notInChannel", area);

  // Real guidance puts leaky barriers in low-order headwater reaches. On a
  // channel much larger than the one they were sized for they wash out in the
  // first big event and become debris.
  const threshold = channelThresholdCells(spec.cellSize);
  if (arrays.accum[cell] > threshold * 6) return fail("channelTooLarge", area);

  if (arrays.slopeDeg[cell] > 8) return fail("tooSteep", area);
  if (context.occupied.has(cell)) return fail("occupied", area);

  // Stacked barriers give sharply diminishing returns, so spacing is enforced
  // rather than left to the player to discover by wasting wood.
  for (const other of context.interventions) {
    if (other.kind !== "dam") continue;
    if (gridDistance(spec, other.cell, cell) < 6) return fail("tooCloseToDam", area);
  }
  return pass(area, [cell]);
}

/**
 * Riparian planting rules.
 *
 * Deliberately permissive. Planting is legal almost anywhere it is physically
 * sensible, because *where* it helps is the thing the player is meant to work
 * out from the risk map — blocking the unhelpful cases would do their thinking
 * for them and remove the reason to read the map at all.
 */
export function checkTree(context: PlacementContext, cell: number): PlacementCheck {
  const { arrays, spec } = context;
  if (cell < 0) return fail("offMap");

  const area = arrays.accum[cell] * cellAreaM2(spec);
  if (context.wood < 1) return fail("needWood", area);

  const cover = arrays.landCover[cell] as LandCover;
  if (cover === LandCover.Woodland) return fail("alreadyWooded", area);
  if (cover === LandCover.Water) return fail("onWater", area);
  if (!isPlantable(cover)) return fail("occupied", area);
  if (arrays.channelMask[cell]) return fail("inChannel", area);
  if (arrays.slopeDeg[cell] > 30) return fail("tooSteep", area);
  if (context.occupied.has(cell)) return fail("occupied", area);

  return pass(area, [cell]);
}

export function checkPlacement(
  kind: InterventionKind,
  context: PlacementContext,
  cell: number,
): PlacementCheck {
  switch (kind) {
    case "pond":
      return checkPond(context, cell);
    case "dam":
      return checkLeakyDam(context, cell);
    case "tree":
      return checkTree(context, cell);
  }
}

/**
 * Which way planting here moves the source term.
 *
 * Entirely separate from legality: land use may be changed in **any** direction,
 * including directions the model scores worse. The ghost colours amber and the
 * readout says which way it will go, and then the player decides.
 */
export function plantingHelps(arrays: MainThreadArrays, cell: number): boolean {
  return cell >= 0 && isWorthPlanting(arrays.landCover[cell] as LandCover);
}

/** Cells within `radius` of `centre`, as a filled disc. */
export function discFootprint(spec: GridSpec, centre: number, radius: number): number[] {
  const cells: number[] = [];
  const row = (centre / spec.width) | 0;
  const col = centre % spec.width;

  for (let dRow = -radius; dRow <= radius; dRow++) {
    for (let dCol = -radius; dCol <= radius; dCol++) {
      if (dRow * dRow + dCol * dCol > radius * radius) continue;
      const r = row + dRow;
      const c = col + dCol;
      if (r < 0 || r >= spec.height || c < 0 || c >= spec.width) continue;
      cells.push(r * spec.width + c);
    }
  }
  return cells;
}

function gridDistance(spec: GridSpec, a: number, b: number): number {
  const dRow = ((a / spec.width) | 0) - ((b / spec.width) | 0);
  const dCol = (a % spec.width) - (b % spec.width);
  return Math.hypot(dRow, dCol);
}
