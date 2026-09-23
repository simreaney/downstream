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
 *
 * And the water has to stay on top of the ground it is drawn over. A ribbon
 * that dips into its own banks looks like a rendering bug, and it is the
 * complaint that prompted the carved bed.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GridSpec } from "../../src/core/grid";
import {
  carveRiverBed,
  createRiverMesh,
  HALF_WIDTH_MAX,
  HALF_WIDTH_MIN,
  layoutRiver,
  SAMPLES_PER_CELL,
  VERTICES_PER_SECTION,
} from "../../src/render/riverMesh";
import { sampleHeight } from "../../src/render/terrainMesh";
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

/** First vertex of a cross-section, and its right- and left-bank vertices. */
const firstOf = (section: number): number => section * VERTICES_PER_SECTION;
const rightOf = (section: number): number => firstOf(section);
const leftOf = (section: number): number => firstOf(section) + VERTICES_PER_SECTION - 1;

describe("createRiverMesh", () => {
  it("subdivides each reach into cross-sections of equal vertex count", () => {
    const river = build([reach(1, 5), reach(8, 4)]);
    const position = river.mesh.geometry.getAttribute("position");
    expect(position.count).toBe((sectionsIn(5) + sectionsIn(4)) * VERTICES_PER_SECTION);
  });

  it("lands a cross-section exactly on each cell, in reach order", () => {
    const river = build([reach(1, 3), reach(8, 2)]);

    const risk = Float32Array.from([0.1, 0.2, 0.3, 0.8, 0.9]);
    river.setReachRisk(risk);

    const actual = river.mesh.geometry.getAttribute("aReachRisk").array as Float32Array;

    // Cell `i` of the first reach owns cross-section `i * SAMPLES_PER_CELL`; the
    // second reach starts after the first reach's sections. Every vertex of a
    // section carries the value.
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
      for (let k = 0; k < VERTICES_PER_SECTION; k++) {
        expect(actual[firstOf(section) + k]).toBeCloseTo(value, 6);
      }
    }
  });

  it("interpolates risk between cells rather than stepping at the boundary", () => {
    const river = build([reach(1, 3)]);
    river.setReachRisk(Float32Array.from([0, 1, 1]));

    const actual = river.mesh.geometry.getAttribute("aReachRisk").array as Float32Array;

    // Halfway between the first two cells is halfway between their risks, and
    // every section along that span is strictly increasing.
    const half = SAMPLES_PER_CELL / 2;
    expect(actual[firstOf(half)]).toBeCloseTo(0.5, 6);
    for (let section = 1; section <= SAMPLES_PER_CELL; section++) {
      expect(actual[firstOf(section)]).toBeGreaterThan(actual[firstOf(section - 1)]);
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
    expect(actual[firstOf(sectionsIn(2) - 1)]).toBeCloseTo(0.9, 6);
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
      // Measured in plan: on sloping banks the edge vertices sit at different
      // heights, which is not the ribbon being wider.
      const left = new THREE.Vector3().fromBufferAttribute(position, leftOf(section)).setY(0);
      const right = new THREE.Vector3().fromBufferAttribute(position, rightOf(section)).setY(0);
      return left.distanceTo(right) / 2;
    };

    const sections = sectionsIn(8);
    expect(halfWidthAt(sections - 1)).toBeGreaterThan(halfWidthAt(0));
    // Every cross-section, not only the ones on a cell centre: widths are
    // interpolated between cells, and an interpolation that overshot would put
    // the ribbon outside the hydraulic geometry it is supposed to be drawing.
    for (let section = 0; section < sections; section++) {
      expect(halfWidthAt(section)).toBeGreaterThanOrEqual(HALF_WIDTH_MIN - 1e-6);
      expect(halfWidthAt(section)).toBeLessThanOrEqual(HALF_WIDTH_MAX + 1e-6);
    }
  });

  it("tolerates a shorter risk array than it has cells", () => {
    // Defensive: a mismatched length must not write past the attribute.
    const river = build([reach(1, 4)]);
    expect(() => river.setReachRisk(new Float32Array(2))).not.toThrow();
  });
});

describe("water on its bed", () => {
  /**
   * A V-shaped valley draining +z down column 8: banks rising 0.4 m per metre
   * either side, and the floor falling 0.05 m per metre downstream. Steep
   * enough that a flat ribbon level with its centreline would bury both edges.
   */
  function valley(): Float32Array {
    const dem = new Float32Array(SPEC.width * SPEC.height);
    for (let row = 0; row < SPEC.height; row++) {
      for (let col = 0; col < SPEC.width; col++) {
        dem[row * SPEC.width + col] =
          20 - row * SPEC.cellSize * 0.05 + Math.abs(col - 8) * SPEC.cellSize * 0.4;
      }
    }
    return dem;
  }

  it("never puts a ribbon vertex below the ground it is drawn over", () => {
    const dem = valley();
    const reaches = [reach(1, 12)];
    const layout = layoutRiver(reaches, dem, SPEC, SPEC.width * SPEC.height);
    const ground = Float32Array.from(dem);
    carveRiverBed(ground, SPEC, layout);

    const river = createRiverMesh(reaches, dem, SPEC, SPEC.width * SPEC.height, new THREE.MeshBasicMaterial(), {
      layout,
      ground,
    });
    const position = river.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      expect(position.getY(i)).toBeGreaterThan(sampleHeight(ground, SPEC, x, z));
    }
  });

  it("carves the ground under the centreline below the water surface", () => {
    const dem = valley();
    const layout = layoutRiver([reach(1, 12)], dem, SPEC, SPEC.width * SPEC.height);
    const ground = Float32Array.from(dem);
    const footprint = carveRiverBed(ground, SPEC, layout);

    const [line] = layout;
    for (let j = 0; j < line.sections; j++) {
      expect(sampleHeight(ground, SPEC, line.x[j], line.z[j])).toBeLessThan(line.level[j]);
    }
    // Only ever lowers, and marks the channel itself as occupied by water.
    for (let i = 0; i < dem.length; i++) expect(ground[i]).toBeLessThanOrEqual(dem[i]);
    expect(footprint[5 * SPEC.width + 8]).toBe(1);
    expect(footprint[5 * SPEC.width + 1]).toBe(0);
  });

  it("never lets the water surface rise downstream", () => {
    // A pit halfway down: the level must hold through it, not climb back out.
    const dem = valley();
    dem[6 * SPEC.width + 8] -= 3;
    const [line] = layoutRiver([reach(1, 12)], dem, SPEC, SPEC.width * SPEC.height);
    for (let j = 1; j < line.sections; j++) {
      expect(line.level[j]).toBeLessThanOrEqual(line.level[j - 1] + 1e-9);
    }
  });
});
