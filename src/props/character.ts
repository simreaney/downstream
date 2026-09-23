/**
 * The player avatar.
 *
 * Chibi proportions: a head nearly as tall as everything below it, a small
 * rounded body, stubby limbs, no neck, and a simple face — two dark eyes with
 * catchlights and a blush on each cheek. The head is deliberately oversized — it
 * is what the player tracks at distance, and from the high diorama camera it is
 * most of what the character's silhouette is. The leaf sprout on top is there
 * for the same reason: the camera looks down on the crown of the head more than
 * at the face, so the crown gets something to say.
 *
 * Returned as a Group rather than instanced parts, because there is exactly one
 * of these and its limbs need to move independently for the walk cycle. Limbs
 * hang from pivot groups at the hip and shoulder so they swing from the joint
 * rather than rotating about their own middle.
 */

import * as THREE from "three";
import { applyCurvature } from "../render/curvature";
import { bakeSoftAo } from "../render/softFinish";
import type { PropContext } from "./types";

export interface Character {
  readonly root: THREE.Group;
  /** Drive the walk cycle. `speed` is metres per second. */
  animate(elapsed: number, speed: number): void;
}

const SKIN = 0xf8d6bc;
const SHIRT = 0x9fd8bd;
const TROUSERS = 0x9fb8e2;
const SHOES = 0xe9a58f;
const HAIR = 0xc98a62;
const EYE = 0x4a3b36;
const CATCHLIGHT = 0xffffff;
const BLUSH = 0xf6aeae;
const LEAF = 0x9ed482;

const HEAD_Y = 1.36;
const HEAD_RADIUS = 0.6;
const HIP_Y = 0.36;
const SHOULDER_Y = 0.8;

/** A mesh whose geometry has its occlusion baked for where it sits at rest. */
function piece(
  context: PropContext,
  geometry: THREE.BufferGeometry,
  colour: number,
  restY: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(bakeSoftAo(geometry, restY), context.material(colour));
  mesh.castShadow = true;
  return mesh;
}

function ellipsoid(radius: number, sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, 20, 14);
  geometry.scale(sx, sy, sz);
  return geometry;
}

/**
 * A soft round shadow under the feet.
 *
 * The sun's shadow is deliberately faint in this art direction, and at the
 * diorama camera's pitch it falls behind the character anyway. Without
 * something directly underneath, the figure floats. A radial gradient disc is
 * the classic toy-game answer, and it costs one quad.
 */
function contactBlob(context: PropContext): THREE.Mesh {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const alpha = (1 - r * r) ** 2;
      const i = (y * size + x) * 4;
      data[i] = 92;
      data[i + 1] = 78;
      data[i + 2] = 70;
      data[i + 3] = Math.round(alpha * 255 * 0.42);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  applyCurvature(material, context.curvature, "blob");

  const geometry = new THREE.PlaneGeometry(1.3, 1.3);
  geometry.rotateX(-Math.PI / 2);
  const blob = new THREE.Mesh(geometry, material);
  blob.position.y = 0.06;
  blob.renderOrder = 3;
  return blob;
}

export function createCharacter(context: PropContext): Character {
  const root = new THREE.Group();
  // A touch over life size, so the figure holds its own against the trees from
  // the diorama camera. Visual only: collision radii live in the controller.
  root.scale.setScalar(1.18);
  root.add(contactBlob(context));

  // Everything above the hips bobs together on each footfall.
  const upper = new THREE.Group();
  root.add(upper);

  const body = piece(context, ellipsoid(0.34, 1, 1.12, 0.92), SHIRT, 0.62);
  body.position.y = 0.62;
  upper.add(body);

  const head = piece(context, new THREE.SphereGeometry(HEAD_RADIUS, 28, 20), SKIN, HEAD_Y);
  head.position.y = HEAD_Y;
  upper.add(head);

  // A cap of hair, set back so the face shows and low enough at the front to
  // read as a fringe.
  const hair = piece(context, ellipsoid(HEAD_RADIUS + 0.04, 1, 0.8, 1), HAIR, HEAD_Y + 0.14);
  hair.position.set(0, HEAD_Y + 0.14, -0.07);
  upper.add(hair);

  // Sprout: a short stem and two leaves.
  const stem = piece(context, new THREE.CylinderGeometry(0.03, 0.035, 0.28, 8), LEAF, 2.0);
  stem.position.set(0, HEAD_Y + HEAD_RADIUS + 0.14, -0.04);
  upper.add(stem);
  for (const side of [-1, 1]) {
    const leaf = piece(context, ellipsoid(0.15, 1.6, 0.35, 0.9), LEAF, 2.1);
    leaf.position.set(side * 0.18, HEAD_Y + HEAD_RADIUS + 0.26, -0.04);
    leaf.rotation.z = side * 0.45;
    upper.add(leaf);
  }

  // Face, on the +z side the controller treats as forward.
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(ellipsoid(0.075, 0.8, 1.2, 0.5), context.material(EYE));
    bakeSoftAo(eye.geometry, 2);
    eye.position.set(side * 0.2, HEAD_Y + 0.02, 0.55);
    eye.rotation.y = side * 0.35;
    upper.add(eye);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), context.material(CATCHLIGHT));
    bakeSoftAo(glint.geometry, 2);
    glint.position.set(side * 0.2 + 0.025, HEAD_Y + 0.06, 0.6);
    upper.add(glint);

    const cheek = new THREE.Mesh(ellipsoid(0.08, 1.3, 0.65, 0.3), context.material(BLUSH));
    bakeSoftAo(cheek.geometry, 2);
    cheek.position.set(side * 0.33, HEAD_Y - 0.12, 0.475);
    cheek.rotation.y = side * 0.6;
    upper.add(cheek);
  }

  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];

  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.33, SHOULDER_Y, 0);
    shoulder.rotation.z = side * 0.32;
    const arm = piece(context, new THREE.CapsuleGeometry(0.095, 0.16, 6, 12), SHIRT, SHOULDER_Y - 0.14);
    arm.position.y = -0.14;
    const hand = piece(context, new THREE.SphereGeometry(0.1, 14, 10), SKIN, SHOULDER_Y - 0.3);
    hand.position.y = -0.3;
    shoulder.add(arm, hand);
    upper.add(shoulder);
    arms.push(shoulder);

    const hip = new THREE.Group();
    hip.position.set(side * 0.15, HIP_Y, 0);
    const leg = piece(context, new THREE.CapsuleGeometry(0.105, 0.12, 6, 12), TROUSERS, HIP_Y - 0.12);
    leg.position.y = -0.12;
    const shoe = piece(context, ellipsoid(0.13, 1, 0.7, 1.35), SHOES, 0.08);
    shoe.position.set(0, -HIP_Y + 0.08, 0.04);
    hip.add(leg, shoe);
    root.add(hip);
    legs.push(hip);
  }

  // Stride phase, accumulated rather than computed as elapsed × cadence: the
  // player's speed eases every frame, and with the product a change of cadence
  // a minute into the game jumped the phase by tens of radians in one frame,
  // snapping the limbs to a random pose at every start, stop and sprint.
  let phase = 0;
  let lastElapsed: number | null = null;

  return {
    root,
    animate(elapsed, speed) {
      // Stride frequency rises with speed but saturates, so a sprint reads as
      // urgency rather than as a sewing machine. Short legs step quickly.
      const cadence = Math.min(speed * 2.3, 13);
      const swing = Math.min(speed * 0.3, 0.8);
      const dt = lastElapsed === null ? 0 : Math.max(0, elapsed - lastElapsed);
      lastElapsed = elapsed;
      // Wrapped, so the phase keeps its precision over a long session.
      phase = (phase + dt * cadence) % (Math.PI * 2);

      for (let i = 0; i < 2; i++) {
        const direction = i === 0 ? 1 : -1;
        legs[i].rotation.x = Math.sin(phase) * swing * direction;
        arms[i].rotation.x = Math.sin(phase) * swing * -direction * 1.2;
      }

      // A bouncy bob on twice the stride frequency — one hop per footfall —
      // plus a slow idle breath so the figure is never perfectly still.
      const bob = Math.abs(Math.sin(phase)) * swing * 0.1;
      const breath = Math.sin(elapsed * 2.2) * 0.012;
      upper.position.y = bob + breath;
      // A small side-to-side waddle, from the hips so head and hair move as one.
      upper.rotation.z = Math.sin(phase) * swing * 0.03;
    },
  };
}
