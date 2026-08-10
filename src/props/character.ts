/**
 * The player avatar.
 *
 * Animal Crossing proportions: a big round head on a small round body, stubby
 * limbs, no neck. The head is deliberately oversized — it is what the player
 * tracks at distance, and it keeps the character readable against busy terrain
 * at the camera's usual pitch.
 *
 * Returned as a Group rather than instanced parts, because there is exactly one
 * of these and its limbs need to move independently for the walk cycle.
 */

import * as THREE from "three";
import type { PropContext } from "./types";

export interface Character {
  readonly root: THREE.Group;
  /** Drive the walk cycle. `speed` is metres per second. */
  animate(elapsed: number, speed: number): void;
}

const SKIN = 0xf4c9a0;
const SHIRT = 0x4fb286;
const TROUSERS = 0x4a6fa5;
const HAIR = 0x5b4636;

export function createCharacter(context: PropContext): Character {
  const root = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 0.36, 4, 10),
    context.material(SHIRT),
  );
  body.position.y = 0.62;
  body.castShadow = true;
  root.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12), context.material(SKIN));
  head.position.y = 1.42;
  head.castShadow = true;
  root.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12), context.material(HAIR));
  // A cap of hair: scaled down vertically and lifted, so it reads as a fringe
  // rather than a second head.
  hair.scale.set(1, 0.62, 1);
  hair.position.y = 1.58;
  hair.castShadow = true;
  root.add(hair);

  const limbGeometry = new THREE.CapsuleGeometry(0.12, 0.3, 3, 8);
  const arms: THREE.Mesh[] = [];
  const legs: THREE.Mesh[] = [];

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(limbGeometry, context.material(SKIN));
    arm.position.set(side * 0.42, 0.78, 0);
    arm.castShadow = true;
    root.add(arm);
    arms.push(arm);

    const leg = new THREE.Mesh(limbGeometry, context.material(TROUSERS));
    leg.position.set(side * 0.17, 0.24, 0);
    leg.castShadow = true;
    root.add(leg);
    legs.push(leg);
  }

  return {
    root,
    animate(elapsed, speed) {
      // Stride frequency rises with speed but saturates, so a sprint reads as
      // urgency rather than as a sewing machine.
      const cadence = Math.min(speed * 1.9, 11);
      const swing = Math.min(speed * 0.28, 0.85);
      const phase = elapsed * cadence;

      for (let i = 0; i < 2; i++) {
        const direction = i === 0 ? 1 : -1;
        legs[i].rotation.x = Math.sin(phase) * swing * direction;
        arms[i].rotation.x = Math.sin(phase) * swing * -direction;
      }

      // A slight bob on twice the stride frequency — one rise per footfall.
      body.position.y = 0.62 + Math.abs(Math.sin(phase)) * swing * 0.07;
      head.position.y = 1.42 + Math.abs(Math.sin(phase)) * swing * 0.07;
      hair.position.y = 1.58 + Math.abs(Math.sin(phase)) * swing * 0.07;
    },
  };
}
