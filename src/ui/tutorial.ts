/**
 * A short guided opening.
 *
 * Deliberately brief and entirely reactive: each step waits for the player to do
 * the thing, then gets out of the way. No modal boxes and no forced order — a
 * player who wanders off and works it out for themselves should not be nagged,
 * so every step also completes if its goal happens by accident.
 *
 * The steps are sequenced to teach the *model*, not the controls. Walking and
 * gathering come first because they are obvious; the risk overlay comes next
 * because everything after it depends on being able to read the map; and
 * planting comes last, once the player has somewhere informed to put a tree.
 */

import { onLocaleChange, t } from "../i18n";
import { keyLabel, keyLabels } from "./keys";

export type TutorialGoal =
  | "walk"
  | "openMap"
  | "gather"
  | "plant"
  | "storm"
  | "done";

interface Step {
  readonly goal: TutorialGoal;
  readonly text: () => string;
  /** The same step, with the controls named for a headset's controllers. */
  readonly vrText: () => string;
}

const STEPS: Step[] = [
  {
    goal: "walk",
    text: () => t("tutorial.walk", { keys: keyLabels("KeyW", "KeyA", "KeyS", "KeyD") }),
    vrText: () => t("tutorial.walkVr"),
  },
  {
    goal: "openMap",
    text: () => t("tutorial.openMap", { key: keyLabel("KeyM") }),
    vrText: () => t("tutorial.openMap", { key: "X" }),
  },
  {
    goal: "gather",
    text: () => t("tutorial.gather", { key: keyLabel("KeyE") }),
    vrText: () => t("tutorial.gather", { key: "B" }),
  },
  {
    goal: "plant",
    text: () => t("tutorial.plant", { key: keyLabel("KeyF") }),
    vrText: () => t("tutorial.plant", { key: "A" }),
  },
  {
    goal: "storm",
    text: () => t("tutorial.storm", { key: keyLabel("KeyR") }),
    vrText: () => t("tutorial.stormVr"),
  },
];

const MARKUP = `
  <div class="tutorial" id="tutorial" hidden>
    <p id="tutorial-text"></p>
    <button id="tutorial-skip" type="button"></button>
  </div>
`;

export interface Tutorial {
  /** Report that the player did something; advances if it was what we wanted. */
  complete(goal: TutorialGoal): void;
  /** Dismiss the rest of the tutorial, as the Skip button does. */
  skip(): void;
  readonly finished: boolean;
  /** The step on show, in both wordings; null once finished. */
  readonly current: { readonly text: string; readonly vrText: string } | null;
  dispose(): void;
}

export function createTutorial(root: HTMLElement, skip: boolean): Tutorial {
  root.insertAdjacentHTML("beforeend", MARKUP);

  const panel = root.querySelector("#tutorial") as HTMLElement;
  const text = root.querySelector("#tutorial-text") as HTMLElement;
  const skipButton = root.querySelector("#tutorial-skip") as HTMLButtonElement;

  let index = skip ? STEPS.length : 0;
  /**
   * The step on show, worded for the current language. Kept rather than built
   * on each read, because the headset asks for it every frame.
   */
  let current: { readonly text: string; readonly vrText: string } | null = null;

  const render = (): void => {
    skipButton.textContent = t("tutorial.skip");
    if (index >= STEPS.length) {
      current = null;
      panel.hidden = true;
      return;
    }
    current = { text: STEPS[index].text(), vrText: STEPS[index].vrText() };
    text.textContent = current.text;
    panel.hidden = false;
  };

  const dismiss = (): void => {
    index = STEPS.length;
    render();
  };
  skipButton.addEventListener("click", dismiss);

  render();
  const stopLabelling = onLocaleChange(render);

  return {
    get finished() {
      return index >= STEPS.length;
    },

    get current() {
      return current;
    },

    skip: dismiss,

    complete(goal) {
      if (index >= STEPS.length) return;
      // Only the current step's goal advances, but a player who does something
      // out of order is not blocked — they simply see the step they skipped
      // ahead of, and can satisfy it whenever.
      if (STEPS[index].goal !== goal) return;
      index++;
      render();
    },

    dispose() {
      stopLabelling();
      panel.remove();
    },
  };
}
