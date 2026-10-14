import { isToleratedMisspelling, normalizeAnswer, type Country, type CountryIndex } from "../countries";
import { submitCountryGuess } from "../map/countryGuessing";

/**
 * The country a typed guess names: an exact name, alias or ISO code first, then a small
 * misspelling when it fits exactly one country. Null when nothing (or more than one country,
 * e.g. "Congo") matches.
 */
export function resolveCountryName(index: CountryIndex, text: string): Country | null {
  const exact = submitCountryGuess(index, text, new Set());
  if (exact) return exact;
  const close = index.countries.filter((country) => [country.name, ...country.aliases].some((answer) => isToleratedMisspelling(text, answer)));
  return close.length === 1 ? close[0]! : null;
}

/**
 * Countries to offer while typing, best match first: names starting with the text, then aliases
 * starting with it, then names with a word starting with it. `exclude` holds codes not to offer.
 */
export function suggestCountryNames(index: CountryIndex, text: string, exclude: ReadonlySet<string> = new Set(), limit = 6): readonly Country[] {
  const query = normalizeAnswer(text);
  if (query.length < 2) return [];
  const ranked: { readonly country: Country; readonly rank: number }[] = [];
  for (const country of index.countries) {
    if (exclude.has(country.code)) continue;
    const name = country.normalizedName;
    const aliases = country.aliases.map(normalizeAnswer);
    let rank = -1;
    if (name.startsWith(query)) rank = 0;
    else if (aliases.some((alias) => alias.startsWith(query))) rank = 1;
    else if (name.split(" ").some((word) => word.startsWith(query))) rank = 2;
    else if (aliases.some((alias) => alias.split(" ").some((word) => word.startsWith(query)))) rank = 3;
    if (rank >= 0) ranked.push({ country, rank });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.country.name.localeCompare(b.country.name));
  return ranked.slice(0, limit).map((item) => item.country);
}
