/**
 * Seeded randomness. The only source of it in the entire game.
 *
 * Save files store a seed and an ordered list of interventions, and everything
 * else — topography, land cover, site placement, prop variants, storm depths —
 * is re-derived from that seed on load. A single `Math.random()` anywhere in a
 * generation path therefore does not produce a cosmetic difference; it produces
 * a different catchment, against which the saved interventions and the frozen
 * baseline metrics are meaningless. `scripts/lint-hotpath.mjs` enforces this.
 *
 * Streams are namespaced with `splitSeed(seed, tag)` so that consuming a
 * different number of values in one system cannot shift the output of another.
 * Adding a prop variant must not move the rivers.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Standard normal, mean 0 variance 1. */
  gaussian(): number;
  /** Uniform choice from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** True with probability `p`. */
  chance(p: number): boolean;
}

/**
 * A brand-new seed for a brand-new catchment.
 *
 * The one place unseeded randomness is correct, and it lives here so that it
 * lives in the module that owns randomness — `lint:hotpath` exempts this file
 * alone, so a stray `Math.random()` anywhere else still fails the build.
 * Everything downstream of this call is deterministic given its result.
 */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** SplitMix32 — used only to expand a single seed into xoshiro's 128-bit state. */
function splitMix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Derive an independent stream seed from a master seed and a stable label.
 *
 * FNV-1a over the tag, mixed with the seed. The tag must be a literal that never
 * changes for a given system — changing `"terrain"` to `"terrain2"` regenerates
 * every existing save's world.
 */
export function splitSeed(seed: number, tag: string): number {
  let hash = 0x811c9dc5 ^ (seed >>> 0);
  for (let i = 0; i < tag.length; i++) {
    hash ^= tag.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** xoshiro128** — small, fast, and passes the statistical tests we care about. */
export function createRng(seed: number): Rng {
  const expand = splitMix32(seed >>> 0);
  let s0 = expand();
  let s1 = expand();
  let s2 = expand();
  let s3 = expand();

  // An all-zero state is a fixed point that only ever emits zero.
  if ((s0 | s1 | s2 | s3) === 0) s0 = 0x9e3779b9;

  const nextUint32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };

  // Cached second value from the Box-Muller pair, so gaussian() consumes one
  // uint32 per call on average rather than two.
  let spareGaussian: number | null = null;

  const next = (): number => nextUint32() / 4294967296;

  return {
    next,
    int(maxExclusive) {
      return Math.floor(next() * maxExclusive);
    },
    range(lo, hi) {
      return lo + next() * (hi - lo);
    },
    gaussian() {
      if (spareGaussian !== null) {
        const value = spareGaussian;
        spareGaussian = null;
        return value;
      }
      // Polar Box-Muller. Rejection keeps the pair inside the unit circle.
      let u: number;
      let v: number;
      let s: number;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const factor = Math.sqrt((-2 * Math.log(s)) / s);
      spareGaussian = v * factor;
      return u * factor;
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    chance(p) {
      return next() < p;
    },
  };
}
