/**
 * The soft, matte-plastic finish shared by props and the player.
 *
 * Two pieces, both deliberately cheap:
 *
 * **A material patch** that adds a faint fresnel rim and a broad, low sheen on
 * top of the toon diffuse. Real vinyl toys and painted resin figures pick up a
 * soft pale edge where the surface turns away from you and a wide, dull
 * highlight where it faces the light — never a pin-point specular, which would
 * read as glossy and wet. That pair is most of what "slightly plasticky" means,
 * and it separates a rounded prop from the ground behind it without the hard
 * outline this art direction rules out.
 *
 * **Baked ambient occlusion**, written into a vertex colour attribute once per
 * geometry. Screen-space AO would be a full-screen pass every frame; this is a
 * handful of multiplies at load. It is two terms: contact darkening that fades
 * in over the last metre above the ground (every prop's origin is where it
 * stands), and a gentle darkening of downward-facing surfaces, which is what
 * makes the underside of a canopy or the eaves of a roof read as tucked-in and
 * soft instead of lit from below.
 */

import * as THREE from "three";

export interface SoftFinishOptions {
  /** Strength of the pale fresnel rim. */
  readonly rim?: number;
  /** Strength of the broad sun sheen. */
  readonly sheen?: number;
  /** Tightness of the sheen lobe; low is broad and matte. */
  readonly sheenPower?: number;
}

/**
 * Patch a toon material with the rim and sheen.
 *
 * Chains any existing `onBeforeCompile` and cache key, the same way
 * `applyCurvature` does, so the two can be stacked in either order.
 */
export function applySoftFinish(
  material: THREE.Material,
  variant: string,
  options: SoftFinishOptions = {},
): void {
  const rim = options.rim ?? 0.12;
  const sheen = options.sheen ?? 0.06;
  const sheenPower = options.sheenPower ?? 10;

  const existing = material.onBeforeCompile?.bind(material);
  const existingKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    existing?.(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      /* glsl */ `{
        vec3 cwView = normalize(vViewPosition);
        float cwFacing = saturate(dot(normal, cwView));
        // Rim: a pale lift that follows the object's own colour, so a red roof
        // gets a warm pink edge rather than a grey one.
        float cwRim = pow(1.0 - cwFacing, 2.6) * ${rim.toFixed(3)};
        outgoingLight = mix(outgoingLight, diffuseColor.rgb * 0.35 + vec3(0.72, 0.70, 0.66), cwRim);
        #if NUM_DIR_LIGHTS > 0
          // Broad, low sheen from the sun. Wide enough never to form a spot.
          vec3 cwHalf = normalize(directionalLights[0].direction + cwView);
          float cwSheen = pow(saturate(dot(normal, cwHalf)), ${sheenPower.toFixed(1)}) * ${sheen.toFixed(3)};
          outgoingLight += directionalLights[0].color * cwSheen;
        #endif
      }
      #include <opaque_fragment>`,
    );
  };

  material.customProgramCacheKey = () => `${existingKey?.() ?? ""}|soft:${variant}`;
  material.needsUpdate = true;
}

/** Height over which contact occlusion fades out, in metres above the prop's base. */
const CONTACT_HEIGHT_M = 1.1;
/** Brightness right at the ground line. */
const CONTACT_FLOOR = 0.66;
/** Brightness of a surface facing straight down, relative to one facing up. */
const UNDERSIDE_FLOOR = 0.8;

/**
 * Bake soft occlusion into a `color` attribute.
 *
 * `baseY` is the height of the geometry's origin above the ground, for parts
 * that are built around their own centre and positioned later (the player's
 * limbs). Props built with their origin at ground level pass nothing.
 *
 * Skips geometry that already has colours, so calling it twice is harmless.
 */
export function bakeSoftAo(geometry: THREE.BufferGeometry, baseY = 0): THREE.BufferGeometry {
  if (geometry.getAttribute("color")) return geometry;
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();

  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const colours = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i++) {
    const height = position.getY(i) + baseY;
    const t = Math.min(1, Math.max(0, height / CONTACT_HEIGHT_M));
    const contact = CONTACT_FLOOR + (1 - CONTACT_FLOOR) * t * t * (3 - 2 * t);
    const up = normal.getY(i) * 0.5 + 0.5;
    const underside = UNDERSIDE_FLOOR + (1 - UNDERSIDE_FLOOR) * up;
    const ao = contact * underside;
    // Occlusion is slightly warm rather than grey: bounced light in a crevice
    // has picked up the colour of what is around it, and a warm shade keeps the
    // mood cosy where a neutral one would look sooty.
    colours[i * 3] = ao;
    colours[i * 3 + 1] = ao * 0.985;
    colours[i * 3 + 2] = ao * 0.96;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/**
 * Weld a geometry's vertices and recompute smooth normals.
 *
 * Three's polyhedra and lathed shapes duplicate vertices along seams, so
 * `computeVertexNormals` on them gives faceted or creased shading. The soft
 * look needs one normal per point on the surface.
 */
export function smoothNormals(geometry: THREE.BufferGeometry, tolerance = 1e-4): THREE.BufferGeometry {
  const positions = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const count = index ? index.count : positions.count;

  const key = (i: number): string =>
    `${Math.round(positions.getX(i) / tolerance)},${Math.round(positions.getY(i) / tolerance)},${Math.round(positions.getZ(i) / tolerance)}`;

  const welded = new Map<string, number>();
  const unique: number[] = [];
  const newIndex = new Uint32Array(count);

  for (let n = 0; n < count; n++) {
    const source = index ? index.getX(n) : n;
    const k = key(source);
    let target = welded.get(k);
    if (target === undefined) {
      target = unique.length / 3;
      welded.set(k, target);
      unique.push(positions.getX(source), positions.getY(source), positions.getZ(source));
    }
    newIndex[n] = target;
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(unique, 3));
  result.setIndex(new THREE.BufferAttribute(newIndex, 1));
  result.computeVertexNormals();
  geometry.dispose();
  return result;
}
