/**
 * Locale propagation for Customer Zero.
 *
 * ABSOLUTE RULE: every generated text the CEO can see must be written in the
 * UI/session locale. The schema keys stay in English; the *values* are
 * produced directly by the LLM in the right language (no mechanical
 * post-translation).
 */

export type SupportedLocale = "es" | "en";

const DEFAULT_LOCALE: SupportedLocale = "es";

export function resolveLocale(value: unknown): SupportedLocale {
  if (typeof value !== "string") {
    return DEFAULT_LOCALE;
  }
  const normalized = value.toLowerCase().slice(0, 2);
  return normalized === "en" ? "en" : normalized === "es" ? "es" : DEFAULT_LOCALE;
}

export function languageName(locale: SupportedLocale): string {
  return locale === "en" ? "English" : "Spanish (español)";
}

/**
 * The instruction appended to every prompt whose output the CEO will read.
 */
export function localeInstruction(locale: SupportedLocale): string {
  return (
    `IMPORTANT: every value you write must be in ${languageName(locale)}. ` +
    "JSON keys stay in English, but all human-readable content (activity, " +
    "products, services, audience, tone, locations, mission, market, " +
    "positioning, value proposition, summaries, titles, descriptions and " +
    `questions) must be written in ${languageName(locale)}. ` +
    "Translate what you found on the source material if it is in another " +
    "language. Never mix languages."
  );
}

/** UI-facing copy owned by the backend (stage labels, fallbacks). */
export function t(
  locale: SupportedLocale,
  es: string,
  en: string,
): string {
  return locale === "en" ? en : es;
}
