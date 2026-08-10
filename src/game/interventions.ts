/**
 * What the player builds, and what it costs.
 *
 * The intervention list *is* the save file: a seed rebuilds the catchment, and
 * replaying this ordered list rebuilds everything the player did to it. Nothing
 * derived is stored, so there is no way for the two to drift apart.
 */

import { LandCover } from "../scimap/constants";

export type InterventionKind = "pond" | "dam" | "tree";

export interface Intervention {
  readonly kind: InterventionKind;
  readonly id: number;
  readonly cell: number;
  /** Elapsed game seconds when it was built, for maturing saplings. */
  readonly at: number;
}

/** Storage volume in cubic metres, by feature. */
export const POND_STORAGE_M3 = 100;
export const DAM_STORAGE_M3 = 15;

/**
 * Fraction of a leaky dam's volume that counts as retention.
 *
 * A leaky barrier is porous: it holds water back during the peak and passes it
 * afterwards, so only part of its volume is taken out of circulation for the
 * purposes of the connectivity break. Its real value is in *when* the water
 * arrives, which the storm model handles.
 */
export const DAM_RETENTION = 0.5;

export const POND_STONE_COST = 8;
export const DAM_WOOD_COST = 6;
export const TREE_WOOD_COST = 1;

/** Radius of a pond's excavated bowl, in cells. */
export const POND_RADIUS_CELLS = 2;
/** Depth of the bowl, in metres. */
export const POND_DEPTH_M = 1.2;

export function storageOf(kind: InterventionKind): number {
  switch (kind) {
    case "pond":
      return POND_STORAGE_M3;
    case "dam":
      return DAM_STORAGE_M3 * DAM_RETENTION;
    case "tree":
      return 0;
  }
}

export function costOf(kind: InterventionKind): { wood: number; stone: number } {
  switch (kind) {
    case "pond":
      return { wood: 0, stone: POND_STONE_COST };
    case "dam":
      return { wood: DAM_WOOD_COST, stone: 0 };
    case "tree":
      return { wood: TREE_WOOD_COST, stone: 0 };
  }
}

/** Land cover a built feature imposes on its cell, if any. */
export function coverOf(kind: InterventionKind): LandCover | null {
  switch (kind) {
    case "pond":
      return LandCover.Water;
    case "tree":
      return LandCover.Woodland;
    case "dam":
      // A dam sits in the channel and does not change what the land is.
      return null;
  }
}
