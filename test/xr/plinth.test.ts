/**
 * The board's plinth.
 *
 * Winding is the thing to pin. A face wound the wrong way is culled from
 * outside, so the plinth silently vanishes and the board is a paper sheet
 * again — or, if the material were double-sided, it would be shaded from the
 * wrong hemisphere, which is the bug that once turned the river to mud.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { GridSpec } from "../../src/core/grid";
import { cellToWorld } from "../../src/render/terrainMesh";
import { createPlinth } from "../../src/xr/plinth";

const SPEC: GridSpec = { width: 24, height: 20, cellSize: 4 };

function hilly(): Float32Array {
  const dem = new Float32Array(SPEC.width * SPEC.height);
  const at = new THREE.Vector3();
  for (let cell = 0; cell < dem.length; cell++) {
    cellToWorld(SPEC, cell, at);
    dem[cell] = 30 + 10 * Math.sin(at.x / 9) + 6 * Math.cos(at.z / 7);
  }
  return dem;
}

describe("createPlinth", () => {
  it("winds every face to point the way its normal does", () => {
    const geometry = createPlinth(hilly(), SPEC).geometry;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const index = geometry.getIndex();
    expect(index).not.toBeNull();

    const [a, b, c, n, ab, ac] = Array.from({ length: 6 }, () => new THREE.Vector3());
    let faces = 0;
    for (let i = 0; i < index!.count; i += 3) {
      a.fromBufferAttribute(position, index!.getX(i));
      b.fromBufferAttribute(position, index!.getX(i + 1));
      c.fromBufferAttribute(position, index!.getX(i + 2));
      n.fromBufferAttribute(normal, index!.getX(i));
      const winding = ab.subVectors(b, a).cross(ac.subVectors(c, a));
      // Counter-clockwise seen from the side the normal points to: three's front face.
      expect(winding.dot(n)).toBeGreaterThan(0);
      faces++;
    }
    expect(faces).toBeGreaterThan(0);
  });

  it("points each side outwards, away from the board's middle", () => {
    const geometry = createPlinth(hilly(), SPEC).geometry;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i);
      n.fromBufferAttribute(normal, i);
      if (n.y !== 0) continue; // the underside
      expect(p.x * n.x + p.z * n.z).toBeGreaterThan(0);
    }
  });

  it("meets the terrain at its border vertices, with no seam", () => {
    const dem = hilly();
    const geometry = createPlinth(dem, SPEC).geometry;
    const position = geometry.getAttribute("position");
    const tops = new Set<string>();
    const p = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i);
      tops.add(`${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`);
    }
    const at = new THREE.Vector3();
    for (const cell of [0, SPEC.width - 1, SPEC.width * 7, SPEC.width * SPEC.height - 1]) {
      cellToWorld(SPEC, cell, at);
      expect(tops.has(`${at.x.toFixed(3)},${dem[cell].toFixed(3)},${at.z.toFixed(3)}`)).toBe(true);
    }
  });
});
