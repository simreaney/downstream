/**
 * Gradient sky dome.
 *
 * A large inverted sphere with a two-stop vertical gradient, rather than a flat
 * background colour. The horizon band is what sells the curved world: as terrain
 * bends away it reveals sky beneath itself, and a flat clear colour there makes
 * the edge of the world look like a cut rather than a horizon.
 *
 * Deliberately not curvature-patched. The dome is drawn as a backdrop and must
 * stay put while the ground bends past it; bending the sky too would cancel out
 * the effect entirely.
 */

import * as THREE from "three";

const VERTEX = /* glsl */ `
varying vec3 vWorldDirection;
void main() {
  vWorldDirection = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  // Force the dome to the far plane so it can never intersect terrain, whatever
  // the camera does.
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
varying vec3 vWorldDirection;

void main() {
  float h = vWorldDirection.y;
  // Two separate ramps meeting at the horizon: a wide soft one into the zenith,
  // and a tight one below, so the horizon line stays crisp from any angle.
  vec3 colour = h > 0.0
    ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55))
    : mix(uHorizon, uGround, pow(clamp(-h, 0.0, 1.0), 0.35));
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}`;

export interface Sky {
  readonly mesh: THREE.Mesh;
  /** Blend towards storm colours; 0 is clear, 1 is a full downpour. */
  setStorminess(value: number): void;
}

const CLEAR_ZENITH = new THREE.Color(0x3f8fd4);
const CLEAR_HORIZON = new THREE.Color(0xcfe9f5);
const CLEAR_GROUND = new THREE.Color(0x8aa06a);

const STORM_ZENITH = new THREE.Color(0x394352);
const STORM_HORIZON = new THREE.Color(0x8e97a0);
const STORM_GROUND = new THREE.Color(0x4f5646);

export function createSky(scene: THREE.Scene): Sky {
  const uniforms = {
    uZenith: { value: CLEAR_ZENITH.clone() },
    uHorizon: { value: CLEAR_HORIZON.clone() },
    uGround: { value: CLEAR_GROUND.clone() },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  mesh.frustumCulled = false;
  // Drawn first, so the terrain overwrites it rather than blending against it.
  mesh.renderOrder = -1000;
  scene.add(mesh);

  return {
    mesh,
    setStorminess(value) {
      const t = Math.min(1, Math.max(0, value));
      uniforms.uZenith.value.copy(CLEAR_ZENITH).lerp(STORM_ZENITH, t);
      uniforms.uHorizon.value.copy(CLEAR_HORIZON).lerp(STORM_HORIZON, t);
      uniforms.uGround.value.copy(CLEAR_GROUND).lerp(STORM_GROUND, t);
      scene.fog?.color.copy(uniforms.uHorizon.value);
    },
  };
}
