/**
 * Key names as the player's own keyboard prints them.
 *
 * The game binds physical keys (`event.code`; see `KEY_ACTIONS` in main.ts),
 * which keeps walking under the left hand on every layout — but it means the
 * label on the key depends on the keyboard. On a French AZERTY board the keys
 * that walk are Z Q S D, undo sits on the key printed W, and the risk map is
 * on the one printed with a comma. A hint that says "press M" would be wrong
 * for most of the players the French translation is for.
 *
 * Where the browser can say what the layout prints (`getLayoutMap`, which
 * Chromium has), the hints use it. Elsewhere they fall back to US QWERTY names,
 * which is what they always said.
 */

interface KeyboardLayoutMap {
  get(code: string): string | undefined;
}

interface LayoutAwareKeyboard {
  getLayoutMap?(): Promise<KeyboardLayoutMap>;
}

let layout: KeyboardLayoutMap | null = null;

/** Ask the browser for the keyboard layout. Safe to skip; labels then read as QWERTY. */
export async function loadKeyboardLayout(): Promise<void> {
  if (typeof navigator === "undefined") return;
  const keyboard = (navigator as Navigator & { keyboard?: LayoutAwareKeyboard }).keyboard;
  if (!keyboard?.getLayoutMap) return;
  try {
    layout = await keyboard.getLayoutMap();
  } catch {
    // Refused inside a cross-origin frame, for one.
    layout = null;
  }
}

const NAMED: Record<string, string> = { Minus: "−", Equal: "=", Tab: "Tab" };

/** The label on the physical key `code`, e.g. "Z" for `KeyW` on AZERTY. */
export function keyLabel(code: string): string {
  // The digit, not what the layout types unshifted: on AZERTY that is "&",
  // but the key is printed with both and players call it 1.
  if (code.startsWith("Digit")) return code.slice(5);

  const printed = layout?.get(code);
  if (printed) {
    if (printed === "-") return "−";
    const upper = printed.toUpperCase();
    // "ß" upper-cases to "SS", which is not what is on the key.
    return upper.length === printed.length ? upper : printed;
  }
  if (code.startsWith("Key")) return code.slice(3);
  return NAMED[code] ?? code;
}

/** Several keys read as one label: the movement keys as "WASD" (or "ZQSD"). */
export function keyLabels(...codes: readonly string[]): string {
  return codes.map(keyLabel).join("");
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

/** A key cap. The label is escaped: it comes from the keyboard, and one of them could be "<". */
export function kbd(label: string): string {
  return `<kbd>${escapeHtml(label)}</kbd>`;
}
