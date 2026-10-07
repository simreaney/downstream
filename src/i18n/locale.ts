/**
 * Which language the page is in, and how that was decided.
 *
 * Kept apart from the message tables so the landing page, which has its own
 * text, can share the choice without bundling the game's.
 *
 * The order is: `?lang=` in the URL, then a language the player picked
 * earlier, then the browser's own preference list, then English. The URL wins
 * so a teacher can hand a class a link in their language; the stored pick
 * beats the browser so choosing English on a German machine sticks.
 */

export type Locale = "en" | "es" | "de" | "fr";

/**
 * Every supported language, named in itself so a player can find their own,
 * with the word for "language" that labels the menu while it is current.
 */
export const LOCALES: readonly { readonly id: Locale; readonly name: string; readonly menuLabel: string }[] = [
  { id: "en", name: "English", menuLabel: "Language" },
  { id: "es", name: "Español", menuLabel: "Idioma" },
  { id: "de", name: "Deutsch", menuLabel: "Sprache" },
  { id: "fr", name: "Français", menuLabel: "Langue" },
];

/** Shared by the landing page and the game, which are served from one origin. */
const STORAGE_KEY = "downstream.language";

/** BCP 47 tag for `<html lang>` and `Intl`. The English text is British. */
const TAGS: Record<Locale, string> = { en: "en-GB", es: "es", de: "de", fr: "fr" };

let current: Locale = "en";
const listeners = new Set<() => void>();

export function locale(): Locale {
  return current;
}

export function languageTag(id: Locale = current): string {
  return TAGS[id];
}

function isLocale(value: string | null | undefined): value is Locale {
  return LOCALES.some((option) => option.id === value);
}

/** The first of the browser's preferred languages we have, by primary subtag: `de-AT` is German. */
export function negotiate(preferred: readonly string[]): Locale | null {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

function readStored(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Storage can be blocked outright; the browser's preference still applies.
    return null;
  }
}

/** The language this visit should open in. */
export function resolveLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const fromUrl = new URLSearchParams(window.location.search).get("lang")?.toLowerCase();
  if (isLocale(fromUrl)) return fromUrl;
  return readStored() ?? negotiate(navigator.languages ?? [navigator.language]) ?? "en";
}

/**
 * Switch language and tell every subscriber to redraw.
 *
 * `remember` is for an explicit pick from a language menu. It is stored, and
 * a `?lang=` already in the address bar is rewritten to match, or reloading
 * the page would quietly switch back.
 */
export function setLocale(next: Locale, options: { remember?: boolean } = {}): void {
  if (options.remember && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best effort, as for reading.
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", next);
      window.history.replaceState(window.history.state, "", url);
    }
  }
  if (next === current) return;
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = TAGS[next];
  for (const listener of listeners) listener();
}

/** Call `listener` after every language change. Returns the unsubscribe. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
