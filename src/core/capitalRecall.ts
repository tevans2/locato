import { matchesCapitalName } from "./categories/matching";
import type { Country, CountryId, CountryIndex } from "./countries";

export type CapitalRecallPlayStyle = "randomised" | "freestyle";

export interface FreestyleCapitalMatch {
  readonly matchedCountries: readonly Country[];
  readonly newCountries: readonly Country[];
  readonly alreadySolvedCountries: readonly Country[];
}

export function matchFreestyleCapital(
  countryIndex: CountryIndex,
  guess: string,
  solvedCountryIds: ReadonlySet<CountryId>,
  auto = false,
): FreestyleCapitalMatch {
  const matchedCountries = countryIndex.countries.filter(
    (country) => country.capital.length > 0 && matchesCapitalName(country, guess, auto),
  );

  return {
    matchedCountries,
    newCountries: matchedCountries.filter((country) => !solvedCountryIds.has(country.id)),
    alreadySolvedCountries: matchedCountries.filter((country) => solvedCountryIds.has(country.id)),
  };
}
