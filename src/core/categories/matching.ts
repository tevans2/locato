import { isToleratedMisspelling, normalizeAnswerVariants, type Country } from "../countries";

// Shared matcher for country-backed categories. `acceptCode` lets flags accept the ISO code as a
// shortcut, while code-prompt categories disable it so the visible prompt isn't a free answer.
export function matchesCountryName(country: Country, guess: string, auto: boolean, acceptCode = true): boolean {
  const guesses = normalizeAnswerVariants(guess);
  if (guesses.length === 0) return false;
  if (auto) return guesses.includes(country.normalizedName);

  const exact = new Set<string>();
  const sources = acceptCode ? [country.name, ...country.aliases, country.code] : [country.name, ...country.aliases];
  for (const value of sources) {
    for (const variant of normalizeAnswerVariants(value)) exact.add(variant);
  }
  if (guesses.some((candidate) => exact.has(candidate))) return true;

  return [country.name, ...country.aliases].some((answer) => isToleratedMisspelling(guess, answer));
}

export function matchesCapitalName(country: Country, guess: string, auto: boolean): boolean {
  const guesses = normalizeAnswerVariants(guess);
  if (guesses.length === 0 || country.capital.length === 0) return false;

  const exact = new Set<string>();
  for (const value of [country.capital, ...country.capitalAliases]) {
    for (const variant of normalizeAnswerVariants(value)) exact.add(variant);
  }

  if (guesses.some((candidate) => exact.has(candidate))) return true;
  if (auto) return false;

  return [country.capital, ...country.capitalAliases].some((answer) => isToleratedMisspelling(guess, answer));
}
