/**
 * The build preview.
 *
 * Two jobs, and the second matters more. It shows where the feature will go —
 * and it reports what that placement would *do*, as upslope area intercepted,
 * before any wood is spent. That readout is what turns siting from guesswork
 * into a judgement the player can make, and it is the reason the ghost is
 * re-evaluated every frame rather than on click.
 *
 * Green for a legal placement, amber for legal but ineffective, red for refused.
 * The amber case exists because planting rough grazing is allowed and slightly
 * counter-productive under the shipped weight table — a warning the player can
 * overrule, not a block.
 */

import * as THREE from "three";
import type { GridSpec } from "../core/grid";
import { applyCurvature, type CurvatureUniforms } from "../render/curvature";
import { sampleHeight } from "../render/terrainMesh";
import type { PlacementCheck } from "../game/validity";

const OK = new THREE.Color(0x5fd08a);
const WARN = new THREE.Color(0xe8bf5a);
const BAD = new THREE.Color(0xe0705c);

export interface PlacementGhost {
  readonly root: THREE.Object3D;
  /** Position and colour the ghost for the current target. */
  show(
    spec: GridSpec,
    dem: Float32Array,
    x: number,
    z: number,
    radius: number,
    check: PlacementCheck,
    helpful: boolean,
  ): void;
  hide(): void;
}

export function createPlacementGhost(curvature: CurvatureUniforms): PlacementGhost {
  const root = new THREE.Group();
  root.visible = false;

  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  applyCurvature(material, curvature, "ghost");

  // A flat ring on the ground rather than a solid disc: the player needs to see
  // the ground they are about to change, not have it covered up.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 24), material);
  ring.rotation.x = -Math.PI / 2;
  root.add(ring);

  // A short column so the marker is findable when the camera is low and the
  // ring is nearly edge-on.
  const pillarMaterial = material.clone();
  applyCurvature(pillarMaterial, curvature, "ghost");
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6), pillarMaterial);
  pillar.position.y = 0.7;
  root.add(pillar);

  return {
    root,

    show(spec, dem, x, z, radius, check, helpful) {
      root.visible = true;
      root.position.set(x, sampleHeight(dem, spec, x, z) + 0.08, z);
      ring.scale.setScalar(radius);

      const colour = !check.ok ? BAD : helpful ? OK : WARN;
      material.color.copy(colour);
      pillarMaterial.color.copy(colour);
    },

    hide() {
      root.visible = false;
    },
  };
}
