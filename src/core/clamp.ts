/**
 * Scalar helpers used across the compute core.
 *
 * Kept separate from the grid and statistics modules so that hot loops can
 * import exactly what they need, and so these stay trivially inlinable.
 */

export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp, clamped. Returns 0 when the span is degenerate. */
export function invLerp(a: number, b: number, value: number): number {
  const span = b - a;
  if (span === 0) return 0;
  return clamp01((value - a) / span);
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = invLerp(edge0, edge1, value);
  return t * t * (3 - 2 * t);
}

/**
 * First-order lag towards a target, framerate-independent.
 *
 * `tau` is the time in seconds to close roughly 63% of the gap. Used for the
 * receptor states — fishery clarity recovering over about a game day is what
 * makes restoration feel earned rather than like dragging a slider.
 */
export function approach(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}
