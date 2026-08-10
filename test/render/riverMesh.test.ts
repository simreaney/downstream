/**
 * River ribbon construction.
 *
 * Two things here are easy to get wrong and invisible in code review.
 *
 * The risk-to-vertex mapping depends on this mesh iterating reaches in exactly
 * the order the worker emits risk for, with two vertices per cell. Drift and the
 * river shows one reach's sediment on another — a plausible-looking picture of
 * the wrong thing.
 *
 * Triangle winding decides which way the surface faces. Because the water
 * material is double-sided, a reversed winding does not produce an invisible
 * mesh (which would be obvious); three flips the normal per fragment and shades
 * the water with the hemisphere light's ground colour, so a correct river
 * renders in murky grey and reads as a colour bug.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GridSpec } from "../../src/core/grid";
import { createRiverMesh } from "../../src/render/riverMesh";
import type { ReachDto } from "../../src/worker/protocol";

const SPEC: GridSpec = { width: 16, height: 16, cellSize: 4 };

/** A straight reach running down the middle of the grid. */
function reach(startRow: number, length: number): ReachDto {
  const cells = new Int32Array(length);
  const accum = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    cells[i] = (startRow + i) * SPEC.width + 8;
    // Kept well below the grid's 256 cells, or sqrt(accum / total) saturates and
    // every vertex comes out at the maximum width.
    accum[i] = 10 + i * 25;
  }
  return { cells, accum };
}

function build(reaches: ReachDto[]) {
  const dem = new Float32Array(SPEC.width * SPEC.height).fill(10);
  const material = new THREE.MeshBasicMaterial();
  return createRiverMesh(reaches, dem, SPEC, SPEC.width * SPEC.height, material);
}

describe("createRiverMesh", () => {
  it("emits two vertices per channel cell, across every reach", () => {
    const river = build([reach(1, 5), reach(8, 4)]);
    const position = river.mesh.geometry.getAttribute("position");
    expect(position.count).toBe((5 + 4) * 2);
  });

  it("maps each risk value onto both vertices of its cell, in reach order", () => {
    const river = build([reach(1, 3), reach(8, 2)]);

    const risk = Float32Array.from([0.1, 0.2, 0.3, 0.8, 0.9]);
    river.setReachRisk(risk);

    // Compared with a tolerance because the attribute is Float32.
    const actual = Array.from(river.mesh.geometry.getAttribute("aReachRisk").array as Float32Array);
    const expected = [0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.8, 0.8, 0.9, 0.9];
    expect(actual).toHaveLength(expected.length);
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));
  });

  it("winds triangles so the surface faces up", () => {
    const river = build([reach(1, 4)]);
    const geometry = river.mesh.geometry;
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    expect(index).not.toBeNull();

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();

    for (let i = 0; i < index!.count; i += 3) {
      a.fromBufferAttribute(position as THREE.BufferAttribute, index!.getX(i));
      b.fromBufferAttribute(position as THREE.BufferAttribute, index!.getX(i + 1));
      c.fromBufferAttribute(position as THREE.BufferAttribute, index!.getX(i + 2));

      edge1.subVectors(b, a);
      edge2.subVectors(c, a);
      faceNormal.crossVectors(edge1, edge2);

      expect(faceNormal.y).toBeGreaterThan(0);
    }
  });

  it("widens downstream, and stays within the stated bounds", () => {
    const river = build([reach(1, 8)]);
    const position = river.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;

    const halfWidthAt = (cell: number): number => {
      const left = new THREE.Vector3().fromBufferAttribute(position, cell * 2);
      const right = new THREE.Vector3().fromBufferAttribute(position, cell * 2 + 1);
      return left.distanceTo(right) / 2;
    };

    expect(halfWidthAt(7)).toBeGreaterThan(halfWidthAt(0));
    for (let cell = 0; cell < 8; cell++) {
      expect(halfWidthAt(cell)).toBeGreaterThanOrEqual(0.7 - 1e-6);
      expect(halfWidthAt(cell)).toBeLessThanOrEqual(2.6 + 1e-6);
    }
  });

  it("tolerates a shorter risk array than it has cells", () => {
    // Defensive: a mismatched length must not write past the attribute.
    const river = build([reach(1, 4)]);
    expect(() => river.setReachRisk(new Float32Array(2))).not.toThrow();
  });
});
