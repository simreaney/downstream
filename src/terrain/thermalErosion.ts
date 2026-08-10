/**
 * Thermal erosion: relax any slope steeper than the talus angle.
 *
 * Droplet erosion leaves near-vertical scarps where it has cut hard, which look
 * wrong on a soft pastoral catchment and, more practically, break the player
 * controller — a 70-degree face is neither walkable nor obviously unwalkable.
 *
 * The physical justification is real: loose material cannot maintain a slope
 * steeper than its angle of repose, so it creeps downhill until it can. 33
 * degrees is the usual figure for soil and weathered regolith, and it also
 * happens to sit just above the slope limit the player controller enforces, so
 * anywhere the character can stand is somewhere material would actually rest.
 */

import { type GridSpec, N8_DCOL, N8_DIST, N8_DROW } from "../core/grid";

/** Angle of repose in degrees. */
export const TALUS_ANGLE_DEG = 33;

/** Fraction of the excess moved per sweep. Below 0.5 for stability. */
const RELAXATION = 0.35;

export const DEFAULT_THERMAL_SWEEPS = 20;

/**
 * Relax `dem` (metres) in place towards the talus angle.
 *
 * Each sweep reads a snapshot and writes deltas, so material moves the same way
 * regardless of iteration order — updating in place would make the result depend
 * on which corner the loop started from, and the terrain would stop being
 * reproducible from its seed if the loop bounds ever changed.
 */
export function thermalErode(
  dem: Float64Array,
  spec: GridSpec,
  sweeps = DEFAULT_THERMAL_SWEEPS,
): void {
  const { width, height, cellSize } = spec;
  const maxDrop = Math.tan((TALUS_ANGLE_DEG * Math.PI) / 180) * cellSize;

  const snapshot = new Float64Array(dem.length);
  const delta = new Float64Array(dem.length);

  for (let sweep = 0; sweep < sweeps; sweep++) {
    snapshot.set(dem);
    delta.fill(0);
    let moved = 0;

    // The outermost ring is pinned: it carries the catchment divide and the
    // outlet notch, and letting talus wash it down would open a second exit.
    for (let row = 1; row < height - 1; row++) {
      for (let col = 1; col < width - 1; col++) {
        const index = row * width + col;
        const z = snapshot[index];

        // Sum the excess over every downhill neighbour first, then distribute
        // proportionally, so a cell cannot give away more than it has.
        let totalExcess = 0;
        for (let n = 0; n < 8; n++) {
          const neighbour = (row + N8_DROW[n]) * width + (col + N8_DCOL[n]);
          const drop = z - snapshot[neighbour];
          const limit = maxDrop * N8_DIST[n];
          if (drop > limit) totalExcess += drop - limit;
        }
        if (totalExcess <= 0) continue;

        const available = RELAXATION * (totalExcess / 8);
        moved += available;

        for (let n = 0; n < 8; n++) {
          const neighbour = (row + N8_DROW[n]) * width + (col + N8_DCOL[n]);
          const drop = z - snapshot[neighbour];
          const limit = maxDrop * N8_DIST[n];
          if (drop <= limit) continue;
          const share = ((drop - limit) / totalExcess) * available;
          delta[index] -= share;
          delta[neighbour] += share;
        }
      }
    }

    for (let i = 0; i < dem.length; i++) dem[i] += delta[i];

    // Converged: nothing exceeds the talus angle, so further sweeps are waste.
    if (moved < 1e-9) break;
  }
}
