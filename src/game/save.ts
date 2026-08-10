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

import type { Intervention, InterventionKind } from "./interventions";

/** Bumped when the shape below changes in a way older saves cannot satisfy. */
export const SAVE_VERSION = 1;

export interface SaveData {
  readonly version: number;
  readonly seed: number;
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
    t: Math.round(save.elapsedSeconds),
    w: save.wood,
    n: save.stone,
    p: save.hasSpade ? 1 : 0,
    c: save.collected,
    i: flat,
  };
}

function fromWire(wire: WireSave): SaveData {
  const interventions: Intervention[] = [];
  for (let i = 0; i + 2 < wire.i.length; i += 3) {
    const kind = KINDS[wire.i[i]];
    if (!kind) continue;
    interventions.push({ kind, id: interventions.length + 1, cell: wire.i[i + 1], at: wire.i[i + 2] });
  }

  return {
    version: wire.v,
    seed: wire.s >>> 0,
    elapsedSeconds: wire.t,
    wood: wire.w,
    stone: wire.n,
    hasSpade: wire.p === 1,
    collected: wire.c ?? [],
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

export async function loadFromStorage(): Promise<SaveData | null> {
  try {
    const code = localStorage.getItem(STORAGE_KEY);
    return code ? await deserialise(code) : null;
  } catch {
    return null;
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
