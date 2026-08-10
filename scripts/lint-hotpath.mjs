/**
 * Two grep-level rules that protect properties the type system cannot.
 *
 * 1. No `.sort(` under src/scimap or src/terrain. A comparator sort of the
 *    65,536-cell grid costs roughly 15 ms on its own, which is the entire
 *    per-placement recompute budget spent in one call. Cell ordering must go
 *    through the radix sort in src/core/sort.ts.
 *
 * 2. No `Math.random(` anywhere in src except src/core/rng.ts. The world, the
 *    land cover, the site placement, prop variants and storm sampling must all
 *    derive from the save's seed, or a reloaded save silently generates a
 *    different catchment and every score becomes meaningless. All randomness
 *    goes through splitSeed().
 *
 * Both failures are invisible at runtime — the game keeps working and merely
 * becomes slow, or non-reproducible — which is exactly why they are checked in
 * CI rather than left to review.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");

const RULES = [
  {
    pattern: /\.sort\s*\(/,
    dirs: ["scimap", "terrain"],
    message: "comparator sort in a hot path — use radixSortByValue from core/sort.ts",
  },
  {
    pattern: /Math\.random\s*\(/,
    dirs: null, // all of src
    // core/rng.ts is where seeded randomness is defined, and audio/ synthesises
    // noise buffers that are never serialised and never touch the model — the
    // rule protects the save file, and sound is not in it. Anything else that
    // wants an exemption almost certainly should not have one.
    exempt: ["core/rng.ts"],
    exemptDirs: ["audio"],
    message: "unseeded randomness breaks save/load determinism — use core/rng.ts",
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(full)) yield full;
  }
}

let failures = 0;

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replaceAll("\\", "/");
  const lines = readFileSync(file, "utf8").split("\n");

  for (const rule of RULES) {
    if (rule.dirs && !rule.dirs.some((d) => rel.startsWith(`${d}/`))) continue;
    if (rule.exempt?.includes(rel)) continue;
    if (rule.exemptDirs?.some((d) => rel.startsWith(`${d}/`))) continue;

    lines.forEach((line, i) => {
      // Skip comment lines so the rules can be explained in prose without
      // tripping over their own examples.
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
      if (!rule.pattern.test(line)) return;
      console.error(`${rel}:${i + 1}  ${rule.message}\n    ${trimmed}`);
      failures++;
    });
  }
}

if (failures > 0) {
  console.error(`\nlint:hotpath failed with ${failures} violation(s).`);
  process.exit(1);
}
console.log("lint:hotpath passed.");
