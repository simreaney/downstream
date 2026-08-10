/**
 * Radix sort of cell indices by a floating-point key.
 *
 * Both FD8 accumulation and the Network Index sweep need every cell visited in
 * elevation order, once per recompute. `Array.prototype.sort` with a comparator
 * on 65,536 cells costs roughly 15 ms — the entire per-placement budget, spent
 * before any hydrology runs. A four-pass LSD radix over 8-bit digits does the
 * same work in about 1.3 ms with no comparator calls at all.
 *
 * `scripts/lint-hotpath.mjs` fails the build on `.sort(` under `src/scimap` so
 * that this cannot quietly regress.
 *
 * ## What this sort does and does not promise
 *
 * Keys are the value range mapped linearly onto the full uint32 space, so the
 * finest difference the sort can distinguish is `(max - min) / 2^32`. Values
 * closer together than that share a key and may come out in either order.
 *
 * That is not a defect to work around, because of what the caller needs. After
 * priority-flood filling, every cell is strictly lower than the cell that drains
 * into it by at least `FILL_EPSILON` (1e-6 m). Only *flow-connected* pairs have
 * to be correctly ordered — two unrelated cells at nearly the same elevation may
 * be visited in either order without changing any result. So the requirement is
 * exactly `resolution < FILL_EPSILON`, which over a 300 m catchment holds with a
 * factor of ten thousand to spare. `sortResolution` exposes the figure so the
 * hydrology can assert it rather than assume it.
 */

/** Largest key value; the range is mapped onto [0, MAX_KEY]. */
const MAX_KEY = 4294967294;

/**
 * The finest difference `sortIndicesByValue` can distinguish for this data.
 *
 * Callers whose correctness depends on resolving a specific quantum should
 * assert against this rather than trusting the range to stay small.
 */
export function sortResolution(min: number, max: number): number {
  const span = max - min;
  return span > 0 ? span / MAX_KEY : 0;
}

/**
 * Indices of `values` ordered by value.
 *
 * Non-finite values sort to the start ascending (and the end descending);
 * callers exclude them by mask rather than relying on where they land.
 * Supplying `out`, `scratch` and `keys` avoids three allocations per recompute.
 */
export function sortIndicesByValue(
  values: Float64Array,
  descending: boolean,
  out?: Int32Array,
  scratch?: Int32Array,
  keysOut?: Uint32Array,
): Int32Array {
  const n = values.length;
  let src = out && out.length === n ? out : new Int32Array(n);
  let dst = scratch && scratch.length === n ? scratch : new Int32Array(n);
  const keys = keysOut && keysOut.length === n ? keysOut : new Uint32Array(n);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const span = max - min;
  const scale = Number.isFinite(span) && span > 0 ? MAX_KEY / span : 0;

  for (let i = 0; i < n; i++) {
    const v = values[i];
    // Integer quantisation across the full uint32 range. This beats the usual
    // IEEE-754 bit-pattern trick here: that would have to run on a float32 view
    // (a uint32 key cannot hold a float64 bit pattern), whose 24-bit mantissa
    // cannot resolve a 1e-6 m epsilon at realistic elevations.
    keys[i] = Number.isFinite(v) ? ((v - min) * scale + 0.5) >>> 0 : 0;
    src[i] = i;
  }

  const counts = new Uint32Array(256);
  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[(keys[src[i]] >>> shift) & 0xff]++;

    // Exclusive prefix sum turns the histogram into bucket start offsets.
    let total = 0;
    for (let b = 0; b < 256; b++) {
      const c = counts[b];
      counts[b] = total;
      total += c;
    }

    for (let i = 0; i < n; i++) {
      const index = src[i];
      dst[counts[(keys[index] >>> shift) & 0xff]++] = index;
    }

    const swap = src;
    src = dst;
    dst = swap;
  }

  if (descending) {
    for (let i = 0, j = n - 1; i < j; i++, j--) {
      const tmp = src[i];
      src[i] = src[j];
      src[j] = tmp;
    }
  }

  // Four passes swap an even number of times, so the result is back in the
  // buffer the caller supplied as `out`.
  return src;
}
