/**
 * Inventory, selected tool, and the placement readout.
 *
 * The readout under the tool is the important part: it names what the current
 * target would intercept, or why it is refused, before the player commits. That
 * turns the build key from a gamble into a decision, and it is the only piece of
 * UI that connects the model's numbers to a thing the player is about to do.
 */

import type { InterventionKind } from "../game/interventions";
import { costOf } from "../game/interventions";
import type { InventoryState } from "../game/inventory";

const MARKUP = `
  <div class="hud">
    <div class="hud__row">
      <span class="hud__chip" id="hud-wood">🪵 0</span>
      <span class="hud__chip" id="hud-stone">🪨 0</span>
      <span class="hud__chip hud__chip--muted" id="hud-spade">🪏 —</span>
    </div>
    <div class="hud__tools" id="hud-tools"></div>
    <div class="hud__readout" id="hud-readout"></div>
    <div class="hud__keys">
      <kbd>WASD</kbd> walk &middot; <kbd>F</kbd> build &middot; <kbd>E</kbd> gather &middot;
      <kbd>R</kbd> storm &middot; <kbd>Z</kbd> undo &middot; <kbd>K</kbd> save &middot;
      <kbd>Tab</kbd> map
    </div>
  </div>
  <div class="toast" id="toast" hidden></div>
`;

const TOOLS: { kind: InterventionKind; key: string; label: string }[] = [
  { kind: "tree", key: "1", label: "Plant" },
  { kind: "dam", key: "2", label: "Leaky dam" },
  { kind: "pond", key: "3", label: "Pond" },
];

export interface Hud {
  setInventory(state: InventoryState): void;
  setTool(kind: InterventionKind): void;
  /** `ok` drives the colour; message may be a hydrology readout or a refusal. */
  setReadout(message: string, ok: boolean, warn: boolean): void;
  toast(message: string): void;
  dispose(): void;
}

export function createHud(root: HTMLElement): Hud {
  root.insertAdjacentHTML("beforeend", MARKUP);

  const wood = root.querySelector("#hud-wood") as HTMLElement;
  const stone = root.querySelector("#hud-stone") as HTMLElement;
  const spade = root.querySelector("#hud-spade") as HTMLElement;
  const tools = root.querySelector("#hud-tools") as HTMLElement;
  const readout = root.querySelector("#hud-readout") as HTMLElement;
  const toastEl = root.querySelector("#toast") as HTMLElement;

  tools.innerHTML = TOOLS.map((tool) => {
    const cost = costOf(tool.kind);
    const price = cost.wood > 0 ? `${cost.wood}🪵` : `${cost.stone}🪨`;
    return `<button class="hud__tool" data-kind="${tool.kind}">
      <kbd>${tool.key}</kbd><span>${tool.label}</span><em>${price}</em>
    </button>`;
  }).join("");

  let toastTimer = 0;

  return {
    setInventory(state) {
      wood.textContent = `🪵 ${state.wood}`;
      stone.textContent = `🪨 ${state.stone}`;
      spade.textContent = state.hasSpade ? "🪏 spade" : "🪏 —";
      spade.classList.toggle("hud__chip--muted", !state.hasSpade);
    },

    setTool(kind) {
      for (const button of tools.querySelectorAll(".hud__tool")) {
        button.classList.toggle("hud__tool--active", button.getAttribute("data-kind") === kind);
      }
    },

    setReadout(message, ok, warn) {
      readout.textContent = message;
      readout.classList.toggle("hud__readout--ok", ok && !warn);
      readout.classList.toggle("hud__readout--warn", ok && warn);
      readout.classList.toggle("hud__readout--bad", !ok);
    },

    toast(message) {
      toastEl.textContent = message;
      toastEl.hidden = false;
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toastEl.hidden = true;
      }, 2600);
    },

    dispose() {
      window.clearTimeout(toastTimer);
    },
  };
}
