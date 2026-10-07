/**
 * A menu of the supported languages.
 *
 * Each language is listed under its own name, so a player who has landed in
 * the wrong one can still find theirs. Picking one switches the page in place
 * and is remembered for the next visit — on the landing page too, which shares
 * the choice.
 */

import { LOCALES, locale, onLocaleChange, setLocale, type Locale } from "../i18n/locale";

export interface LanguagePickerOptions {
  readonly className: string;
  /**
   * Letter keys belong to the game, not to the menu's type-to-select: with
   * the menu focused, E would otherwise pick English or Español instead of
   * gathering, and D would switch to German.
   */
  readonly releaseLetters?: boolean;
}

export function createLanguagePicker(host: HTMLElement, options: LanguagePickerOptions): () => void {
  const select = document.createElement("select");
  select.className = options.className;
  for (const option of LOCALES) {
    const item = document.createElement("option");
    item.value = option.id;
    item.lang = option.id;
    item.textContent = option.name;
    select.append(item);
  }

  const sync = (): void => {
    const current = locale();
    select.value = current;
    select.setAttribute("aria-label", LOCALES.find((option) => option.id === current)?.menuLabel ?? "Language");
  };
  sync();

  select.addEventListener("change", () => {
    setLocale(select.value as Locale, { remember: true });
    // Hand the keyboard back: a focused menu would take the next W or S as a
    // request to change language again.
    select.blur();
  });

  if (options.releaseLetters) {
    select.addEventListener("keydown", (event) => {
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
      // Still reaches the game's own listener on the window; only the menu's
      // reaction is cancelled.
      event.preventDefault();
      select.blur();
    });
  }

  host.append(select);
  const stop = onLocaleChange(sync);
  return () => {
    stop();
    select.remove();
  };
}
