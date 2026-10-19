import type { Continent, CountryCode } from "./types";

/**
 * Countries that span two continents. Each keeps its one `continent` (atlas, puzzle, clues) and is also
 * counted here when a game asks for every country in a continent.
 */
const ALSO_IN: Readonly<Record<CountryCode, readonly Continent[]>> = {
  TR: ["Europe"],
  CY: ["Europe"],
};

export function isInContinent(country: { readonly code: CountryCode; readonly continent: string }, continent: string): boolean {
  return country.continent === continent || (ALSO_IN[country.code]?.includes(continent as Continent) ?? false);
}
