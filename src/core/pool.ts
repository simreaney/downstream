/**
 * Scratch typed-array pool.
 *
 * The SCIMAP recompute runs on every placement and would otherwise allocate
 * several 65,536-element Float64Arrays each time — half a megabyte per feature
 * placed. On its own that is survivable, but it hands the garbage collector a
 * steady stream of large short-lived buffers, and a major collection landing
 * mid-storm shows up as a visible hitch in the hydrograph.
 *
 * Arrays are pooled by exact length. `acquire` returns a zeroed array; `release`
 * hands it back. A leaked array is harmless (the next acquire allocates), so
 * correctness never depends on release being called.
 */

type TypedArrayCtor<T> = new (length: number) => T;

class TypedPool<T extends { length: number; fill(value: number): T }> {
  private readonly free = new Map<number, T[]>();

  constructor(private readonly ctor: TypedArrayCtor<T>) {}

  acquire(length: number, zero = true): T {
    const bucket = this.free.get(length);
    const reused = bucket?.pop();
    if (reused) {
      if (zero) reused.fill(0);
      return reused;
    }
    return new this.ctor(length);
  }

  release(array: T): void {
    const bucket = this.free.get(array.length);
    if (bucket) bucket.push(array);
    else this.free.set(array.length, [array]);
  }

  clear(): void {
    this.free.clear();
  }
}

export const f64Pool = new TypedPool<Float64Array>(Float64Array);
export const f32Pool = new TypedPool<Float32Array>(Float32Array);
export const i32Pool = new TypedPool<Int32Array>(Int32Array);
export const u8Pool = new TypedPool<Uint8Array>(Uint8Array);

/** Drop every pooled buffer. Used when the catchment is regenerated. */
export function clearPools(): void {
  f64Pool.clear();
  f32Pool.clear();
  i32Pool.clear();
  u8Pool.clear();
}
