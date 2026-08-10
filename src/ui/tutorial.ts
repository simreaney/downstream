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

export type TutorialGoal =
  | "walk"
  | "openMap"
  | "gather"
  | "plant"
  | "storm"
  | "done";

interface Step {
  readonly goal: TutorialGoal;
  readonly text: string;
}

const STEPS: Step[] = [
  {
    goal: "walk",
    text: "This catchment is losing soil to its river. Walk about with WASD and take a look.",
  },
  {
    goal: "openMap",
    text: "Press M for the risk map. Bright means erodible ground that is well connected to a watercourse — that is where sediment comes from.",
  },
  {
    goal: "gather",
    text: "Press E by a log pile or boulder to gather. You will need wood to plant and stone to dig.",
  },
  {
    goal: "plant",
    text: "Face a bright patch near the river and press F to plant. Watch the map and the water.",
  },
  {
    goal: "storm",
    text: "Trees are only half of it. Press R to send a storm through and see what your work does to the flood.",
  },
];

const MARKUP = `
  <div class="tutorial" id="tutorial" hidden>
    <p id="tutorial-text"></p>
    <button id="tutorial-skip" type="button">Skip</button>
  </div>
`;

export interface Tutorial {
  /** Report that the player did something; advances if it was what we wanted. */
  complete(goal: TutorialGoal): void;
  readonly finished: boolean;
  dispose(): void;
}

export function createTutorial(root: HTMLElement, skip: boolean): Tutorial {
  root.insertAdjacentHTML("beforeend", MARKUP);

  const panel = root.querySelector("#tutorial") as HTMLElement;
  const text = root.querySelector("#tutorial-text") as HTMLElement;
  const skipButton = root.querySelector("#tutorial-skip") as HTMLButtonElement;

  let index = skip ? STEPS.length : 0;

  const render = (): void => {
    if (index >= STEPS.length) {
      panel.hidden = true;
      return;
    }
    text.textContent = STEPS[index].text;
    panel.hidden = false;
  };

  skipButton.addEventListener("click", () => {
    index = STEPS.length;
    render();
  });

  render();

  return {
    get finished() {
      return index >= STEPS.length;
    },

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
      panel.remove();
    },
  };
}
