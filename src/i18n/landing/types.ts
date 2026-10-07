/**
 * One language's text for the landing page, keyed by the `data-i18n` names in
 * `index.html`. HTML is allowed, and is the page's own: a translation keeps
 * the English version's links, key caps and code spans, which
 * `test/i18n/landing.test.ts` checks.
 */
export type LandingMessages = Readonly<Record<string, string>>;
