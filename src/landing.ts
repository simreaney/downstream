/**
 * The landing page in the visitor's language.
 *
 * The English is the page itself, so it is what search engines index and what
 * shows without scripts. Each translatable element carries `data-i18n="key"`
 * (its inner HTML) or `data-i18n-<attribute>="key"` (one attribute), and this
 * swaps them for the visitor's language — keeping the English it found, so
 * choosing English again from the menu puts the page back exactly.
 *
 * Shares the language choice with the game, so a visitor who picks one here
 * plays in it too. Key caps marked `data-key` show what the visitor's own
 * keyboard prints, as the game's hints do (see `ui/keys.ts`).
 */

import { de } from "./i18n/landing/de";
import { es } from "./i18n/landing/es";
import { fr } from "./i18n/landing/fr";
import type { LandingMessages } from "./i18n/landing/types";
import { locale, onLocaleChange, resolveLocale, setLocale, type Locale } from "./i18n/locale";
import { keyLabel, loadKeyboardLayout } from "./ui/keys";
import { createLanguagePicker } from "./ui/languagePicker";

const TRANSLATIONS: Record<Exclude<Locale, "en">, LandingMessages> = { es, de, fr };

/** Marker attribute → the attribute it translates. */
const ATTRIBUTES: Record<string, string> = {
  "data-i18n-alt": "alt",
  "data-i18n-aria-label": "aria-label",
  "data-i18n-caption": "data-caption",
  "data-i18n-content": "content",
};

interface Slot {
  readonly element: Element;
  /** Null for the element's inner HTML. */
  readonly attribute: string | null;
  readonly key: string;
  readonly english: string;
}

const slots: Slot[] = [];
for (const element of document.querySelectorAll("[data-i18n]")) {
  slots.push({ element, attribute: null, key: element.getAttribute("data-i18n") ?? "", english: element.innerHTML });
}
for (const [marker, attribute] of Object.entries(ATTRIBUTES)) {
  for (const element of document.querySelectorAll(`[${marker}]`)) {
    const key = element.getAttribute(marker) ?? "";
    slots.push({ element, attribute, key, english: element.getAttribute(attribute) ?? "" });
  }
}

const labelKeys = (): void => {
  for (const cap of document.querySelectorAll<HTMLElement>("kbd[data-key]")) {
    cap.textContent = keyLabel(cap.dataset.key ?? "");
  }
};

const translate = (): void => {
  const current = locale();
  const table = current === "en" ? null : TRANSLATIONS[current];
  for (const slot of slots) {
    // The translations are this repository's own text, not visitor input.
    const text = table?.[slot.key] ?? slot.english;
    if (slot.attribute) slot.element.setAttribute(slot.attribute, text);
    else slot.element.innerHTML = text;
  }
  // Again after every swap, which replaces the key caps inside the paragraphs.
  labelKeys();
};

setLocale(resolveLocale());
translate();
onLocaleChange(translate);
void loadKeyboardLayout().then(labelKeys);

const hero = document.querySelector(".hero");
if (hero instanceof HTMLElement) createLanguagePicker(hero, { className: "language" });
