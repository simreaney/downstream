/**
 * Meta Quest Touch controllers, read as the same intents as the keyboard and
 * gamepad.
 *
 * The layout mirrors the gamepad's wherever the hardware allows, so a player
 * who learned one has learned the other: A builds and B gathers, X cycles the
 * risk map, the grips step through the tools as the shoulder buttons do, the
 * left stick walks and the left trigger runs. The right stick is the one that
 * changes meaning. On a screen it orbits the camera; in a headset the player
 * looks around by moving their head, so the stick instead turns the table in
 * snaps (left and right) and zooms it (up and down).
 *
 * The right trigger is reported on its own as `select` rather than as an
 * action, because what it does depends on where the controller points: at the
 * dashboard it presses the button under the ray, anywhere else it builds. That
 * decision needs the panel, which this module deliberately knows nothing about.
 *
 * Controllers arrive as XR input sources, not through `navigator.getGamepads()`,
 * and they are read through the xr-standard mapping: trigger 0, grip 1,
 * thumbstick press 3, A/X 4, B/Y 5, thumbstick on axes 2 and 3.
 */

import { applyDeadzone, type GameAction, type InputState } from "../player/input";

/** The slice of an `XRInputSource` this reads, so tests can pass plain objects. */
export interface XrPad {
  readonly handedness: string;
  readonly gamepad?: {
    readonly axes: readonly number[];
    readonly buttons: readonly { readonly pressed: boolean }[];
  } | null;
}

const TRIGGER = 0;
const GRIP = 1;
const STICK_PRESS = 3;
/** A on the right controller, X on the left. */
const LOWER_FACE = 4;
/** B on the right controller, Y on the left. */
const UPPER_FACE = 5;

const LEFT_ACTIONS: Partial<Record<number, GameAction>> = {
  [GRIP]: "toolCyclePrev",
  [LOWER_FACE]: "overlayNext",
  [UPPER_FACE]: "overlayOff",
};

const RIGHT_ACTIONS: Partial<Record<number, GameAction>> = {
  [GRIP]: "toolCycleNext",
  [STICK_PRESS]: "zoomCycle",
  [LOWER_FACE]: "build",
  [UPPER_FACE]: "gather",
};

/**
 * Stick deflection that fires a snap turn, and the lower one it must fall back
 * under before the next. The gap is hysteresis: a single threshold fires a
 * burst of turns from a stick resting near it.
 */
const TURN_FIRE = 0.65;
const TURN_REARM = 0.35;

/** Log-scale per second of zoom at full deflection, as the zoom keys use. */
const ZOOM_RATE = 1.6;

export interface XrControls {
  /** Walk, run and zoom intent, and the buttons pressed this frame. Look is always zero. */
  readonly state: InputState;
  /** Snap-turn steps this frame: +1 turns the view left, -1 right. */
  readonly turn: number;
  /** Whether the right trigger went down this frame. */
  readonly select: boolean;
  /**
   * Whether a controller with a thumbstick is in hand. False when the headset
   * has switched to hand tracking, which has no stick to walk with.
   */
  readonly hasControllers: boolean;
  /** Read every input source. Call once a frame, before reading anything else. */
  poll(sources: Iterable<XrPad>, dt: number): void;
  /** Forget held buttons, so nothing fires on the first frame of a new session. */
  reset(): void;
}

type Pad = NonNullable<XrPad["gamepad"]>;

/** Thumbstick on axes 2 and 3; a pad with no touchpad may report it on 0 and 1. */
function stick(pad: Pad): [number, number] {
  const offset = pad.axes.length >= 4 ? 2 : 0;
  return applyDeadzone(pad.axes[offset] ?? 0, pad.axes[offset + 1] ?? 0);
}

export function createXrControls(): XrControls {
  let moveX = 0;
  let moveZ = 0;
  let sprint = false;
  let zoom = 0;
  let turn = 0;
  let turnArmed = true;
  let select = false;
  let hasControllers = false;
  /**
   * False until the first poll after a reset. The player enters VR by clicking
   * a page button with the trigger, which may still be down when the session
   * starts; that first poll only records what is held, or the click that
   * opened the headset would also build something.
   */
  let primed = false;

  const held = { left: new Set<number>(), right: new Set<number>() };
  const actions = new Set<GameAction>();

  /** Fire `onPress` for every button that went down since the last poll. */
  const edges = (
    pad: Pad | null,
    heldSet: Set<number>,
    fire: boolean,
    onPress: (index: number) => void,
  ): void => {
    if (!pad) {
      heldSet.clear();
      return;
    }
    for (let index = 0; index < pad.buttons.length; index++) {
      const pressed = pad.buttons[index]?.pressed ?? false;
      if (fire && pressed && !heldSet.has(index)) onPress(index);
      if (pressed) heldSet.add(index);
      else heldSet.delete(index);
    }
  };

  const state: InputState = {
    get moveX() {
      return moveX;
    },
    get moveZ() {
      return moveZ;
    },
    lookX: 0,
    lookY: 0,
    get sprint() {
      return sprint;
    },
    get zoom() {
      return zoom;
    },
    get actions() {
      return actions;
    },
  };

  return {
    state,
    get turn() {
      return turn;
    },
    get select() {
      return select;
    },
    get hasControllers() {
      return hasControllers;
    },

    poll(sources, dt) {
      actions.clear();
      turn = 0;
      select = false;

      let left: Pad | null = null;
      let right: Pad | null = null;
      for (const source of sources) {
        const pad = source.gamepad;
        // Tracked hands report a gamepad too, but with no stick to walk with.
        if (!pad || pad.axes.length < 2) continue;
        if (source.handedness === "left") left = pad;
        else if (source.handedness === "right") right = pad;
      }
      hasControllers = left !== null || right !== null;

      [moveX, moveZ] = left ? stick(left) : [0, 0];
      sprint = left?.buttons[TRIGGER]?.pressed ?? false;

      const [turnX, zoomY] = right ? stick(right) : [0, 0];
      // Whichever axis dominates wins, so a slightly diagonal flick to turn
      // does not also nudge the zoom.
      const turning = Math.abs(turnX) >= Math.abs(zoomY);
      if (turnArmed && turning && Math.abs(turnX) > TURN_FIRE) {
        // Pushing right turns the view right, as the gamepad's orbit does.
        turn = turnX > 0 ? -1 : 1;
        turnArmed = false;
      } else if (Math.abs(turnX) < TURN_REARM) {
        turnArmed = true;
      }
      // Up on the stick reads negative, and brings the table closer.
      zoom = turning ? 0 : zoomY * ZOOM_RATE * dt;

      const fire = primed;
      primed = true;
      edges(left, held.left, fire, (index) => {
        const action = LEFT_ACTIONS[index];
        if (action) actions.add(action);
      });
      edges(right, held.right, fire, (index) => {
        if (index === TRIGGER) select = true;
        const action = RIGHT_ACTIONS[index];
        if (action) actions.add(action);
      });
    },

    reset() {
      held.left.clear();
      held.right.clear();
      actions.clear();
      primed = false;
      // Disarmed, for the same reason: a stick already pushed when the
      // session starts must come back to centre before it turns anything.
      turnArmed = false;
      moveX = 0;
      moveZ = 0;
      sprint = false;
      zoom = 0;
      turn = 0;
      select = false;
    },
  };
}
