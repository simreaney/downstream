/**
 * Floodwater, as one vertex-displaced plane over the whole catchment.
 *
 * A single mesh sharing the water material, with per-vertex depth uploaded from
 * the storm's playback frames. Fragments below a threshold discard, so dry
 * ground shows through and the flood has an edge that advances and retreats
 * rather than a rectangle that fades — one draw call for the entire event.
 *
 * The depth attribute is `Float32` interpolated from the storm's quantised
 * `Uint8` frames. Quantising costs a centimetre of resolution over a 1.5 m range
 * and turns 60 full-grid snapshots from 15 MB into 4 MB, which is the difference
 * between shipping the playback across the worker boundary and streaming it.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";

/** Depth below which a fragment is discarded, in metres. */
const VISIBLE_DEPTH_M = 0.025;

export interface FloodPlane {
  readonly mesh: THREE.Mesh;
  /** Upload one playback frame, interpolating towards the next. */
  setFrame(frames: Uint8Array, frameCount: number, position: number, scaleM: number): void;
  clear(): void;
  dispose(): void;
}

export function createFloodPlane(
  dem: Float32Array,
  spec: GridSpec,
  material: THREE.Material,
): FloodPlane {
  const { width, height, cellSize } = spec;
  const n = width * height;

  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const depths = new Float32Array(n);
  const banks = new Float32Array(n);
  const risks = new Float32Array(n);
  const flows = new Float32Array(n);

  const halfWidth = (width * cellSize) / 2;
  const halfHeight = (height * cellSize) / 2;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      positions[i * 3] = (col + 0.5) * cellSize - halfWidth;
      positions[i * 3 + 1] = dem[i];
      positions[i * 3 + 2] = (row + 0.5) * cellSize - halfHeight;
      normals[i * 3 + 1] = 1;
      // Floodwater is shallow and turbid throughout, so it takes the material's
      // deep-water shading rather than a channel cross-section.
      banks[i] = 0.35;
    }
  }

  const quadCount = (width - 1) * (height - 1);
  const indices = new Uint32Array(quadCount * 6);
  let cursor = 0;
  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const a = row * width + col;
      indices[cursor++] = a;
      indices[cursor++] = a + width;
      indices[cursor++] = a + 1;
      indices[cursor++] = a + 1;
      indices[cursor++] = a + width;
      indices[cursor++] = a + width + 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("aBank", new THREE.BufferAttribute(banks, 1));
  geometry.setAttribute("aReachRisk", new THREE.BufferAttribute(risks, 1));
  geometry.setAttribute("aFlow", new THREE.BufferAttribute(flows, 1));
  geometry.setAttribute("aDepth", new THREE.BufferAttribute(depths, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  const depthAttribute = geometry.getAttribute("aDepth") as THREE.BufferAttribute;
  const positionAttribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  depthAttribute.setUsage(THREE.DynamicDrawUsage);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);

  // A clone, so raising the flood's water surface does not also raise the river.
  const floodMaterial = material.clone();
  floodMaterial.onBeforeCompile = (shader, renderer) => {
    material.onBeforeCompile?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n        attribute float aDepth;\n        varying float vDepth;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n        vDepth = aDepth;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n        varying float vDepth;")
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        // Discard rather than fade: a flood needs a hard advancing edge, and a
        // transparent skin over the whole catchment reads as a bug.
        if (vDepth < ${VISIBLE_DEPTH_M.toFixed(3)}) discard;
        gl_FragColor.a *= clamp(vDepth * 6.0, 0.35, 1.0);`,
      );
  };
  floodMaterial.customProgramCacheKey = () => "curved:flood";

  const mesh = new THREE.Mesh(geometry, floodMaterial);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;

  return {
    mesh,

    setFrame(frames, frameCount, position, scaleM) {
      // Interpolate between adjacent frames, or a 60-frame playback of a storm
      // advances in visible steps.
      const clamped = Math.min(Math.max(position, 0), frameCount - 1);
      const lower = Math.floor(clamped);
      const upper = Math.min(frameCount - 1, lower + 1);
      const blend = clamped - lower;

      const lowerBase = lower * n;
      const upperBase = upper * n;
      const toMetres = scaleM / 255;

      for (let i = 0; i < n; i++) {
        const a = frames[lowerBase + i] * toMetres;
        const b = frames[upperBase + i] * toMetres;
        const depth = a + (b - a) * blend;
        depths[i] = depth;
        positions[i * 3 + 1] = dem[i] + depth;
      }

      depthAttribute.needsUpdate = true;
      positionAttribute.needsUpdate = true;
      mesh.visible = true;
    },

    clear() {
      mesh.visible = false;
    },

    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      floodMaterial.dispose();
    },
  };
}
