/**
 * The game's translations.
 *
 * The compiler already insists that every language has every key. What it
 * cannot see is a translation that dropped or misspelt a placeholder, which
 * would put a literal "{area}" on screen, or lost the number entirely.
 */

import { afterEach, describe, expect, it } from "vitest";
import { de } from "../../src/i18n/de";
import { en, type MessageKey, type Messages } from "../../src/i18n/en";
import { es } from "../../src/i18n/es";
import { fr } from "../../src/i18n/fr";
import { formatNumber, setLocale, t, tn } from "../../src/i18n";
import { negotiate } from "../../src/i18n/locale";
import { formatArea } from "../../src/game/format";
import { keyLabel, keyLabels } from "../../src/ui/keys";

const TRANSLATIONS: Record<string, Messages> = { es, de, fr };

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => setLocale("en"));

describe("translations", () => {
  for (const [id, messages] of Object.entries(TRANSLATIONS)) {
    it(`${id} keeps every placeholder the English has, and adds none`, () => {
      for (const key of Object.keys(en) as MessageKey[]) {
        expect(placeholders(messages[key]), key).toEqual(placeholders(en[key]));
      }
    });

    it(`${id} has no empty strings`, () => {
      for (const key of Object.keys(en) as MessageKey[]) expect(messages[key].trim(), key).not.toBe("");
    });
  }

  it("pairs every singular with a plural", () => {
    for (const key of Object.keys(en)) {
      if (key.endsWith(".one")) expect(en).toHaveProperty(key.replace(/\.one$/, ".other"));
    }
  });
});

describe("t", () => {
  it("fills placeholders", () => {
    expect(t("toast.rain", { depth: "23" })).toBe("Rain moving in — 23 mm");
  });

  it("switches language", () => {
    setLocale("de");
    expect(t("tool.pond")).toBe("Teich");
    setLocale("fr");
    expect(t("tool.pond")).toBe("Mare");
  });

  it("formats numbers for the language", () => {
    expect(formatNumber(2.5, 1)).toBe("2.5");
    setLocale("de");
    expect(formatNumber(2.5, 1)).toBe("2,5");
    expect(formatArea(25_000)).toBe("2,5 ha");
    setLocale("fr");
    expect(formatArea(25_000)).toBe("2,5 ha");
  });

  it("agrees a count with its noun, the way each language does", () => {
    expect(tn("toast.restored", 1)).toBe("Restored — 1 feature");
    expect(tn("toast.restored", 3)).toBe("Restored — 3 features");
    expect(tn("toast.restored", 0)).toBe("Restored — 0 features");
    // French counts zero as singular.
    setLocale("fr");
    expect(tn("toast.restored", 0)).toBe("Partie restaurée — 0 aménagement");
    expect(tn("toast.restored", 2)).toBe("Partie restaurée — 2 aménagements");
  });
});

describe("choosing a language", () => {
  it("takes the first supported language in the browser's order, by primary subtag", () => {
    expect(negotiate(["de-AT", "en"])).toBe("de");
    expect(negotiate(["it-IT", "fr-CA", "en"])).toBe("fr");
    expect(negotiate(["es-419"])).toBe("es");
    expect(negotiate(["en-US", "de"])).toBe("en");
    expect(negotiate(["it", "pt"])).toBeNull();
  });
});

describe("key labels", () => {
  // No layout map outside a Chromium page, so these are the QWERTY fallbacks.
  it("names physical keys as US QWERTY when the layout is unknown", () => {
    expect(keyLabel("KeyM")).toBe("M");
    expect(keyLabels("KeyW", "KeyA", "KeyS", "KeyD")).toBe("WASD");
    expect(keyLabel("Minus")).toBe("−");
    expect(keyLabel("Tab")).toBe("Tab");
  });

  it("always names a digit key by its digit", () => {
    expect(keyLabel("Digit2")).toBe("2");
  });
});
