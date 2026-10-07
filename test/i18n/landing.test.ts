/**
 * The landing page's translations against the page itself.
 *
 * The English lives in `index.html`, so the keys are only known there: a
 * paragraph tagged in the page but missing from a translation would quietly
 * stay English, and a key left behind after the page changed would never show.
 * The markup inside a translation is the page's too — its links, key caps and
 * code spans must survive translation unchanged.
 */

import { describe, expect, it } from "vitest";
import page from "../../index.html?raw";
import { de } from "../../src/i18n/landing/de";
import { es } from "../../src/i18n/landing/es";
import { fr } from "../../src/i18n/landing/fr";
import type { LandingMessages } from "../../src/i18n/landing/types";

/** Inner HTML of every `data-i18n` element, by key. */
function contentKeys(html: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of html.matchAll(/<(\w+)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>/g)) {
    const [opening, tag, key] = match;
    const start = (match.index ?? 0) + opening.length;
    const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
    pattern.lastIndex = start;
    let depth = 1;
    let end = start;
    for (let next = pattern.exec(html); next && depth > 0; next = pattern.exec(html)) {
      depth += next[1] ? -1 : 1;
      end = next.index;
    }
    found.set(key, html.slice(start, end));
  }
  return found;
}

const attributeKeys = new Set([...page.matchAll(/data-i18n-[a-z-]+="([^"]+)"/g)].map((match) => match[1]));
const english = contentKeys(page);

/** The parts of some markup a translation must not change, in a comparable order. */
function skeleton(html: string): string[] {
  const tags = [...html.matchAll(/<(\/?)(\w+)([^>]*)>/g)].map(([, close, tag, attributes]) => {
    const kept = [...attributes.matchAll(/\b(href|data-key)="([^"]*)"/g)].map(([, name, value]) => ` ${name}=${value}`);
    return `${close}${tag}${kept.join("")}`;
  });
  const code = [...html.matchAll(/<code>([^<]*)<\/code>/g)].map(([, text]) => `code:${text}`);
  return [...tags, ...code].sort();
}

const TRANSLATIONS: Record<string, LandingMessages> = { es, de, fr };

describe("landing page translations", () => {
  it("finds the page's tagged text", () => {
    expect(english.size).toBeGreaterThan(80);
    expect(english.get("hero.tagline")).toBe("A diffuse pollution game");
  });

  for (const [id, messages] of Object.entries(TRANSLATIONS)) {
    it(`${id} covers exactly the keys the page uses`, () => {
      const wanted = [...new Set([...english.keys(), ...attributeKeys])].sort();
      expect(Object.keys(messages).sort()).toEqual(wanted);
    });

    it(`${id} keeps every link, key cap and code span`, () => {
      for (const [key, text] of english) expect(skeleton(messages[key]), key).toEqual(skeleton(text));
    });

    it(`${id} puts no markup in attributes`, () => {
      for (const key of attributeKeys) expect(messages[key], key).not.toMatch(/[<>]/);
    });
  }
});
