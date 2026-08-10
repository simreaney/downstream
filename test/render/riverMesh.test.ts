/**
 * River ribbon construction.
 *
 * Two things here are easy to get wrong and invisible in code review.
 *
 * The risk-to-vertex mapping depends on this mesh iterating reaches in exactly
 * the order the worker emits risk for, and on each cross-section knowing where
 * it sits in that array. The ribbon is subdivided finer than the grid, so the
 * mapping is a fractional cell coordinate rather than a one-to-one index; drift
 * and the river shows one reach's sediment on another — a plausible-looking
 * picture of the wrong thing.
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
import { createRiverMesh, SAMPLES_PER_CELL } from "../../src/render/riverMesh";
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

/** Cross-sections a reach of `cells` cells is subdivided into. */
function sectionsIn(cells: number): number {
  return (cells - 1) * SAMPLES_PER_CELL + 1;
}

describe("createRiverMesh", () => {
  it("subdivides each reach, emitting two vertices per cross-section", () => {
    const river = build([reach(1, 5), reach(8, 4)]);
    const position = river.mesh.geometry.getAttribute("position");
    expect(position.count).toBe((sectionsIn(5) + sectionsIn(4)) * 2);
  });

  it("lands a cross-section exactly on each cell, in reach order", () => {
    const river = build([reach(1, 3), reach(8, 2)]);

    const risk = Float32Array.from([0.1, 0.2, 0.3, 0.8, 0.9]);
    river.setReachRisk(risk);

    const actual = river.mesh.geometry.getAttribute("aReachRisk").array as Float32Array;

    // Cell `i` of the first reach owns cross-section `i * SAMPLES_PER_CELL`; the
    // second reach starts after the first reach's sections. Both vertices of a
    // section carry the value, so a section is two entries wide.
    const sectionOf = (reachStart: number, cell: number): number =>
      reachStart + cell * SAMPLES_PER_CELL;
    const secondReach = sectionsIn(3);

    const expected: Array<[number, number]> = [
      [sectionOf(0, 0), 0.1],
      [sectionOf(0, 1), 0.2],
      [sectionOf(0, 2), 0.3],
      [sectionOf(secondReach, 0), 0.8],
      [sectionOf(secondReach, 1), 0.9],
    ];

    // Compared with a tolerance because the attribute is Float32.
    for (const [section, value] of expected) {
      expect(actual[section * 2]).toBeCloseTo(value, 6);
      expect(actual[section * 2 + 1]).toBeCloseTo(value, 6);
    }
  });

  it("interpolates risk between cells rather than stepping at the boundary", () => {
    const river = build([reach(1, 3)]);
    river.setReachRisk(Float32Array.from([0, 1, 1]));

    const actual = river.mesh.geometry.getAttribute("aReachRisk").array as Float32Array;

    // Halfway between the first two cells is halfway between their risks, and
    // every section along that span is strictly increasing.
    const half = SAMPLES_PER_CELL / 2;
    expect(actual[half * 2]).toBeCloseTo(0.5, 6);
    for (let section = 1; section <= SAMPLES_PER_CELL; section++) {
      expect(actual[section * 2]).toBeGreaterThan(actual[(section - 1) * 2]);
    }
  });

  it("keeps a reach's risk out of the next one", () => {
    // The offset into the risk array must advance by every reach the worker
    // traced, including one too short to draw — the worker emits a value for
    // its cell either way.
    const short: ReachDto = { cells: Int32Array.of(4 * SPEC.width + 8), accum: Float64Array.of(5) };
    const river = build([short, reach(8, 2)]);

    river.setReachRisk(Float32Array.from([0.4, 0.8, 0.9]));

    const actual = river.mesh.geometry.getAttribute("aReachRisk").array as Float32Array;
    expect(actual[0]).toBeCloseTo(0.8, 6);
    expect(actual[(sectionsIn(2) - 1) * 2]).toBeCloseTo(0.9, 6);
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

    const halfWidthAt = (section: number): number => {
      const left = new THREE.Vector3().fromBufferAttribute(position, section * 2);
      const right = new THREE.Vector3().fromBufferAttribute(position, section * 2 + 1);
      return left.distanceTo(right) / 2;
    };

    const sections = sectionsIn(8);
    expect(halfWidthAt(sections - 1)).toBeGreaterThan(halfWidthAt(0));
    // Every cross-section, not only the ones on a cell centre: widths are
    // interpolated between cells, and an interpolation that overshot would put
    // the ribbon outside the hydraulic geometry it is supposed to be drawing.
    for (let section = 0; section < sections; section++) {
      expect(halfWidthAt(section)).toBeGreaterThanOrEqual(0.7 - 1e-6);
      expect(halfWidthAt(section)).toBeLessThanOrEqual(2.6 + 1e-6);
    }
  });

  it("tolerates a shorter risk array than it has cells", () => {
    // Defensive: a mismatched length must not write past the attribute.
    const river = build([reach(1, 4)]);
    expect(() => river.setReachRisk(new Float32Array(2))).not.toThrow();
  });
});
