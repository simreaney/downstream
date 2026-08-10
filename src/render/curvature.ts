/**
 * The curved world.
 *
 * Animal Crossing's signature look: the ground falls away with distance as if
 * you were standing on a small planet, so the horizon curves and distant terrain
 * tucks under itself. It makes a modest catchment feel like a whole world and
 * keeps the eye on what is near the player.
 *
 * The bend is applied in **view space**, as a function of distance from the
 * camera, and only to `gl_Position`. Two consequences follow, and both are the
 * reason this lives in exactly one module.
 *
 * ## Lighting is left alone
 *
 * `mvPosition` is copied before bending rather than modified, so `vViewPosition`
 * — which three derives from it for the lighting calculations — keeps the true
 * geometry. Bending it too would make a hillside's shading drift as the player
 * walked towards it, which reads as the sun moving.
 *
 * ## Shadows need no patching at all
 *
 * This is worth stating because the opposite is the intuitive conclusion. The
 * shadow map is rendered from the light's point of view, and the curvature is a
 * function of the *camera's* view space — a quantity with no meaning in the
 * light's. Applying it there would warp the depth map by an unrelated amount and
 * genuinely would detach shadows.
 *
 * Leaving the depth pass alone is correct, because the shadow lookup never goes
 * through `gl_Position`. Three computes `vShadowCoord` from the undistorted
 * world position, so the shadow pattern is resolved in true world space and then
 * painted onto the surface. Caster and receiver are bent by the same amount at
 * the same distance, so the shadow travels with its caster for free.
 */

import * as THREE from "three";

export interface CurvatureUniforms {
  /** x bends sideways, y drops with distance ahead and behind. */
  readonly uCurvature: { value: THREE.Vector2 };
}

/**
 * Strength of the bend, in metres of drop per metre squared of distance.
 *
 * Tuned against the 1 km catchment: the far divide sits about 25 m lower than
 * flat projection would put it, which is enough to read as a curved world
 * without the middle distance visibly sagging while the player walks over it.
 */
export const DEFAULT_CURVATURE = new THREE.Vector2(0.00028, 0.00055);

export function createCurvatureUniforms(
  strength: THREE.Vector2 = DEFAULT_CURVATURE,
): CurvatureUniforms {
  return { uCurvature: { value: strength.clone() } };
}

/**
 * Bend a material's output, sharing `uniforms` with every other world material.
 *
 * Appends to `#include <project_vertex>` rather than replacing it, so this stays
 * correct across three.js versions that reword the chunk internally — all it
 * relies on is `mvPosition` being in scope afterwards, which it has been since
 * the chunk existed.
 */
export function applyCurvature(
  material: THREE.Material,
  uniforms: CurvatureUniforms,
  variant: string,
): void {
  const existing = material.onBeforeCompile?.bind(material);
  const existingKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    existing?.(shader, renderer);

    shader.uniforms.uCurvature = uniforms.uCurvature;
    shader.vertexShader = `uniform vec2 uCurvature;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      /* glsl */ `#include <project_vertex>
      {
        // Scoped copy: mvPosition itself must survive untouched for vViewPosition.
        vec4 cwCurved = mvPosition;
        cwCurved.y -= uCurvature.y * cwCurved.z * cwCurved.z;
        cwCurved.y -= uCurvature.x * cwCurved.x * cwCurved.x;
        gl_Position = projectionMatrix * cwCurved;
      }`,
    );
  };

  // Three caches compiled programs by material type and defines, which cannot
  // see shader edits made in onBeforeCompile. Two materials of the same class
  // patched differently — the terrain, which also injects the risk overlay, and
  // a plain curved prop — would otherwise be handed each other's program. The
  // variant name is what keeps them apart, so every caller must pass a distinct
  // one for a distinct set of edits.
  material.customProgramCacheKey = () => `${existingKey?.() ?? ""}|curved:${variant}`;
  material.needsUpdate = true;
}
