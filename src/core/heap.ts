/**
 * Binary min-heap over (float key, int payload) pairs, backed by typed arrays.
 *
 * Used by priority-flood depression filling, where the payload is a cell index
 * and the key is that cell's working elevation.
 *
 * A bucket queue would be O(n) rather than O(n log n) and is the usual choice
 * for priority-flood, but it needs the key space discretised. Our keys carry
 * accumulated fill epsilons of 1e-6 m over an elevation range of a few hundred
 * metres, so a bucket per distinct key would need on the order of 10^8 buckets.
 * At 65,536 cells the log factor is about 17 comparisons per operation and the
 * whole fill lands near 2 ms, which is well inside budget — so the simple,
 * exact structure wins.
 *
 * Capacity is fixed at construction and the arrays are reused across recomputes;
 * push beyond capacity throws rather than reallocating silently in a hot path.
 */

export class MinHeap {
  private readonly keys: Float64Array;
  private readonly values: Int32Array;
  private length = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.values = new Int32Array(capacity);
  }

  get size(): number {
    return this.length;
  }

  get isEmpty(): boolean {
    return this.length === 0;
  }

  clear(): void {
    this.length = 0;
  }

  push(key: number, value: number): void {
    if (this.length >= this.keys.length) {
      throw new RangeError(`MinHeap capacity ${this.keys.length} exceeded`);
    }
    const { keys, values } = this;
    let i = this.length++;
    keys[i] = key;
    values[i] = value;

    // Sift up.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= keys[i]) break;
      const tk = keys[parent];
      const tv = values[parent];
      keys[parent] = keys[i];
      values[parent] = values[i];
      keys[i] = tk;
      values[i] = tv;
      i = parent;
    }
  }

  /** Payload of the smallest key. Call `popKey` first if the key is needed. */
  pop(): number {
    const { keys, values } = this;
    if (this.length === 0) return -1;

    const top = values[0];
    this.length--;
    if (this.length === 0) return top;

    keys[0] = keys[this.length];
    values[0] = values[this.length];

    // Sift down.
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= this.length) break;
      const right = left + 1;
      const child = right < this.length && keys[right] < keys[left] ? right : left;
      if (keys[i] <= keys[child]) break;
      const tk = keys[child];
      const tv = values[child];
      keys[child] = keys[i];
      values[child] = values[i];
      keys[i] = tk;
      values[i] = tv;
      i = child;
    }
    return top;
  }

  /** Smallest key without removing it. NaN when empty. */
  peekKey(): number {
    return this.length === 0 ? NaN : this.keys[0];
  }
}
