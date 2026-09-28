import {
  compactAnswer,
  isToleratedMisspelling,
  levenshteinDistance,
  normalizeAnswer,
  normalizeAnswerVariants,
  type Country,
  type CountryCode,
  type CountryIndex,
} from "../countries";
import type { AcademySkill } from "./types";

export interface TypedAnswerResult {
  readonly correct: boolean;
  /** Accepted despite a typo; show `canonical` so the player sees the right spelling. */
  readonly near: boolean;
  /** The display spelling: country name for flag/shape, capital for capital. */
  readonly canonical: string;
}

function countryAnswers(country: Country): readonly string[] {
  // Bare ISO codes ("fr") are accepted in the main game but would short-circuit learning.
  const code = normalizeAnswer(country.code);
  const aliases = new Set(country.aliases.map(normalizeAnswer));
  return country.acceptedAnswers.filter((answer) => answer !== code || aliases.has(answer));
}

function capitalAnswers(country: Country): readonly string[] {
  return [country.capital, ...country.capitalAliases].flatMap((value) => normalizeAnswerVariants(value));
}

/** Short names (Chad, Peru, Iran) fall below the shared typo tolerance, so allow one edit there. */
function isShortNameTypo(guess: string, answer: string): boolean {
  const compactGuess = compactAnswer(guess);
  const compactCandidate = compactAnswer(answer);
  if (compactCandidate.length !== 4 || Math.abs(compactGuess.length - 4) > 1) return false;
  return levenshteinDistance(compactGuess, compactCandidate) <= 1;
}

/** True when the guess is exactly some other country's answer (e.g. "Iraq" when the answer is Iran). */
function isOtherAnswer(countryIndex: CountryIndex, country: Country, skill: AcademySkill, guesses: readonly string[]): boolean {
  return countryIndex.countries.some((other) => {
    if (other.code === country.code) return false;
    const answers = skill === "capital" ? capitalAnswers(other) : countryAnswers(other);
    return guesses.some((guess) => answers.includes(guess));
  });
}

export function checkTypedAnswer(
  countryIndex: CountryIndex,
  code: CountryCode,
  skill: Exclude<AcademySkill, "map">,
  input: string,
): TypedAnswerResult {
  const country = countryIndex.byCode.get(code.toUpperCase());
  if (!country) return { correct: false, near: false, canonical: "" };

  const canonical = skill === "capital" ? country.capital : country.name;
  const answers = skill === "capital" ? capitalAnswers(country) : countryAnswers(country);
  const guesses = normalizeAnswerVariants(input);
  if (guesses.length === 0) return { correct: false, near: false, canonical };

  if (guesses.some((guess) => answers.includes(guess))) return { correct: true, near: false, canonical };
  if (isOtherAnswer(countryIndex, country, skill, guesses)) return { correct: false, near: false, canonical };

  const near = answers.some((answer) => isToleratedMisspelling(input, answer) || isShortNameTypo(input, answer));
  return { correct: near, near, canonical };
}
