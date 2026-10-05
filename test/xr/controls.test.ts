/**
 * Touch controllers, mapped to the game's intents.
 *
 * Driven with plain objects shaped like XR input sources, since the mapping is
 * the logic worth pinning and the XR session is only where the numbers come
 * from. The cases are the ones a player would notice at once in a headset:
 * a turn that fires repeatedly while the stick is held, a zoom that drifts
 * while turning, and the trigger click that opened the session also building
 * a dam the moment it began.
 */

import { describe, expect, it } from "vitest";
import { createXrControls, type XrPad } from "../../src/xr/controls";

const BUTTONS = 7;

function pad(
  handedness: "left" | "right",
  stick: [number, number] = [0, 0],
  pressed: number[] = [],
): XrPad {
  return {
    handedness,
    gamepad: {
      // xr-standard: touchpad on 0 and 1 (absent on Touch), thumbstick on 2 and 3.
      axes: [0, 0, stick[0], stick[1]],
      buttons: Array.from({ length: BUTTONS }, (_, index) => ({ pressed: pressed.includes(index) })),
    },
  };
}

function ready() {
  const controls = createXrControls();
  controls.reset();
  controls.poll([pad("left"), pad("right")], 1 / 72);
  return controls;
}

describe("createXrControls", () => {
  it("walks on the left stick, with the same deadzone as the gamepad", () => {
    const controls = ready();
    controls.poll([pad("left", [0.1, -0.05]), pad("right")], 1 / 72);
    expect(controls.state.moveX).toBe(0);
    expect(controls.state.moveZ).toBe(0);

    controls.poll([pad("left", [0, -1]), pad("right")], 1 / 72);
    expect(controls.state.moveZ).toBeCloseTo(-1, 5);
  });

  it("runs while the left trigger is held", () => {
    const controls = ready();
    controls.poll([pad("left", [0, 0], [0]), pad("right")], 1 / 72);
    expect(controls.state.sprint).toBe(true);
    expect(controls.select).toBe(false);
  });

  it("snap-turns once per flick of the right stick", () => {
    const controls = ready();
    const turns: number[] = [];
    for (let frame = 0; frame < 30; frame++) {
      controls.poll([pad("left"), pad("right", [0.9, 0])], 1 / 72);
      turns.push(controls.turn);
    }
    expect(turns.filter((turn) => turn !== 0)).toEqual([-1]);

    // Back to centre re-arms it; a flick left turns the other way.
    controls.poll([pad("left"), pad("right", [0, 0])], 1 / 72);
    controls.poll([pad("left"), pad("right", [-0.9, 0])], 1 / 72);
    expect(controls.turn).toBe(1);
  });

  it("zooms on the right stick's vertical, and not while turning", () => {
    const controls = ready();
    controls.poll([pad("left"), pad("right", [0, -1])], 1 / 72);
    expect(controls.state.zoom).toBeLessThan(0); // up brings the table closer

    controls.poll([pad("left"), pad("right", [0.9, 0.4])], 1 / 72);
    expect(controls.state.zoom).toBe(0);
  });

  it("maps the face buttons, grips and stick click to the gamepad's actions", () => {
    const controls = ready();
    controls.poll([pad("left", [0, 0], [1, 4]), pad("right", [0, 0], [1, 3, 4, 5])], 1 / 72);
    expect([...(controls.state.actions ?? [])].sort()).toEqual(
      ["build", "gather", "overlayNext", "toolCycleNext", "toolCyclePrev", "zoomCycle"].sort(),
    );

    // Held, not pressed again: nothing fires twice.
    controls.poll([pad("left", [0, 0], [1, 4]), pad("right", [0, 0], [1, 3, 4, 5])], 1 / 72);
    expect(controls.state.actions?.size).toBe(0);

    controls.poll([pad("left", [0, 0], [5]), pad("right")], 1 / 72);
    expect([...(controls.state.actions ?? [])]).toEqual(["overlayOff"]);
  });

  it("reports the right trigger as a select, not as a build", () => {
    const controls = ready();
    controls.poll([pad("left"), pad("right", [0, 0], [0])], 1 / 72);
    expect(controls.select).toBe(true);
    expect(controls.state.actions?.size).toBe(0);
  });

  it("ignores buttons already held when the session starts", () => {
    const controls = createXrControls();
    controls.reset();
    // The trigger that clicked "Enter VR" is still down on the first frame.
    controls.poll([pad("left"), pad("right", [0.9, 0], [0])], 1 / 72);
    expect(controls.select).toBe(false);
    expect(controls.turn).toBe(0);

    controls.poll([pad("left"), pad("right", [0.9, 0], [0])], 1 / 72);
    expect(controls.select).toBe(false);
    expect(controls.turn).toBe(0);

    controls.poll([pad("left"), pad("right")], 1 / 72);
    controls.poll([pad("left"), pad("right", [0, 0], [0])], 1 / 72);
    expect(controls.select).toBe(true);
  });

  it("notices when the player has put the controllers down for hand tracking", () => {
    const controls = ready();
    expect(controls.hasControllers).toBe(true);
    const hand: XrPad = { handedness: "right", gamepad: { axes: [], buttons: [{ pressed: false }] } };
    controls.poll([hand], 1 / 72);
    expect(controls.hasControllers).toBe(false);
    expect(controls.state.moveZ).toBe(0);
  });
});
