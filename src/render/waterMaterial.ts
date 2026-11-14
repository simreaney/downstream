/**
 * Water: rivers, ponds and floodwater share one material.
 *
 * This is the most persuasive thing in the game, and it costs almost nothing.
 * Every river vertex carries an `aReachRisk` attribute fed from the in-channel
 * risk concentration, and the fragment shader mixes clear water towards a soft
 * latte silt as it rises. The river literally runs cloudy below a critical
 * source area and clears as the player fixes it — a result the model computed,
 * not an animation someone authored. The silt is deliberately a warm pastel
 * rather than a muddy brown: the damage has to be legible, never grim.
 *
 * ## How flow is drawn
 *
 * Four layers, each answering a different question about the water:
 *
 * - **Foam flecks** (rivers only) — short pale flecks in lanes down the
 *   channel, the classic toy-diorama river. They are laid out in *travel time*
 *   (`aTravel`, seconds from the head of the reach at the local velocity)
 *   rather than distance, so they move at the local speed and stretch out where
 *   the channel steepens, the way real tracers do. Centre lanes run faster than
 *   lanes near the banks — the velocity profile of an open channel. Each lane's
 *   speed factor is constant across the lane, which is what stops the pattern
 *   shearing itself apart as time runs on.
 * - **Sediment plumes** — silt is drawn as caramel clouds drifting in the
 *   water, advected the same way as the ripples below, over a thinner haze.
 *   A laden reach keeps its water colour between plumes, so it reads as
 *   cloudy water rather than as a sandy path, and the drift shows direction.
 *   The colour goes from blue to caramel by way of a murky sage green, not in
 *   a straight line: see `MURKY_SHALLOW`.
 * - **Sparkle** — pin-point glints that twinkle where two fine noise fields
 *   cross, one riding the current and one drifting. It is the only sharp,
 *   bright detail on the surface, and what says "wet" where everything else
 *   says "blue".
 * - **Advected ripples** — soft value noise pushed along `aDir`, a world-space
 *   velocity, using the two-phase flow-map blend (two copies of the pattern half
 *   a cycle apart, crossfaded so neither's reset is ever visible). The river
 *   passes its channel direction, floodwater its downslope direction, and
 *   ponds nothing — so still water only drifts.
 * - **Soft banks** — pale foam at the margins, wobbled by the ripples, and an
 *   alpha fade over the last few percent of the width so the water melts into
 *   the grass instead of ending at a cut line.
 *
 * Built on MeshToonMaterial so it keeps three's fog, shadows and the shared
 * gradient ramp, and so the curvature patch applies exactly as it does to the
 * ground the water sits on. Water that did not bend with the terrain would
 * float above the valley at distance.
 */

import * as THREE from "three";
import { applyCurvature, type CurvatureUniforms } from "./curvature";
import { GLSL_NOISE, glslColour } from "./glsl";

const SHALLOW = 0x9fe2e0;
const DEEP = 0x63b1e6;
/**
 * The colour of half-laden water: a murky sage.
 *
 * Blue and caramel are near-complements, so mixing them directly passes
 * through grey — and in-channel risk is stretched so the median reach sits
 * near the middle of the range. Most of the river was therefore drawn in the
 * one colour the palette has no use for, and a pale grey ribbon with white
 * dashes down it reads as a road. Real water takes the green route as it
 * picks up sediment, and so does this: clean blue, then sage, then caramel.
 */
const MURKY_SHALLOW = 0xb7dcb4;
const MURKY_DEEP = 0x8fc3a4;
/**
 * Fully laden water. A warm caramel, kept a clear step deeper than the tilled
 * earth of an arable field (`COVER_COLOURS` in `terrainMaterial.ts`), which is
 * the ground a silted river most often runs through — at the same value the
 * two merge and the river disappears exactly where it matters most.
 */
const SILT_SHALLOW = 0xdcb98a;
const SILT_DEEP = 0xc49a62;
const FOAM = 0xfbfdff;
const SKY_TINT = 0xeaf4fb;

/**
 * Risk values between which the water goes from clean to visibly laden.
 *
 * Deliberately spanning almost the whole range. In-channel risk is normalised
 * against a 5th/95th percentile stretch, so by construction the median reach
 * sits near 0.5 — and a narrow band here saturates it, turning the entire river
 * one flat colour. That still responds to the player's work, but only as a slow
 * overall lightening, and it destroys the more useful signal: which reach is
 * worst *right now*, and therefore where to go next.
 */
const SILT_ONSET = 0.1;
const SILT_FULL = 1.0;

/**
 * Silt never fully replaces the water colour.
 *
 * A completely opaque latte stops reading as a river — in pastel, a sandy tan
 * ribbon reads as a footpath. This caps the thickest plume; between plumes the
 * haze is well under half this (see `PLUME_FLOOR`), so even the worst reach
 * keeps enough of its blue to be unmistakably water carrying sediment.
 */
const SILT_MAX = 0.8;

/** Sediment plume wavelength (reciprocal metres), and the silt haze between plumes. */
const PLUME_FREQUENCY = 0.11;
const PLUME_FLOOR = 0.42;

/** Fleck lanes across the channel. */
const STREAK_LANES = 5;

/**
 * Seconds of travel time per fleck cycle, and the fraction of a cycle that is
 * fleck.
 *
 * Short on both counts. At seven seconds and half a cycle each mark was four
 * or five metres long and a hand's width across: a lane marking. At these
 * values a fleck is about a metre of foam, and there are more of them.
 */
const STREAK_PERIOD_S = 2.6;
const STREAK_DUTY = 0.34;

/** Sparkle lattice, in reciprocal metres, and how much of the surface glints. */
const SPARKLE_FREQUENCY = 4.5;
const SPARKLE_STRENGTH = 0.7;

/**
 * Visual speed-up on the model's velocities.
 *
 * Honest river velocities are around a metre a second, which from a diorama
 * camera thirty metres up reads as barely moving. Doubling it reads as a lively
 * stream without tipping into a cartoon torrent; storms raise it further via
 * `setFlowRate`.
 */
const VISUAL_SPEED = 2.0;

/** Seconds per flow-map cycle; long enough that the crossfade never pulses. */
const RIPPLE_CYCLE_S = 3.0;

/**
 * Metres per pixel over which each layer fades out: streaks (a few tens of
 * centimetres across) first, the broad ripples much later.
 *
 * By pixel footprint rather than by distance from the camera, as for the
 * ground (see `groundPatterns.ts`): with a zoomable camera, "far" stops meaning
 * "small on screen", and a distance fade would switch the flow off the moment
 * the player pulled back to watch a whole river run.
 */
const STREAK_FADE_MPP: [number, number] = [0.1, 0.26];
const SPARKLE_FADE_MPP: [number, number] = [0.05, 0.16];
const RIPPLE_FADE_MPP: [number, number] = [0.45, 1.1];

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
  /**
   * Multiplier on how fast the surface runs, 1 at base flow.
   *
   * Integrated into the animation phase rather than applied to time, so a
   * change of rate speeds the water up instead of making every streak jump.
   */
  setFlowRate(value: number): void;
}


export function createWaterMaterial(
  curvature: CurvatureUniforms,
  gradientMap: THREE.Texture,
): WaterMaterial {
  const uTime = { value: 0 };
  const uPhase = { value: 0 };
  const uFlowRate = { value: 1 };
  const uTurbidity = { value: 0 };
  let lastElapsed: number | null = null;

  const material = new THREE.MeshToonMaterial({
    color: 0xffffff,
    gradientMap,
    transparent: true,
    // High enough that the ground beneath does not tint the water on its own —
    // the silt term should be the only thing that clouds a river.
    opacity: 0.94,
    // Water is a thin surface lying in a valley; writing depth makes it fight
    // the ground it rests on wherever the two nearly coincide.
    depthWrite: false,
    side: THREE.DoubleSide,
    // Without this, three draws a transparent double-sided material twice a
    // frame — back faces, then front — rebuilding its program state for each.
    // Water is a sheet seen from above; one pass is all it ever needed.
    forceSinglePass: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uPhase = uPhase;
    shader.uniforms.uFlowRate = uFlowRate;
    shader.uniforms.uTurbidity = uTurbidity;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        attribute float aReachRisk;
        attribute float aBank;
        attribute float aTravel;
        attribute vec2 aDir;
        varying float vReachRisk;
        varying float vBank;
        varying float vTravel;
        varying vec2 vDir;
        varying vec2 vWaterWorld;`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        vReachRisk = aReachRisk;
        vBank = aBank;
        vTravel = aTravel;
        vDir = aDir;
        {
          vec4 cwWorld = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cwWorld = instanceMatrix * cwWorld;
          #endif
          vWaterWorld = (modelMatrix * cwWorld).xz;
        }`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uTime;
        uniform float uPhase;
        uniform float uFlowRate;
        uniform float uTurbidity;
        varying float vReachRisk;
        varying float vBank;
        varying float vTravel;
        varying vec2 vDir;
        varying vec2 vWaterWorld;

        ${GLSL_NOISE}

        // Two octaves of ripple at a world position.
        float cwRipple(vec2 p) {
          return cwNoise(p * 0.32) * 0.62 + cwNoise(p * 0.9 + 17.3) * 0.38;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          float silt = max(smoothstep(${SILT_ONSET.toFixed(2)}, ${SILT_FULL.toFixed(2)}, vReachRisk), uTurbidity);
          float edge = clamp(abs(vBank), 0.0, 1.0);
          float depth = 1.0 - edge;
          float metresPerPixel = max(length(dFdx(vWaterWorld)), length(dFdy(vWaterWorld)));
          float streaksShown = 1.0 - smoothstep(${STREAK_FADE_MPP[0].toFixed(2)}, ${STREAK_FADE_MPP[1].toFixed(2)}, metresPerPixel);
          float ripplesShown = 1.0 - smoothstep(${RIPPLE_FADE_MPP[0].toFixed(2)}, ${RIPPLE_FADE_MPP[1].toFixed(2)}, metresPerPixel);
          float sparkleShown = 1.0 - smoothstep(${SPARKLE_FADE_MPP[0].toFixed(2)}, ${SPARKLE_FADE_MPP[1].toFixed(2)}, metresPerPixel);

          // --- Advected ripples (two-phase flow map) ---
          float speed = length(vDir);
          vec2 drift = vec2(0.13, 0.07) * uTime;
          float cycle = uPhase / ${RIPPLE_CYCLE_S.toFixed(1)};
          float phaseA = fract(cycle);
          float phaseB = fract(cycle + 0.5);
          float weightA = 1.0 - abs(1.0 - 2.0 * phaseA);
          vec2 offsetA = vDir * phaseA * ${RIPPLE_CYCLE_S.toFixed(1)};
          vec2 offsetB = vDir * phaseB * ${RIPPLE_CYCLE_S.toFixed(1)};
          float ripple = mix(
            cwRipple(vWaterWorld - offsetB + drift + 31.7),
            cwRipple(vWaterWorld - offsetA + drift),
            weightA
          );
          // Sediment plumes: the same advection at a much longer wavelength,
          // so clouds of silt drift downstream with the current.
          float plume = mix(
            cwNoise((vWaterWorld - offsetB + drift * 0.5) * ${PLUME_FREQUENCY.toFixed(3)} + 5.3),
            cwNoise((vWaterWorld - offsetA + drift * 0.5) * ${PLUME_FREQUENCY.toFixed(3)}),
            weightA
          );

          // Lighter and greener at the margins, deeper blue mid-channel, so the
          // ribbon reads as a body of water with a bed rather than a painted stripe.
          float body = smoothstep(0.0, 0.85, depth);
          vec3 clean = mix(${glslColour(SHALLOW)}, ${glslColour(DEEP)}, body);
          vec3 murky = mix(${glslColour(MURKY_SHALLOW)}, ${glslColour(MURKY_DEEP)}, body);
          vec3 laden = mix(${glslColour(SILT_SHALLOW)}, ${glslColour(SILT_DEEP)}, body);
          // Silt clouds the water rather than repainting it: a haze everywhere,
          // thickening into plumes. The water keeps its own hue between them,
          // so a laden reach reads as water carrying sediment — and the moving
          // plumes show which way it is carrying it.
          float cloud = silt * mix(${PLUME_FLOOR.toFixed(2)}, 1.0, smoothstep(0.3, 0.72, plume));
          float load = cloud * ${SILT_MAX.toFixed(2)};
          vec3 water = load < 0.5
            ? mix(clean, murky, load * 2.0)
            : mix(murky, laden, load * 2.0 - 1.0);

          // Soft light on the crests, soft shade in the troughs; stronger where
          // the water is moving, so a pond is calm and a riffle glitters.
          float rippleStrength = mix(0.11, 0.2, clamp(speed * 0.5, 0.0, 1.0)) * mix(0.5, 1.0, ripplesShown);
          water *= 1.0 + (ripple - 0.5) * rippleStrength * 2.0;
          float glint = smoothstep(0.58, 0.8, ripple) * 0.32 * (1.0 - silt * 0.4) * mix(0.4, 1.0, ripplesShown);
          water = mix(water, ${glslColour(FOAM)}, glint);

          // --- Sparkle ---
          // Two fine fields, one carried by the current and one drifting
          // against it; a glint is where both peak at once, so each lasts a
          // moment and the set never repeats. Thinned over silt (cloudy water
          // does not glitter) and near the banks.
          {
            vec2 sparkleAt = vWaterWorld * ${SPARKLE_FREQUENCY.toFixed(2)};
            float carried = cwNoise(sparkleAt - (offsetA + offsetB) * 0.5 * ${SPARKLE_FREQUENCY.toFixed(2)} + drift * 2.0);
            float crossing = cwNoise(sparkleAt * 1.37 + vec2(-0.9, 0.6) * uTime + 41.0);
            // The product of two noises peaks rarely: this keeps a few percent
            // of the surface, as points, where a lower threshold gave blotches.
            float sparkle = smoothstep(0.56, 0.64, carried * crossing);
            water = mix(
              water,
              ${glslColour(FOAM)},
              sparkle * ${SPARKLE_STRENGTH.toFixed(2)} * sparkleShown * (1.0 - silt * 0.6) * (1.0 - smoothstep(0.6, 0.9, edge))
            );
          }

          // --- Flow streaks (rivers only; ponds and floods pass aTravel < 0) ---
          // Computed unconditionally and masked, because fwidth() inside a
          // branch is undefined in GLSL.
          {
            float laneCoord = (clamp(vBank, -1.0, 1.0) * 0.5 + 0.5) * ${STREAK_LANES.toFixed(1)};
            float lane = min(floor(laneCoord), ${(STREAK_LANES - 1).toFixed(1)});
            float laneF = laneCoord - lane;
            // Open-channel velocity profile, evaluated at the lane's centre so it
            // is constant across the lane.
            float laneBank = ((lane + 0.5) / ${STREAK_LANES.toFixed(1)}) * 2.0 - 1.0;
            float profile = 1.0 - 0.4 * laneBank * laneBank;

            float laneSeed = cwHash(vec2(lane, 7.0));
            float q = (vTravel / profile - uPhase) / ${STREAK_PERIOD_S.toFixed(2)} + laneSeed * 5.0;
            float slot = floor(q);
            float along = fract(q);
            float slotHash = cwHash(vec2(slot, lane + 3.0));

            // Faster water carries more streaks: a riffle is busier than a glide.
            float density = mix(0.45, 0.85, clamp((speed - 0.5) * 0.6, 0.0, 1.0));
            float present = step(1.0 - density, slotHash);

            // Each streak is a fleck of foam, not a painted line: its length
            // varies, it sits off-centre in its lane, and it tapers to a point
            // at both ends. Evenly spaced constant-width dashes in lanes read
            // as road markings.
            float duty = ${STREAK_DUTY.toFixed(2)} * mix(0.45, 1.0, cwHash(vec2(slot, lane + 19.0)));
            float u = clamp(along / duty, 0.0, 1.0);
            float aa = max(fwidth(q), 0.002) * 1.5 / duty;
            float dash = smoothstep(0.0, aa, u) * (1.0 - smoothstep(1.0 - aa, 1.0, u));
            float taper = sqrt(max(sin(u * 3.14159), 0.0));
            float wobble = (cwHash(vec2(slot, lane + 11.0)) - 0.5) * 0.5;
            float across = 1.0 - smoothstep(0.04, 0.04 + 0.22 * taper, abs(laneF - 0.5 - wobble));
            float streak = dash * across * present * (1.0 - smoothstep(0.7, 0.92, edge)) * streaksShown
                         * step(0.0, vTravel);
            water = mix(water, ${glslColour(FOAM)}, streak * mix(0.5, 0.34, silt));
          }

          // --- Soft banks ---
          // A narrow lapping line, not a margin: at a quarter of the width on
          // each side, the foam was a pale kerb either side of the water.
          float foamLine = 0.84 + (ripple - 0.5) * 0.16;
          float foam = smoothstep(foamLine, foamLine + 0.07, edge) * (1.0 - smoothstep(0.95, 1.0, edge));
          water = mix(water, ${glslColour(FOAM)}, foam * mix(0.6, 0.36, silt));

          // A little of the pale sky at grazing angles, for the soft sheen of a
          // surface rather than the flat colour of a floor.
          // abs(), because the material is double-sided and vNormal may face away.
          float fresnel = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(vNormal))), 3.0);
          water = mix(water, ${glslColour(SKY_TINT)}, fresnel * 0.2);

          diffuseColor.rgb = water;
          diffuseColor.a *= 1.0 - smoothstep(0.93, 1.0, edge);
        }`,
      );
  };

  applyCurvature(material, curvature, "water");

  return {
    material,
    update(elapsed) {
      const dt = lastElapsed === null ? 0 : Math.max(0, elapsed - lastElapsed);
      lastElapsed = elapsed;
      uTime.value = elapsed;
      uPhase.value += dt * uFlowRate.value * VISUAL_SPEED;
      // Keep the phase small enough for float32 in the shader. Wrapping costs a
      // single jump in the pattern every few hours of play.
      if (uPhase.value > 36000) uPhase.value -= 36000;
    },
    setTurbidity(value) {
      uTurbidity.value = Math.min(1, Math.max(0, value));
    },
    setFlowRate(value) {
      uFlowRate.value = Math.max(0, value);
    },
  };
}
