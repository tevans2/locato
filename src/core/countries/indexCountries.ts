import { addNormalizedAnswer, normalizeAnswer } from "./normalize";
import type { AnswerOptions, Country, CountryId, CountryIndex, RawCountry } from "./types";

const DEFAULT_ANSWER_OPTIONS: AnswerOptions = {
  includeCodes: true,
  includeAliases: true,
};

export function buildAcceptedAnswers(
  country: RawCountry,
  options: AnswerOptions = DEFAULT_ANSWER_OPTIONS,
): readonly string[] {
  const answers = new Set<string>();
  addNormalizedAnswer(answers, country.name);

  if (options.includeCodes) addNormalizedAnswer(answers, country.code);

  if (options.includeAliases) {
    for (const alias of country.aliases) addNormalizedAnswer(answers, alias);
  }

  return [...answers].sort();
}

export function indexCountries(
  rawCountries: readonly RawCountry[],
  options: AnswerOptions = DEFAULT_ANSWER_OPTIONS,
): CountryIndex {
  const countries: Country[] = rawCountries.map((country, id) => ({
    id,
    name: country.name,
    code: country.code.toUpperCase(),
    aliases: [...country.aliases],
    continent: country.continent,
    flagSrc: country.flagSrc,
    normalizedName: normalizeAnswer(country.name),
    acceptedAnswers: buildAcceptedAnswers(country, options),
  }));

  const byCode = new Map<string, Country>();
  const byAnswerMutable = new Map<string, CountryId[]>();
  const answerSetByCountryId = new Map<CountryId, ReadonlySet<string>>();

  for (const country of countries) {
    byCode.set(country.code, country);
    const answerSet = new Set(country.acceptedAnswers);
    answerSetByCountryId.set(country.id, answerSet);

    for (const answer of answerSet) {
      const existing = byAnswerMutable.get(answer);
      if (existing) existing.push(country.id);
      else byAnswerMutable.set(answer, [country.id]);
    }
  }

  return {
    countries,
    byId: countries,
    byCode,
    byAnswer: byAnswerMutable,
    answerSetByCountryId,
  };
}

export function isCorrectAnswer(index: CountryIndex, countryId: CountryId, answer: string): boolean {
  const normalized = normalizeAnswer(answer);
  if (!normalized) return false;
  return index.answerSetByCountryId.get(countryId)?.has(normalized) ?? false;
}
