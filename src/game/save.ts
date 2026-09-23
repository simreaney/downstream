/**
 * Saving a catchment.
 *
 * A save is a **seed plus an ordered list of interventions**, and nothing else.
 * The terrain, the land cover, the risk layers, the resource nodes and the
 * settlements are all re-derived from the seed; the catchment's state is
 * re-derived by replaying the list. Nothing computed is stored, so there is no
 * way for the save and the world to disagree — and the whole thing fits in a URL.
 *
 * That only works because generation is deterministic. Every random draw in the
 * project comes from `splitSeed(seed, tag)`; a single `Math.random()` in a prop
 * variant would make a reloaded save a different catchment while leaving the
 * file perfectly valid. `lint:hotpath` enforces it, and the determinism tests
 * hash the generated arrays.
 *
 * Encoded as deflate-compressed JSON in base64url. A hundred interventions is
 * comfortably under 2 kB, so a save is also a share code: "seed 8814521, see if
 * you can beat 82" is a link, which is worth having for a lecture.
 */

import { DEFAULT_LANDSCAPE_SIZE, LANDSCAPE_SIZES, landscapeSpec, type LandscapeSizeId } from "../config";
import type { Intervention, InterventionKind } from "./interventions";

/**
 * Bumped when the shape below changes in a way older saves cannot satisfy — or
 * when generation changes, since a save is only meaningful against the exact
 * catchment its seed produced.
 */
export const SAVE_VERSION = 2;

/**
 * The oldest save this build will restore. Raised alongside `SAVE_VERSION`
 * whenever generation changes, because an older code would otherwise replay
 * its features onto a different landscape without any error at all.
 */
export const MIN_SAVE_VERSION = 2;

/** Ceiling on restored stock, so a hand-edited code cannot grant unlimited wood. */
const MAX_STOCK = 999;

export interface SaveData {
  readonly version: number;
  readonly seed: number;
  /**
   * Which of `LANDSCAPE_SIZES` this catchment was generated at.
   *
   * A cell index only means the same place if it is decoded against the grid
   * width it was recorded with, so the save has to carry the size alongside
   * the seed — replaying a "large" save's interventions against a freshly
   * defaulted "medium" grid would scatter them across the wrong ground.
   */
  readonly sizeId: LandscapeSizeId;
  readonly elapsedSeconds: number;
  readonly wood: number;
  readonly stone: number;
  readonly hasSpade: boolean;
  /** Ids of resource nodes already taken. */
  readonly collected: number[];
  readonly interventions: Intervention[];
}

/** Compact wire form: arrays of primitives rather than objects with keys. */
interface WireSave {
  v: number;
  s: number;
  /** Landscape size id. Absent on saves from before sizes were adjustable. */
  z?: string;
  t: number;
  w: number;
  n: number;
  p: 0 | 1;
  c: number[];
  /** Flattened triples of [kindIndex, cell, at]. */
  i: number[];
}

const KINDS: InterventionKind[] = ["pond", "dam", "tree"];

function toWire(save: SaveData): WireSave {
  const flat: number[] = [];
  for (const feature of save.interventions) {
    flat.push(KINDS.indexOf(feature.kind), feature.cell, Math.round(feature.at));
  }
  return {
    v: save.version,
    s: save.seed,
    z: save.sizeId,
    t: Math.round(save.elapsedSeconds),
    w: save.wood,
    n: save.stone,
    p: save.hasSpade ? 1 : 0,
    c: save.collected,
    i: flat,
  };
}

/** A non-negative whole count, or 0 for anything that is not one. */
function stock(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_STOCK, Math.max(0, Math.floor(value)))
    : 0;
}

/**
 * Wire form to save, refusing anything that would replay into a broken world.
 *
 * Replay deliberately skips placement checks (the features were legal when
 * they were built), so this is the only gate: a cell off the edge of its own
 * grid would otherwise reach the renderer as a feature with no ground under it.
 */
function fromWire(wire: WireSave): SaveData {
  if (!Array.isArray(wire.i)) throw new Error("That does not look like a catchment code");

  // An older save with no recorded size predates adjustable sizes, so it was
  // always the shipped default.
  const sizeId =
    LANDSCAPE_SIZES.find((option) => option.id === wire.z)?.id ?? DEFAULT_LANDSCAPE_SIZE;
  const { width, height } = landscapeSpec(sizeId);
  const cellCount = width * height;

  const interventions: Intervention[] = [];
  for (let i = 0; i + 2 < wire.i.length; i += 3) {
    const kind = KINDS[wire.i[i]];
    const cell = wire.i[i + 1];
    if (!kind || !Number.isInteger(cell) || cell < 0 || cell >= cellCount) {
      throw new Error("That code has a feature outside its landscape");
    }
    const at = Number.isFinite(wire.i[i + 2]) ? wire.i[i + 2] : 0;
    interventions.push({ kind, id: interventions.length + 1, cell, at });
  }

  return {
    version: wire.v,
    seed: wire.s >>> 0,
    sizeId,
    elapsedSeconds: Number.isFinite(wire.t) ? wire.t : 0,
    wood: stock(wire.w),
    stone: stock(wire.n),
    hasSpade: wire.p === 1,
    collected: Array.isArray(wire.c) ? wire.c.filter((id) => Number.isInteger(id)) : [],
    interventions,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
    new CompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function serialise(save: SaveData): Promise<string> {
  const json = JSON.stringify(toWire(save));
  return toBase64Url(await deflate(new TextEncoder().encode(json)));
}

export async function deserialise(code: string): Promise<SaveData> {
  const json = new TextDecoder().decode(await inflate(fromBase64Url(code.trim())));
  const wire = JSON.parse(json) as WireSave;

  if (typeof wire.v !== "number" || typeof wire.s !== "number") {
    throw new Error("That does not look like a catchment code");
  }
  if (wire.v > SAVE_VERSION) {
    throw new Error(`That save is from a newer version (${wire.v})`);
  }
  if (wire.v < MIN_SAVE_VERSION) {
    throw new Error(
      "That save was made with an older landscape generator, so it would open a different catchment",
    );
  }
  return fromWire(wire);
}

const STORAGE_KEY = "diffusePollutionGame.save";

export async function saveToStorage(save: SaveData): Promise<string> {
  const code = await serialise(save);
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Private browsing, a full quota, or storage disabled entirely. The code is
    // still returned, so the player can copy it even when we cannot keep it.
  }
  return code;
}

/** The locally kept save code, if there is one and storage is readable. */
export function readStoredCode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Forget the local save. For one that no longer loads: left in place it would
 * fail the same way on every visit.
 */
export function clearStoredSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
}

/** A save code carried in the URL fragment, if there is one. */
export function readShareCode(): string | null {
  const fragment = window.location.hash.replace(/^#/, "");
  return fragment.startsWith("s=") ? fragment.slice(2) : null;
}

export function shareUrl(code: string): string {
  const url = new URL(window.location.href);
  url.hash = `s=${code}`;
  // The seed lives in the code, so a stale query parameter would contradict it.
  url.searchParams.delete("seed");
  return url.toString();
}
