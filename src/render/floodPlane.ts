/**
 * Floodwater, as one vertex-displaced plane over the whole catchment.
 *
 * A single mesh sharing the water material, with per-vertex depth uploaded from
 * the storm's playback frames. Fragments below a threshold discard, so dry
 * ground shows through and the flood has an edge that advances and retreats
 * rather than a rectangle that fades — one draw call for the entire event.
 *
 * The plane *is* the terrain grid: it shares the terrain mesh's position and
 * index buffers and lifts each vertex by its depth in the vertex shader. So
 * the only thing uploaded per frame is the depth array — a quarter of what
 * rewriting every position as well cost — and the flood follows the ground
 * exactly, pond bowls included, because it is the same buffer the ground is
 * drawn from.
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

/** Depth over which the advancing edge carries a pale foam line, in metres. */
const EDGE_FOAM_DEPTH_M = 0.06;

/**
 * Sheet-flow surface speed from ground slope, in metres per second.
 *
 * Only animates the ripples (see `waterMaterial.ts`); the storm's routing is
 * done in the worker and never sees this. Square root of slope, as for the
 * channel, clamped so flat valley floors still visibly creep and steep sides do
 * not smear.
 */
function sheetVelocity(slope: number): number {
  return Math.min(1.6, Math.max(0.15, 4.5 * Math.sqrt(slope)));
}

export interface FloodPlane {
  readonly mesh: THREE.Mesh;
  /** Upload one playback frame, interpolating towards the next. */
  setFrame(frames: Uint8Array, frameCount: number, position: number, scaleM: number): void;
  clear(): void;
  dispose(): void;
}

/**
 * @param terrain The terrain mesh's geometry, whose positions and index the
 *   flood reuses. Its heights may change later (ponds); the flood follows.
 * @param dem Elevation for the downslope flow directions the ripples run along.
 */
export function createFloodPlane(
  terrain: THREE.BufferGeometry,
  dem: Float32Array,
  spec: GridSpec,
  material: THREE.Material,
): FloodPlane {
  const { width, height, cellSize } = spec;
  const n = width * height;

  const normals = new Float32Array(n * 3);
  const depths = new Float32Array(n);
  const banks = new Float32Array(n);
  const risks = new Float32Array(n);
  const travels = new Float32Array(n).fill(-1);
  const dirs = new Float32Array(n * 2);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col;
      normals[i * 3 + 1] = 1;
      // Floodwater is shallow and turbid throughout, so it takes the material's
      // deep-water shading rather than a channel cross-section.
      banks[i] = 0.35;

      // Downslope direction from a centred difference on the DEM, so the
      // floodwater's ripples run the way the water would.
      const left = dem[row * width + Math.max(0, col - 1)];
      const right = dem[row * width + Math.min(width - 1, col + 1)];
      const up = dem[Math.max(0, row - 1) * width + col];
      const down = dem[Math.min(height - 1, row + 1) * width + col];
      const gx = (right - left) / (2 * cellSize);
      const gz = (down - up) / (2 * cellSize);
      const slope = Math.hypot(gx, gz);
      if (slope > 1e-6) {
        const v = sheetVelocity(slope);
        dirs[i * 2] = (-gx / slope) * v;
        dirs[i * 2 + 1] = (-gz / slope) * v;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", terrain.getAttribute("position"));
  geometry.setIndex(terrain.getIndex());
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("aBank", new THREE.BufferAttribute(banks, 1));
  geometry.setAttribute("aReachRisk", new THREE.BufferAttribute(risks, 1));
  geometry.setAttribute("aTravel", new THREE.BufferAttribute(travels, 1));
  geometry.setAttribute("aDir", new THREE.BufferAttribute(dirs, 2));
  geometry.setAttribute("aDepth", new THREE.BufferAttribute(depths, 1));

  const depthAttribute = geometry.getAttribute("aDepth") as THREE.BufferAttribute;
  depthAttribute.setUsage(THREE.DynamicDrawUsage);

  // A clone, so raising the flood's water surface does not also raise the river.
  const floodMaterial = material.clone();
  floodMaterial.onBeforeCompile = (shader, renderer) => {
    material.onBeforeCompile?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n        attribute float aDepth;\n        varying float vDepth;")
      // Straight after begin_vertex, ahead of the water patch's own lines that
      // read `transformed`, so everything downstream sees the lifted surface.
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n        transformed.y += aDepth;\n        vDepth = aDepth;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n        varying float vDepth;")
      // Discard dry ground first. The plane covers the whole terrain and sits
      // exactly on it where there is no water, so the depth test passes almost
      // everywhere; testing here rather than at the end skips the whole water
      // shader for every dry pixel on screen.
      .replace(
        "#include <clipping_planes_fragment>",
        /* glsl */ `#include <clipping_planes_fragment>
        if (vDepth < ${VISIBLE_DEPTH_M.toFixed(3)}) discard;`,
      )
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `#include <dithering_fragment>
        // A soft pale line along the advancing edge, so the flood reads as a
        // gentle tide creeping over the grass rather than a stain spreading.
        gl_FragColor.rgb = mix(
          gl_FragColor.rgb,
          vec3(0.98, 0.97, 0.94),
          (1.0 - smoothstep(${VISIBLE_DEPTH_M.toFixed(3)}, ${EDGE_FOAM_DEPTH_M.toFixed(3)}, vDepth)) * 0.4
        );
        gl_FragColor.a *= clamp(vDepth * 8.0, 0.72, 1.0);`,
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
        depths[i] = a + (b - a) * blend;
      }

      depthAttribute.needsUpdate = true;
      mesh.visible = true;
    },

    clear() {
      mesh.visible = false;
    },

    dispose() {
      mesh.removeFromParent();
      // The position and index buffers belong to the terrain. Disposing a
      // geometry deletes the GPU buffer of every attribute it holds, shared or
      // not, so detach them first or the ground would lose its mesh.
      geometry.deleteAttribute("position");
      geometry.setIndex(null);
      geometry.dispose();
      floodMaterial.dispose();
    },
  };
}
