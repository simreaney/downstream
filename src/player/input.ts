/**
 * Input, normalised to intent.
 *
 * Everything downstream reads "move by this vector, look by this much" rather
 * than keys, so adding a gamepad or touch stick later means adding a source
 * here and changing nothing else.
 *
 * Movement is collected as a state set rather than as events, because a key held
 * down should produce continuous motion regardless of the browser's key-repeat
 * rate — which varies by platform and is not a frame clock.
 */

export interface InputState {
  /** Movement intent in camera space, each component in [-1, 1]. */
  readonly moveX: number;
  readonly moveZ: number;
  /** Camera orbit intent this frame, in radians. */
  readonly lookX: number;
  readonly lookY: number;
  readonly sprint: boolean;
}

export interface Input {
  readonly state: InputState;
  /** Clear per-frame deltas. Call after the frame has consumed them. */
  endFrame(): void;
  dispose(): void;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  keyw: [0, -1],
  arrowup: [0, -1],
  keys: [0, 1],
  arrowdown: [0, 1],
  keya: [-1, 0],
  arrowleft: [-1, 0],
  keyd: [1, 0],
  arrowright: [1, 0],
};

/** Radians of orbit per pixel of pointer movement. */
const LOOK_SENSITIVITY = 0.0042;

export function createInput(target: HTMLElement): Input {
  const held = new Set<string>();
  let lookX = 0;
  let lookY = 0;
  let sprint = false;
  let dragging = false;

  const onKeyDown = (event: KeyboardEvent): void => {
    const code = event.code.toLowerCase();
    if (code in MOVE_KEYS) {
      held.add(code);
      // Arrow keys scroll the page otherwise, which fights the camera.
      event.preventDefault();
    }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") sprint = true;
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.code.toLowerCase());
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") sprint = false;
  };

  // A window blur while a key is down would otherwise leave the player walking
  // forever, because the keyup lands in another window.
  const onBlur = (): void => {
    held.clear();
    sprint = false;
    dragging = false;
  };

  const onPointerDown = (event: PointerEvent): void => {
    dragging = true;
    target.setPointerCapture(event.pointerId);
  };

  const onPointerUp = (event: PointerEvent): void => {
    dragging = false;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    lookX -= event.movementX * LOOK_SENSITIVITY;
    lookY -= event.movementY * LOOK_SENSITIVITY;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);
  target.addEventListener("pointermove", onPointerMove);

  const state: InputState = {
    get moveX() {
      let x = 0;
      for (const code of held) x += MOVE_KEYS[code][0];
      return Math.max(-1, Math.min(1, x));
    },
    get moveZ() {
      let z = 0;
      for (const code of held) z += MOVE_KEYS[code][1];
      return Math.max(-1, Math.min(1, z));
    },
    get lookX() {
      return lookX;
    },
    get lookY() {
      return lookY;
    },
    get sprint() {
      return sprint;
    },
  };

  return {
    state,
    endFrame() {
      lookX = 0;
      lookY = 0;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
      target.removeEventListener("pointermove", onPointerMove);
    },
  };
}
