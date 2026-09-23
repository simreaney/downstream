/**
 * Sun, sky fill, and a shadow camera that follows the player.
 *
 * Lit like a bright overcast day. Almost all of the light comes from the
 * hemisphere — a warm white sky above and a soft sunlit-meadow bounce below —
 * and the directional sun is kept weak, there to give forms a gentle roll and
 * to cast a faint, feathered shadow, never a hard dark one. With the smooth
 * high-floored ramp in `toonRamp.ts`, that is what keeps the whole world
 * high-key and approachable: nothing in it is ever lit from one side and black
 * on the other.
 *
 * The shadow camera is the interesting part. A single orthographic camera
 * covering all 1 km² of catchment would spread a 2048px map over a million
 * square metres — about half a metre per texel, so a tree's shadow would be four
 * blurry pixels. Instead the camera covers a small box around the player and
 * travels with them. Distant terrain simply goes unshadowed, which nobody
 * notices because the shadows are faint to begin with and the baked openness
 * term in `terrainData.ts` supplies the landform's soft occlusion everywhere.
 */

import * as THREE from "three";
import { isLowPower } from "../config";

/**
 * Half-width of the shadowed region around the player, in metres, at the
 * default zoom — and the largest it grows to when the camera pulls back.
 */
const SHADOW_RADIUS_M = 60;
const SHADOW_RADIUS_MAX_M = 420;

/** Shadowed half-width per metre of camera distance, when zoomed out. */
const SHADOW_RADIUS_PER_CAMERA_M = 2.4;

/**
 * Shadow map resolution, halved on low-power devices.
 *
 * Shadows here are deliberately blurred by a wide PCF radius, so the fallback
 * costs almost nothing visually and a quarter of the shadow pass.
 */
const SHADOW_MAP_SIZE = isLowPower() ? 1024 : 2048;

/**
 * How dark a fully shadowed surface gets, as a fraction of the sun it loses.
 *
 * Below 1 so a shadow tints rather than blacks out. At this value a tree's
 * shadow on grass reads as a soft cool patch — present, grounding, and nowhere
 * near the pools of dark green the previous lighting put under every wood.
 */
const SHADOW_INTENSITY = 0.5;

/** PCF filter radius, in shadow-map texels. Wide, for overcast-soft edges. */
const SHADOW_SOFTNESS = 6;

const SUN_COLOUR = 0xfff3e2;
const SUN_INTENSITY = 2.0;

/**
 * Sky and ground fill.
 *
 * Both warm: a cream-white sky rather than blue, because an overcast sky is
 * white and a blue fill would cool every shadow towards grey; and a pale
 * butter bounce from below, which keeps the undersides of canopies and eaves
 * soft and sunny rather than murky.
 */
const SKY_COLOUR = 0xfdf8ef;
const GROUND_COLOUR = 0xe9dfc2;
const SKY_INTENSITY = 1.3;

export interface Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly sky: THREE.HemisphereLight;
  /** Keep the shadow camera centred on a moving target. */
  follow(target: THREE.Vector3): void;
  /**
   * Size the shadowed region to the camera's distance, so a zoomed-out view
   * is not shadowed only in a small square round the player's feet. The map
   * keeps its resolution, so shadows soften as the region grows — which, from
   * that far back, is also what they should do.
   */
  setShadowReach(cameraDistance: number): void;
}

export function createLighting(scene: THREE.Scene): Lighting {
  const sun = new THREE.DirectionalLight(SUN_COLOUR, SUN_INTENSITY);
  // About 42 degrees up. Higher reads more overcast, but with the camera
  // looking down on the landscape it also lights every gentle slope the same,
  // and the valley goes flat; at this height slopes facing away from the sun
  // roll softly darker, while the faint, feathered shadows stay short enough to
  // read as contact shading rather than silhouettes thrown across the ground.
  sun.position.set(-150, 172, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 560;
  sun.shadow.camera.left = -SHADOW_RADIUS_M;
  sun.shadow.camera.right = SHADOW_RADIUS_M;
  sun.shadow.camera.top = SHADOW_RADIUS_M;
  sun.shadow.camera.bottom = -SHADOW_RADIUS_M;
  // Terrain is a huge, gently curved surface, so depth precision is tight and
  // ordinary bias produces either acne on the flats or peter-panning on slopes.
  // Normal bias offsets along the surface normal instead, which handles both.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = SHADOW_SOFTNESS;
  sun.shadow.intensity = SHADOW_INTENSITY;

  scene.add(sun);
  scene.add(sun.target);

  const sky = new THREE.HemisphereLight(SKY_COLOUR, GROUND_COLOUR, SKY_INTENSITY);
  scene.add(sky);

  const offset = sun.position.clone();
  let shadowRadius = SHADOW_RADIUS_M;
  /** How far the shadow camera stands back, as a multiple of `offset`; grows with the region. */
  let reach = 1;
  const baseFar = sun.shadow.camera.far;

  // The shadow map's texel grid lies in the light's frame, not the world's.
  // These are that frame's axes, as three's lookAt builds them: z back towards
  // the sun, x = up × z, y = z × x.
  const axisX = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const snapped = new THREE.Vector3();

  return {
    sun,
    sky,

    follow(target) {
      // Snap the shadow camera to whole texels. Without this the shadow map
      // resamples every frame as the player walks and every shadow edge crawls,
      // which is far more distracting than a slightly stale shadow position.
      //
      // Snapped along the light's own x and y axes. Rounding world x and z, as
      // this first did, moves the map by a fraction of a texel per step because
      // the light looks down at an angle — and left height changes unsnapped
      // entirely — so edges still shimmered as the player walked.
      const texelSize = (2 * shadowRadius) / SHADOW_MAP_SIZE;
      axisZ.copy(offset).normalize();
      axisX.crossVectors(worldUp, axisZ).normalize();
      axisY.crossVectors(axisZ, axisX);
      const alongX = target.dot(axisX);
      const alongY = target.dot(axisY);
      snapped
        .copy(target)
        .addScaledVector(axisX, Math.round(alongX / texelSize) * texelSize - alongX)
        .addScaledVector(axisY, Math.round(alongY / texelSize) * texelSize - alongY);

      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(offset, reach);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    },

    setShadowReach(cameraDistance) {
      const wanted = Math.min(
        SHADOW_RADIUS_MAX_M,
        Math.max(SHADOW_RADIUS_M, cameraDistance * SHADOW_RADIUS_PER_CAMERA_M),
      );
      // Resized in 15% steps, not continuously: every resize moves the texel
      // grid, and a grid that moved every frame of a zoom would make every
      // shadow edge swim.
      if (Math.abs(Math.log(wanted / shadowRadius)) < 0.14) return;
      shadowRadius = wanted;
      // Stand further back as the region grows, or ground far off towards the
      // sun ends up behind the shadow camera's near plane and casts nothing.
      reach = Math.max(1, (shadowRadius / SHADOW_RADIUS_M) * 0.75);
      const shadowCamera = sun.shadow.camera;
      shadowCamera.left = -shadowRadius;
      shadowCamera.right = shadowRadius;
      shadowCamera.top = shadowRadius;
      shadowCamera.bottom = -shadowRadius;
      shadowCamera.far = baseFar * reach;
      shadowCamera.updateProjectionMatrix();
    },
  };
}
