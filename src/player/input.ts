/**
 * Input, normalised to intent.
 *
 * Everything downstream reads "move by this vector, look by this much" rather
 * than keys, so adding a gamepad or touch stick later means adding a source
 * here and changing nothing else. The gamepad is that source: its sticks feed
 * the same moveX/moveZ/lookX/lookY/sprint the keyboard and mouse do, so the
 * player controller and camera need no gamepad-specific code at all.
 *
 * Movement is collected as a state set rather than as events, because a key held
 * down should produce continuous motion regardless of the browser's key-repeat
 * rate — which varies by platform and is not a frame clock.
 *
 * Discrete gamepad buttons have no keyboard-style press event to hook, so they
 * are polled once a frame in `poll()` and reported as a "just pressed" set on
 * `actions` — edge-detected there so a held button fires its action once, the
 * same way a keydown handler ignores `event.repeat`.
 */

/** A discrete, edge-triggered intent — the gamepad's analogue of a keydown. */
export type GameAction =
  | "toolTree"
  | "toolDam"
  | "toolPond"
  | "toolCycleNext"
  | "toolCyclePrev"
  | "gather"
  | "build"
  | "overlayNext"
  | "overlayOff"
  | "mapToggle"
  | "storm"
  | "save"
  | "undo";

export interface InputState {
  /** Movement intent in camera space, each component in [-1, 1]. */
  readonly moveX: number;
  readonly moveZ: number;
  /** Camera orbit intent this frame, in radians. */
  readonly lookX: number;
  readonly lookY: number;
  readonly sprint: boolean;
  /** Gamepad buttons pressed this frame. Absent for keyboard/mouse-only state. */
  readonly actions?: ReadonlySet<GameAction>;
}

export interface Input {
  readonly state: InputState;
  /** Poll the gamepad. Call once a frame, before reading `state`. */
  poll(dt: number): void;
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

/**
 * Standard Gamepad button index -> the action it fires.
 *
 * Indices follow the W3C "standard" layout, which the browser maps a Bluetooth
 * or USB controller onto regardless of brand — so this reads as Xbox-style
 * naming (A/B/X/Y, LB/RB, D-pad) but holds for a PlayStation pad too.
 */
const GAMEPAD_BUTTON_ACTIONS: Partial<Record<number, GameAction>> = {
  0: "build", // A / Cross — face the target and place the current tool
  1: "gather", // B / Circle — pick up the nearest resource
  2: "overlayNext", // X / Square — cycle the risk overlay
  3: "mapToggle", // Y / Triangle — open/close the catchment overview
  4: "toolCyclePrev", // LB / L1
  5: "toolCycleNext", // RB / R1
  7: "storm", // RT / R2 — run the 1-in-30 design storm
  8: "overlayOff", // Back / Select / View
  9: "save", // Start / Menu — save and copy the share link
  12: "toolTree", // D-pad up
  13: "toolPond", // D-pad down
  14: "undo", // D-pad left
  15: "toolDam", // D-pad right
};

/** Held rather than edge-triggered, same as Shift. LT / L2. */
const GAMEPAD_SPRINT_BUTTON = 6;

/** Fraction of stick travel ignored, so a worn or uncentred stick can't drift the player. */
const GAMEPAD_STICK_DEADZONE = 0.15;

/** Radians of camera orbit per second at full stick deflection. */
const GAMEPAD_LOOK_SPEED = 2.4;

/**
 * Radial deadzone: below it the stick reports as centred, above it the
 * remaining travel is rescaled back to the full [0, 1] range so movement
 * still reaches full speed at full deflection.
 */
export function applyDeadzone(x: number, y: number): [number, number] {
  const magnitude = Math.hypot(x, y);
  if (magnitude < GAMEPAD_STICK_DEADZONE) return [0, 0];
  const scale = Math.min(1, (magnitude - GAMEPAD_STICK_DEADZONE) / (1 - GAMEPAD_STICK_DEADZONE)) / magnitude;
  return [x * scale, y * scale];
}

export function createInput(target: HTMLElement): Input {
  const held = new Set<string>();
  let lookX = 0;
  let lookY = 0;
  let sprint = false;
  let dragging = false;

  let gamepadIndex: number | null = null;
  let gamepadMoveX = 0;
  let gamepadMoveZ = 0;
  let gamepadSprint = false;
  const gamepadButtonsHeld = new Set<number>();
  const actions = new Set<GameAction>();

  const onGamepadConnected = (event: GamepadEvent): void => {
    gamepadIndex = event.gamepad.index;
  };

  const onGamepadDisconnected = (event: GamepadEvent): void => {
    if (event.gamepad.index !== gamepadIndex) return;
    gamepadIndex = null;
    gamepadMoveX = 0;
    gamepadMoveZ = 0;
    gamepadSprint = false;
    gamepadButtonsHeld.clear();
  };

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
  window.addEventListener("gamepadconnected", onGamepadConnected);
  window.addEventListener("gamepaddisconnected", onGamepadDisconnected);
  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("pointercancel", onPointerUp);
  target.addEventListener("pointermove", onPointerMove);

  /**
   * Re-read the connected gamepad's sticks and buttons.
   *
   * `navigator.getGamepads()` returns a live-updating snapshot rather than
   * dispatching events for stick motion or button state, so it has to be
   * polled every frame — unlike keyboard and pointer input, which arrive as
   * events and only need a place to land.
   */
  const pollGamepad = (dt: number): void => {
    actions.clear();
    let pad: Gamepad | null = null;
    if (gamepadIndex !== null) {
      pad = navigator.getGamepads()[gamepadIndex] ?? null;
    } else {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) {
          pad = pads[i];
          gamepadIndex = i;
          break;
        }
      }
    }
    if (!pad) {
      gamepadMoveX = 0;
      gamepadMoveZ = 0;
      gamepadSprint = false;
      gamepadButtonsHeld.clear();
      return;
    }

    const [moveX, moveZ] = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    gamepadMoveX = moveX;
    gamepadMoveZ = moveZ;

    const [orbitX, orbitY] = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    lookX -= orbitX * GAMEPAD_LOOK_SPEED * dt;
    lookY -= orbitY * GAMEPAD_LOOK_SPEED * dt;

    gamepadSprint = pad.buttons[GAMEPAD_SPRINT_BUTTON]?.pressed ?? false;

    for (const [key, action] of Object.entries(GAMEPAD_BUTTON_ACTIONS)) {
      const index = Number(key);
      const pressed = pad.buttons[index]?.pressed ?? false;
      if (pressed && !gamepadButtonsHeld.has(index)) actions.add(action as GameAction);
      if (pressed) gamepadButtonsHeld.add(index);
      else gamepadButtonsHeld.delete(index);
    }
  };

  const state: InputState = {
    get moveX() {
      let x = gamepadMoveX;
      for (const code of held) x += MOVE_KEYS[code][0];
      return Math.max(-1, Math.min(1, x));
    },
    get moveZ() {
      let z = gamepadMoveZ;
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
      return sprint || gamepadSprint;
    },
    get actions() {
      return gamepadIndex !== null ? actions : undefined;
    },
  };

  return {
    state,
    poll(dt) {
      pollGamepad(dt);
    },
    endFrame() {
      lookX = 0;
      lookY = 0;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("gamepadconnected", onGamepadConnected);
      window.removeEventListener("gamepaddisconnected", onGamepadDisconnected);
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointerup", onPointerUp);
      target.removeEventListener("pointercancel", onPointerUp);
      target.removeEventListener("pointermove", onPointerMove);
    },
  };
}
