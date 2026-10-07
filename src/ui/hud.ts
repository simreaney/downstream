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
import { onLocaleChange, t, type MessageKey } from "../i18n";
import { escapeHtml, kbd, keyLabel, keyLabels } from "./keys";

const MARKUP = `
  <div class="hud">
    <div class="hud__row">
      <span class="hud__chip" id="hud-wood">🪵 0</span>
      <span class="hud__chip" id="hud-stone">🪨 0</span>
      <span class="hud__chip hud__chip--muted" id="hud-spade">🪏 —</span>
    </div>
    <div class="hud__tools" id="hud-tools"></div>
    <div class="hud__readout" id="hud-readout"></div>
    <div class="hud__keys" id="hud-keys"></div>
  </div>
  <div class="toast" id="toast" hidden></div>
`;

const TOOLS: { kind: InterventionKind; code: string; label: MessageKey }[] = [
  { kind: "tree", code: "Digit1", label: "tool.tree" },
  { kind: "dam", code: "Digit2", label: "tool.dam" },
  { kind: "pond", code: "Digit3", label: "tool.pond" },
];

/** The keyboard reminder under the readout, as key caps and what they do. */
function keyHint(): string {
  const pair = (keys: string, action: MessageKey): string => `${keys} ${escapeHtml(t(action))}`;
  return [
    pair(kbd(keyLabels("KeyW", "KeyA", "KeyS", "KeyD")), "hint.walk"),
    pair(kbd(keyLabel("KeyF")), "hint.build"),
    pair(kbd(keyLabel("KeyE")), "hint.gather"),
    pair(kbd(keyLabel("KeyR")), "hint.storm"),
    pair(kbd(keyLabel("KeyZ")), "hint.undo"),
    pair(kbd(keyLabel("KeyK")), "hint.save"),
    pair(kbd(keyLabel("Tab")), "hint.map"),
    pair(`${kbd(t("key.scroll"))}/${kbd(keyLabel("Minus"))}${kbd(keyLabel("Equal"))}`, "hint.zoom"),
  ].join(" &middot; ");
}

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
  const keys = root.querySelector("#hud-keys") as HTMLElement;
  const toastEl = root.querySelector("#toast") as HTMLElement;

  let tool: InterventionKind | null = null;
  let hasSpade = false;

  const highlightTool = (): void => {
    for (const button of tools.querySelectorAll(".hud__tool")) {
      button.classList.toggle("hud__tool--active", button.getAttribute("data-kind") === tool);
    }
  };

  const showSpade = (): void => {
    spade.textContent = hasSpade ? `🪏 ${t("hud.spade")}` : "🪏 —";
  };

  /** Everything with words in it; run again whenever the language changes. */
  const relabel = (): void => {
    tools.innerHTML = TOOLS.map((entry) => {
      const cost = costOf(entry.kind);
      const price = cost.wood > 0 ? `${cost.wood}🪵` : `${cost.stone}🪨`;
      return `<button class="hud__tool" data-kind="${entry.kind}">
        ${kbd(keyLabel(entry.code))}<span>${escapeHtml(t(entry.label))}</span><em>${price}</em>
      </button>`;
    }).join("");
    highlightTool();
    showSpade();
    keys.innerHTML = keyHint();
  };
  relabel();
  const stopLabelling = onLocaleChange(relabel);

  let toastTimer = 0;

  let lastReadout = "";

  return {
    setInventory(state) {
      wood.textContent = `🪵 ${state.wood}`;
      stone.textContent = `🪨 ${state.stone}`;
      hasSpade = state.hasSpade;
      showSpade();
      spade.classList.toggle("hud__chip--muted", !state.hasSpade);
    },

    setTool(kind) {
      tool = kind;
      highlightTool();
    },

    setReadout(message, ok, warn) {
      // Called every frame; a DOM write only when something changed, or the
      // page restyles the readout sixty times a second for nothing.
      const key = `${ok ? 1 : 0}${warn ? 1 : 0}${message}`;
      if (key === lastReadout) return;
      lastReadout = key;
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
      stopLabelling();
    },
  };
}

/**
 * One `Hud` that forwards every call to several.
 *
 * The page's HUD and the headset's (`xr/hud.ts`) are kept current together,
 * so either can be the one on show at any moment — the player can take the
 * headset off mid-game and find the page already says what the panel did.
 */
export function mirrorHud(...huds: readonly Hud[]): Hud {
  return {
    setInventory: (state) => huds.forEach((hud) => hud.setInventory(state)),
    setTool: (kind) => huds.forEach((hud) => hud.setTool(kind)),
    setReadout: (message, ok, warn) => huds.forEach((hud) => hud.setReadout(message, ok, warn)),
    toast: (message) => huds.forEach((hud) => hud.toast(message)),
    dispose: () => huds.forEach((hud) => hud.dispose()),
  };
}
