/**
 * How the village is laid out around its green.
 *
 * `planVillage` is what turns seven cottage plots into a village — doors to the
 * green, a path from each — so the properties that make it read as one are
 * pinned here: every front faces the well, every door has a path that reaches
 * it, and trees are kept off the plots and the green.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GridSpec } from "../../src/core/grid";
import { planVillage } from "../../src/render/village";
import { cellToWorld } from "../../src/render/terrainMesh";
import type { SitesDto } from "../../src/worker/protocol";

const SPEC: GridSpec = { width: 48, height: 48, cellSize: 4 };
const at = (row: number, col: number): number => row * SPEC.width + col;

const SITES: SitesDto = {
  fisheryCell: at(2, 24),
  villageCell: at(24, 24),
  cottageCells: [at(20, 24), at(28, 24), at(24, 20), at(24, 28), at(21, 21), at(27, 27), at(21, 27)],
  poolCells: [],
};

describe("planVillage", () => {
  const plan = planVillage(SITES, SPEC);
  const centre = cellToWorld(SPEC, SITES.villageCell, new THREE.Vector3());

  it("turns every cottage's front towards the green", () => {
    expect(plan.cottages).toHaveLength(SITES.cottageCells.length);
    for (const cottage of plan.cottages) {
      // A rotation of θ about Y carries the cottage's front (+z) to (sin θ, cos θ).
      const front = new THREE.Vector2(Math.sin(cottage.rotation), Math.cos(cottage.rotation));
      const toGreen = new THREE.Vector2(centre.x - cottage.x, centre.z - cottage.z).normalize();
      expect(front.dot(toGreen)).toBeGreaterThan(0.999);
    }
  });

  it("runs a path from each door into the gravel round the well", () => {
    expect(plan.paths).toHaveLength(SITES.cottageCells.length);
    plan.paths.forEach((line, index) => {
      const cottage = plan.cottages[index];
      const count = line.length / 2;
      // Starts just in front of its own cottage, a few metres from its centre...
      const startGap = Math.hypot(line[0] - cottage.x, line[1] - cottage.z);
      expect(startGap).toBeLessThan(3);
      // ...and ends inside the gravel patch, short of the well wall.
      const endGap = Math.hypot(line[(count - 1) * 2] - centre.x, line[(count - 1) * 2 + 1] - centre.z);
      expect(endGap).toBeLessThan(2.6);
      expect(endGap).toBeGreaterThan(1.2);
    });
  });

  it("keeps trees off every plot and the green", () => {
    for (const cell of [...SITES.cottageCells, SITES.villageCell]) {
      expect(plan.clearance[cell]).toBe(1);
    }
    // ...but not off the whole map.
    expect(plan.clearance[at(2, 2)]).toBe(0);
  });

  it("lays the village out the same way every time", () => {
    const again = planVillage(SITES, SPEC);
    expect(again.bushes).toEqual(plan.bushes);
    expect(again.paths.map((line) => Array.from(line))).toEqual(plan.paths.map((line) => Array.from(line)));
  });
});
