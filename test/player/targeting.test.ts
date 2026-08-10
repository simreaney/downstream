/**
 * Facing-target and heightfield sampling.
 *
 * The yaw sign convention is the thing worth pinning. The controller, the
 * character's rotation and this function all have to agree, and getting one of
 * them backwards puts the build target behind the player — which reads as a
 * broken control rather than as a sign error, and is exactly the sort of bug
 * that survives a code review.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GridSpec } from "../../src/core/grid";
import { facingTarget } from "../../src/player/targeting";
import { sampleHeight, sampleNormal, worldToCell, cellToWorld } from "../../src/render/terrainMesh";

const SPEC: GridSpec = { width: 16, height: 16, cellSize: 4 };

describe("facingTarget", () => {
  const out = { cell: -1, x: 0, z: 0 };

  it("puts the target in front of the player, matching the yaw convention", () => {
    // Yaw 0 faces +z, and the character mesh uses the same rotation, so the
    // target must appear on the +z side.
    facingTarget(SPEC, 0, 0, 0, out);
    expect(out.z).toBeGreaterThan(0);
    expect(Math.abs(out.x)).toBeLessThan(1e-9);

    // Quarter turn faces +x.
    facingTarget(SPEC, 0, 0, Math.PI / 2, out);
    expect(out.x).toBeGreaterThan(0);
    expect(Math.abs(out.z)).toBeLessThan(1e-9);

    // Half turn faces -z, i.e. behind the starting facing.
    facingTarget(SPEC, 0, 0, Math.PI, out);
    expect(out.z).toBeLessThan(0);
  });

  it("stays within arm's reach of the player", () => {
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.3) {
      facingTarget(SPEC, 5, -3, yaw, out);
      const distance = Math.hypot(out.x - 5, out.z + 3);
      expect(distance).toBeCloseTo(3.2, 6);
    }
  });

  it("reports -1 when facing off the edge of the catchment", () => {
    const halfExtent = (SPEC.width * SPEC.cellSize) / 2;
    facingTarget(SPEC, 0, halfExtent - 1, 0, out);
    expect(out.cell).toBe(-1);
  });

  it("round-trips a cell through world coordinates", () => {
    const position = new THREE.Vector3();
    for (const cell of [0, 17, 128, 255]) {
      cellToWorld(SPEC, cell, position);
      expect(worldToCell(SPEC, position.x, position.z)).toBe(cell);
    }
  });
});

describe("heightfield sampling", () => {
  /** A plane rising 1 m per metre of +x, so answers are checkable by hand. */
  function ramp(): Float32Array {
    const dem = new Float32Array(SPEC.width * SPEC.height);
    for (let row = 0; row < SPEC.height; row++) {
      for (let col = 0; col < SPEC.width; col++) {
        dem[row * SPEC.width + col] = col * SPEC.cellSize;
      }
    }
    return dem;
  }

  it("interpolates between cell centres", () => {
    const dem = ramp();
    const position = new THREE.Vector3();

    // Exactly on a cell centre returns that cell's value.
    cellToWorld(SPEC, 8 * SPEC.width + 8, position);
    expect(sampleHeight(dem, SPEC, position.x, position.z)).toBeCloseTo(8 * 4, 4);

    // Half a cell along +x is half a cell higher.
    expect(sampleHeight(dem, SPEC, position.x + 2, position.z)).toBeCloseTo(8 * 4 + 2, 4);
  });

  it("clamps outside the grid rather than reading past the end", () => {
    const dem = ramp();
    const far = SPEC.width * SPEC.cellSize;
    expect(Number.isFinite(sampleHeight(dem, SPEC, far * 3, far * 3))).toBe(true);
    expect(Number.isFinite(sampleHeight(dem, SPEC, -far * 3, -far * 3))).toBe(true);
  });

  it("returns a unit normal tilted away from the upslope direction", () => {
    const dem = ramp();
    const normal = sampleNormal(dem, SPEC, 0, 0, new THREE.Vector3());

    expect(normal.length()).toBeCloseTo(1, 6);
    // Ground rises towards +x, so the normal leans towards -x.
    expect(normal.x).toBeLessThan(0);
    expect(normal.y).toBeGreaterThan(0);
    // A 45-degree ramp: the normal is 45 degrees off vertical.
    expect(normal.y).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it("returns straight up on flat ground", () => {
    const flat = new Float32Array(SPEC.width * SPEC.height).fill(12);
    const normal = sampleNormal(flat, SPEC, 0, 0, new THREE.Vector3());
    expect(normal.y).toBeCloseTo(1, 9);
  });
});
