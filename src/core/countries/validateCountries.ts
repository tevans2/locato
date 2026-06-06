import { CONTINENTS, type CountryIndex } from "./types";

export interface AnswerCollision {
  readonly answer: string;
  readonly countryIds: readonly number[];
}

export interface CountryValidationIssue {
  readonly code: string;
  readonly message: string;
}

export interface CountryValidationResult {
  readonly valid: boolean;
  readonly issues: readonly CountryValidationIssue[];
  readonly collisions: readonly AnswerCollision[];
}

export interface CountryValidationOptions {
  readonly expectedCount?: number;
  readonly availableFlagPaths?: ReadonlySet<string>;
}

const CONTINENT_SET = new Set<string>(CONTINENTS);

export function validateCountries(
  index: CountryIndex,
  options: CountryValidationOptions = {},
): CountryValidationResult {
  const expectedCount = options.expectedCount ?? 196;
  const issues: CountryValidationIssue[] = [];
  const collisions: AnswerCollision[] = [];
  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();

  if (index.countries.length !== expectedCount) {
    issues.push({
      code: "country-count",
      message: `Expected ${expectedCount} countries, found ${index.countries.length}.`,
    });
  }

  for (const country of index.countries) {
    if (seenCodes.has(country.code)) {
      issues.push({ code: "duplicate-code", message: `Duplicate country code: ${country.code}.` });
    }
    seenCodes.add(country.code);

    const normalizedName = country.normalizedName;
    if (seenNames.has(normalizedName)) {
      issues.push({ code: "duplicate-name", message: `Duplicate country name: ${country.name}.` });
    }
    seenNames.add(normalizedName);

    if (!CONTINENT_SET.has(country.continent)) {
      issues.push({ code: "invalid-continent", message: `${country.name} has invalid continent ${country.continent}.` });
    }

    if (country.acceptedAnswers.length === 0) {
      issues.push({ code: "empty-answer-set", message: `${country.name} has no accepted answers.` });
    }

    if (country.acceptedAnswers.some((answer) => answer.length === 0)) {
      issues.push({ code: "blank-answer", message: `${country.name} has a blank accepted answer.` });
    }

    if (options.availableFlagPaths && !options.availableFlagPaths.has(country.flagSrc)) {
      issues.push({ code: "missing-flag", message: `${country.name} is missing flag ${country.flagSrc}.` });
    }
  }

  for (const [answer, countryIds] of index.byAnswer) {
    if (countryIds.length > 1) collisions.push({ answer, countryIds });
  }

  return {
    valid: issues.length === 0,
    issues,
    collisions,
  };
}
