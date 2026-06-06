import { addNormalizedAnswer, isToleratedMisspelling, normalizeAnswer, normalizeAnswerVariants } from "./normalize";
import type { AnswerOptions, Country, CountryId, CountryIndex, RawCountry } from "./types";

const DEFAULT_ANSWER_OPTIONS: AnswerOptions = {
  includeCodes: true,
  includeAliases: true,
};

const COMMON_ALIASES: Readonly<Record<string, readonly string[]>> = {
  AE: ["UAE", "U.A.E."],
  BA: ["Bosnia Herzegovina", "BiH"],
  CD: ["DR Congo", "DRC", "D.R.C."],
  CF: ["CAR", "C.A.R."],
  GB: ["UK", "U.K.", "Britain", "Great Britain"],
  KR: ["South Korea", "ROK"],
  KP: ["North Korea", "DPRK"],
  NZ: ["NZ", "N.Z."],
  PG: ["PNG", "P.N.G."],
  SA: ["KSA", "Saudi"],
  US: ["USA", "U.S.A.", "U.S.", "America"],
  ZA: ["RSA", "South Africa"],
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
    for (const alias of COMMON_ALIASES[country.code.toUpperCase()] ?? []) addNormalizedAnswer(answers, alias);
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
  const guesses = normalizeAnswerVariants(answer);
  if (guesses.length === 0) return false;

  const answerSet = index.answerSetByCountryId.get(countryId);
  if (!answerSet) return false;
  if (guesses.some((guess) => answerSet.has(guess))) return true;

  return [...answerSet].some((candidate) => isToleratedMisspelling(answer, candidate));
}
