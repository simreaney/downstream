/**
 * Translated text for the game.
 *
 * All four languages are bundled rather than fetched: together they are a few
 * kilobytes against three's half a megabyte, and a synchronous `t()` means no
 * panel ever has to wait for its own labels.
 *
 * Every panel draws its text through `t()` and redraws on `onLocaleChange`, so
 * switching language mid-game relabels the screen in place. Toasts and build
 * messages are the exception: they are news, gone in a few seconds, and are
 * simply written in whatever language was current when they happened.
 */

import { de } from "./de";
import { en, type MessageKey, type Messages } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { languageTag, locale, type Locale } from "./locale";

export { LOCALES, languageTag, locale, onLocaleChange, resolveLocale, setLocale, type Locale } from "./locale";
export type { MessageKey, Messages, ProgressStage } from "./en";

const CATALOGUES: Record<Locale, Messages> = { en, es, de, fr };

/** Placeholder values. Numbers are formatted for the language; use `formatNumber` for decimals. */
export type MessageParams = Readonly<Record<string, string | number>>;

/** The text for `key` in the current language, with `{name}` placeholders filled. */
export function t(key: MessageKey, params?: MessageParams): string {
  const template = CATALOGUES[locale()][key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(value) : value;
  });
}

/** Base keys that have both a `.one` and an `.other` form. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends MessageKey ? Base : never) : never;
}[MessageKey];

const pluralRules = new Map<string, Intl.PluralRules>();

/**
 * A count with the noun agreeing: `tn("toast.restored", 1)` is "1 feature".
 *
 * French treats 0 as singular, which `Intl.PluralRules` knows. Categories
 * other than "one" (Spanish and French have a "many" for round millions) take
 * the `.other` form.
 */
export function tn(key: PluralKey, count: number, params?: MessageParams): string {
  const tag = languageTag();
  let rules = pluralRules.get(tag);
  if (!rules) {
    rules = new Intl.PluralRules(tag);
    pluralRules.set(tag, rules);
  }
  const form = rules.select(count) === "one" ? "one" : "other";
  return t(`${key}.${form}` as MessageKey, { count, ...params });
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** `value` with exactly `digits` decimals, in the language's own notation: 2.5 is "2,5" in German. */
export function formatNumber(value: number, digits = 0): string {
  const tag = languageTag();
  const id = `${tag}:${digits}`;
  let format = numberFormats.get(id);
  if (!format) {
    format = new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    numberFormats.set(id, format);
  }
  return format.format(value);
}
