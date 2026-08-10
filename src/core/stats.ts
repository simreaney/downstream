/**
 * NaN-aware reductions.
 *
 * The reference implementation leans on NumPy; in TypeScript those become
 * explicit loops, so the semantics that matter for parity are pinned here in one
 * place rather than re-derived at each call site.
 *
 * `nanPercentiles` uses a comparator sort, which costs roughly 8 ms on the
 * 65,536-cell grid. That is deliberate and affordable because it runs *once*, at
 * catchment generation, to derive the frozen stretch bounds. Nothing on the
 * per-placement recompute path may call it — see `normalise.ts` for why the
 * bounds are frozen, and `scripts/lint-hotpath.mjs` for the rule that keeps
 * sorts out of `src/scimap`.
 */

/**
 * Percentiles of the finite values, matching `np.nanpercentile(method="linear")`.
 *
 * Returns NaN for every requested percentile when nothing is finite, mirroring
 * NumPy's all-NaN behaviour rather than throwing.
 */
export function nanPercentiles(
  values: ArrayLike<number>,
  percentiles: readonly number[],
  mask?: Uint8Array,
): number[] {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return percentiles.map(() => NaN);

  finite.sort((a, b) => a - b);
  const last = finite.length - 1;

  return percentiles.map((p) => {
    const pos = (p / 100) * last;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return finite[lo];
    return finite[lo] + (finite[hi] - finite[lo]) * (pos - lo);
  });
}

/** Mean of the finite values under `mask`, or of all finite values when no mask. */
export function nanMean(values: ArrayLike<number>, mask?: Uint8Array): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return count === 0 ? NaN : sum / count;
}

export interface Extent {
  min: number;
  max: number;
  count: number;
}

/** Min, max and finite count in a single pass. */
export function nanExtent(values: ArrayLike<number>, mask?: Uint8Array): Extent {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    count++;
  }
  return count === 0 ? { min: NaN, max: NaN, count: 0 } : { min, max, count };
}

/**
 * Order-independent hash of a numeric array's contents.
 *
 * Used by the determinism tests: a fixed seed must produce a bit-identical DEM
 * and identical derived layers across runs and across a page reload, or save and
 * load silently diverge. Quantises to 1e-6 before hashing so that a value which
 * differs only in the last float bit — which no downstream consumer can observe —
 * does not fail the test.
 */
export function hashArray(values: ArrayLike<number>): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const quantised = Number.isFinite(v) ? Math.round(v * 1e6) : 0x7fffffff;
    hash ^= quantised & 0xffffffff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
