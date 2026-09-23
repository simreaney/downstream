/**
 * See-through props between the camera and the player.
 *
 * The diorama camera sits well back and well up, so a tree or cottage between
 * it and the player hides the character outright — and with woods drawn as big
 * soft crowns, that happens constantly. Any prop fragment close to the line of
 * sight from the camera to the player is dithered away, leaving a soft
 * stippled window through the canopy with the player in it.
 *
 * Dithered discard rather than transparency because every prop is opaque and
 * instanced: making a batch transparent would need sorting per instance and
 * would lose depth writes for all four thousand trees to fix the few in the
 * way. Discard costs a handful of ALU per prop fragment and nothing else. The
 * shadow pass uses three's own depth material, so a faded tree still casts its
 * full shadow — the world does not visibly change, only the view into it.
 */

import * as THREE from "three";

/** Radius of the see-through window around the sight line, in metres. */
const WINDOW_RADIUS_M = 3.4;

/** Distance in front of the player where fading stops, so the player's own neighbourhood stays solid. */
const KEEP_NEAR_TARGET_M = 2.2;

export interface OcclusionFade {
  readonly uFadeCamera: { value: THREE.Vector3 };
  readonly uFadeTarget: { value: THREE.Vector3 };
  /** Set the two ends of the sight line, in world space. */
  set(camera: THREE.Vector3, target: THREE.Vector3): void;
}

export function createOcclusionFade(): OcclusionFade {
  const uFadeCamera = { value: new THREE.Vector3(0, 1e5, 0) };
  const uFadeTarget = { value: new THREE.Vector3(0, 1e5 + 1, 0) };
  return {
    uFadeCamera,
    uFadeTarget,
    set(camera, target) {
      uFadeCamera.value.copy(camera);
      uFadeTarget.value.copy(target);
    },
  };
}

/**
 * Patch a material to dither out fragments near the sight line.
 *
 * Chains existing patches and cache keys like `applyCurvature`.
 */
export function applyOcclusionFade(material: THREE.Material, fade: OcclusionFade): void {
  const existing = material.onBeforeCompile?.bind(material);
  const existingKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    existing?.(shader, renderer);
    shader.uniforms.uFadeCamera = fade.uFadeCamera;
    shader.uniforms.uFadeTarget = fade.uFadeTarget;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFadeWorld;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        {
          vec4 cwFadeWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cwFadeWorld = instanceMatrix * cwFadeWorld;
          #endif
          vFadeWorld = (modelMatrix * cwFadeWorld).xyz;
        }`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uFadeCamera;\nuniform vec3 uFadeTarget;\nvarying vec3 vFadeWorld;",
      )
      .replace(
        "#include <clipping_planes_fragment>",
        /* glsl */ `#include <clipping_planes_fragment>
        {
          vec3 cwSight = uFadeTarget - uFadeCamera;
          float cwLength = max(length(cwSight), 1e-3);
          float cwT = clamp(dot(vFadeWorld - uFadeCamera, cwSight) / (cwLength * cwLength), 0.0, 1.0);
          float cwMiss = length(vFadeWorld - (uFadeCamera + cwSight * cwT));
          float cwBeforeTarget = (1.0 - cwT) * cwLength;
          float cwFade = (1.0 - smoothstep(${(WINDOW_RADIUS_M * 0.55).toFixed(2)}, ${WINDOW_RADIUS_M.toFixed(2)}, cwMiss))
                       * smoothstep(${(KEEP_NEAR_TARGET_M * 0.6).toFixed(2)}, ${KEEP_NEAR_TARGET_M.toFixed(2)}, cwBeforeTarget);
          // Interleaved gradient noise: a fine, even stipple with no visible
          // pattern, which at a device pixel ratio of 2 reads as translucency.
          float cwDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (cwFade * 0.88 > cwDither) discard;
        }`,
      );
  };

  material.customProgramCacheKey = () => `${existingKey?.() ?? ""}|fade`;
  material.needsUpdate = true;
}
