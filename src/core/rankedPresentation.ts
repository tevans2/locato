import { getCategory } from "./categories";
import { detectCountryGuess, submitCountryGuess } from "./map/countryGuessing";
import type { Country, CountryId, CountryIndex } from "./countries";
import type { RankedQuestion } from "./ranked";

/**
 * An opaque current-clue fingerprint for synchronous presentation, not an anti-cheat secret.
 * A dictionary can recover the CURRENT answer. Future clues stay private, and the server
 * independently validates every move; this value can never authorize scores or timing.
 */
export function rankedAnswerToken(questionId: string, countryCode: string): string {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (const char of `${questionId}:${countryCode}`) {
    a = Math.imul(a ^ char.charCodeAt(0), 0x01000193);
    b = Math.imul(b ^ char.charCodeAt(0), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** The same matchers as practice; only a current clue may be predicted locally. */
export function rankedGuessCountry(index: CountryIndex, question: RankedQuestion | null, mode: string, value: string, auto: boolean, found: ReadonlySet<CountryId> = new Set()): Country | null {
  if (!question) return null;
  if (mode === "name-all" || mode === "spot-country" || mode === "streetview-country") {
    const country = (auto ? detectCountryGuess : submitCountryGuess)(index, value, found);
    return country && (mode === "name-all" || rankedAnswerToken(question.id, country.code) === question.answerToken) ? country : null;
  }
  const category = getCategory(mode);
  if (!category || !question.answerToken) return null;
  return index.countries.find((country) => category.eligible(country) && category.accepts(country, value, auto) && rankedAnswerToken(question.id, country.code) === question.answerToken) ?? null;
}
