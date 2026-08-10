/**
 * Water: rivers, ponds and floodwater share one material.
 *
 * This is the most persuasive thing in the game, and it costs almost nothing.
 * Every river vertex carries an `aReachRisk` attribute fed from the in-channel
 * risk concentration, and the fragment shader mixes clear blue towards silt
 * brown as it rises. The river literally runs turbid below a critical source
 * area and clears as the player fixes it — a result the model computed, not an
 * animation someone authored.
 *
 * Built on MeshToonMaterial so it keeps three's fog, shadows and the shared
 * gradient ramp, and so the curvature patch applies exactly as it does to the
 * ground the water sits on. Water that did not bend with the terrain would
 * float above the valley at distance.
 */

import * as THREE from "three";
import { applyCurvature, type CurvatureUniforms } from "./curvature";

const CLEAR = new THREE.Color(0x63b8e8);
const DEEP = new THREE.Color(0x3583b8);
const SILT = new THREE.Color(0xb08f5e);

/**
 * Risk values between which the water goes from clean to visibly laden.
 *
 * Deliberately spanning almost the whole range. In-channel risk is normalised
 * against a 5th/95th percentile stretch, so by construction the median reach
 * sits near 0.5 — and a narrow band here saturates it, turning the entire river
 * one flat brown. That still responds to the player's work, but only as a slow
 * overall lightening, and it destroys the more useful signal: which reach is
 * worst *right now*, and therefore where to go next.
 */
const SILT_ONSET = 0.1;
const SILT_FULL = 1.0;

/**
 * Silt never fully replaces the water colour.
 *
 * A completely opaque brown stops reading as a river. Holding some blue back
 * keeps even the worst reach looking like water carrying sediment, which is what
 * it is.
 */
const SILT_MAX = 0.82;

export interface WaterMaterial {
  readonly material: THREE.MeshToonMaterial;
  /** Advance the flow animation. */
  update(elapsed: number): void;
  /**
   * Global turbidity floor, 0 clear to 1 fully laden.
   *
   * Driven by the fishery's clarity so that standing water — ponds, floodwater —
   * responds to catchment condition even though it carries no reach risk of its
   * own.
   */
  setTurbidity(value: number): void;
}

export function createWaterMaterial(
  curvature: CurvatureUniforms,
  gradientMap: THREE.Texture,
): WaterMaterial {
  const uTime = { value: 0 };
  const uTurbidity = { value: 0 };

  const material = new THREE.MeshToonMaterial({
    color: 0xffffff,
    gradientMap,
    transparent: true,
    // High enough that the ground beneath does not tint the water brown on its
    // own — the silt term should be the only thing that browns a river.
    opacity: 0.95,
    // Water is a thin surface lying in a valley; writing depth makes it fight
    // the ground it rests on wherever the two nearly coincide.
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uTurbidity = uTurbidity;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        attribute float aReachRisk;
        attribute float aFlow;
        attribute float aBank;
        varying float vReachRisk;
        varying float vFlow;
        varying float vBank;`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        vReachRisk = aReachRisk;
        vFlow = aFlow;
        vBank = aBank;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uTime;
        uniform float uTurbidity;
        varying float vReachRisk;
        varying float vFlow;
        varying float vBank;`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          float silt = max(smoothstep(${SILT_ONSET.toFixed(2)}, ${SILT_FULL.toFixed(2)}, vReachRisk), uTurbidity);

          // Deeper towards the middle of the channel, so the ribbon reads as a
          // body of water rather than a flat painted stripe.
          float depth = 1.0 - abs(vBank);
          vec3 base = mix(vec3(${CLEAR.r.toFixed(3)}, ${CLEAR.g.toFixed(3)}, ${CLEAR.b.toFixed(3)}),
                          vec3(${DEEP.r.toFixed(3)}, ${DEEP.g.toFixed(3)}, ${DEEP.b.toFixed(3)}),
                          depth * 0.8);
          vec3 laden = vec3(${SILT.r.toFixed(3)}, ${SILT.g.toFixed(3)}, ${SILT.b.toFixed(3)});

          // Two travelling waves at different rates read as moving water without
          // a normal map; the toon ramp then quantises them into bands.
          float ripple = sin(vFlow * 1.6 - uTime * 2.4) * 0.5
                       + sin(vFlow * 3.7 - uTime * 3.9) * 0.25;

          diffuseColor.rgb = mix(base, laden, silt * ${SILT_MAX.toFixed(2)}) * (1.0 + ripple * 0.06);

          // Foam at the margins, fading out as the water thickens with sediment.
          float edge = smoothstep(0.72, 1.0, abs(vBank));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 1.0), edge * 0.35 * (1.0 - silt));
        }`,
      );
  };

  applyCurvature(material, curvature, "water");

  return {
    material,
    update(elapsed) {
      uTime.value = elapsed;
    },
    setTurbidity(value) {
      uTurbidity.value = Math.min(1, Math.max(0, value));
    },
  };
}
