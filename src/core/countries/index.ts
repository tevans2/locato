export { rawCountries } from "./countries";
export { addNormalizedAnswer, compactAnswer, isToleratedMisspelling, levenshteinDistance, normalizeAnswer, normalizeAnswerVariants } from "./normalize";
export { buildAcceptedAnswers, indexCountries, isCorrectAnswer } from "./indexCountries";
export { validateCountries } from "./validateCountries";
export type {
  AnswerCollision,
  CountryValidationIssue,
  CountryValidationOptions,
  CountryValidationResult,
} from "./validateCountries";
export type { AnswerOptions, Continent, Country, CountryCode, CountryId, CountryIndex, RawCountry } from "./types";
export { CONTINENTS } from "./types";
