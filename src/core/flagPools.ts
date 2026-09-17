import { indexCountries, type Continent, type Country, type CountryIndex, type RawCountry } from "./countries";
import { territoryFlags } from "./territoryFlags";

export const FLAG_POOLS = ["countries", "territories", "both"] as const;
export type FlagPool = (typeof FLAG_POOLS)[number];
export const DEFAULT_FLAG_POOL: FlagPool = "countries";

export interface FlagPoolOption {
  readonly id: FlagPool;
  readonly label: string;
  readonly shortLabel: string;
}

export const flagPoolOptions: readonly FlagPoolOption[] = [
  { id: "countries", label: "Countries", shortLabel: "Countries" },
  { id: "territories", label: "Territories & dependencies", shortLabel: "Territories" },
  { id: "both", label: "Countries + territories", shortLabel: "Both" },
];

export function isFlagPool(value: unknown): value is FlagPool {
  return typeof value === "string" && (FLAG_POOLS as readonly string[]).includes(value);
}

export function normalizeFlagPool(value: unknown): FlagPool {
  return isFlagPool(value) ? value : DEFAULT_FLAG_POOL;
}

export function flagPoolLabel(flagPool: FlagPool): string {
  return flagPoolOptions.find((option) => option.id === flagPool)?.label ?? flagPoolOptions[0]!.label;
}

interface TerritoryGeography {
  readonly continent: Continent;
  readonly geographyLabel?: string;
  readonly aliases?: readonly string[];
}

// Geography is only used for optional hints/atlas grouping. The flag game itself is name/code
// based. A few oceanic/subantarctic entries use a more precise geographyLabel because the
// sovereign-country continent enum intentionally does not add extra regions just for flags.
const TERRITORY_GEOGRAPHY: Readonly<Record<string, TerritoryGeography>> = {
  AS: { continent: "Oceania" },
  AI: { continent: "North America", geographyLabel: "the Caribbean" },
  AQ: { continent: "Oceania", geographyLabel: "Antarctica" },
  AC: { continent: "Africa", geographyLabel: "the South Atlantic" },
  AW: { continent: "North America", geographyLabel: "the Caribbean" },
  AX: { continent: "Europe" },
  BM: { continent: "North America", geographyLabel: "the North Atlantic" },
  "BQ-BO": { continent: "North America", geographyLabel: "the Caribbean" },
  BV: { continent: "Africa", geographyLabel: "the subantarctic South Atlantic" },
  IO: { continent: "Asia", geographyLabel: "the Indian Ocean" },
  VG: { continent: "North America", geographyLabel: "the Caribbean", aliases: ["BVI"] },
  KY: { continent: "North America", geographyLabel: "the Caribbean" },
  CX: { continent: "Asia", geographyLabel: "the Indian Ocean" },
  CC: { continent: "Asia", geographyLabel: "the Indian Ocean", aliases: ["Cocos Islands"] },
  CK: { continent: "Oceania" },
  CW: { continent: "North America", geographyLabel: "the Caribbean" },
  FK: { continent: "South America", geographyLabel: "the South Atlantic", aliases: ["Falklands"] },
  FO: { continent: "Europe", geographyLabel: "the North Atlantic" },
  GF: { continent: "South America" },
  PF: { continent: "Oceania" },
  TF: { continent: "Africa", geographyLabel: "the southern Indian Ocean" },
  GI: { continent: "Europe" },
  GL: { continent: "North America" },
  GP: { continent: "North America", geographyLabel: "the Caribbean" },
  GU: { continent: "Oceania" },
  GG: { continent: "Europe", geographyLabel: "the Channel Islands" },
  HM: { continent: "Oceania", geographyLabel: "the subantarctic Indian Ocean" },
  HK: { continent: "Asia", aliases: ["Hong Kong SAR"] },
  IM: { continent: "Europe" },
  JE: { continent: "Europe", geographyLabel: "the Channel Islands" },
  MO: { continent: "Asia", aliases: ["Macao"] },
  MQ: { continent: "North America", geographyLabel: "the Caribbean" },
  YT: { continent: "Africa", geographyLabel: "the Indian Ocean" },
  MS: { continent: "North America", geographyLabel: "the Caribbean" },
  NC: { continent: "Oceania" },
  NU: { continent: "Oceania" },
  NF: { continent: "Oceania" },
  MP: { continent: "Oceania", aliases: ["Northern Marianas"] },
  PN: { continent: "Oceania", aliases: ["Pitcairn"] },
  PR: { continent: "North America", geographyLabel: "the Caribbean" },
  RE: { continent: "Africa", geographyLabel: "the Indian Ocean" },
  "BQ-SA": { continent: "North America", geographyLabel: "the Caribbean" },
  BL: { continent: "North America", geographyLabel: "the Caribbean", aliases: ["St Barthelemy", "St Barts", "St Barths"] },
  SH: { continent: "Africa", geographyLabel: "the South Atlantic" },
  MF: { continent: "North America", geographyLabel: "the Caribbean", aliases: ["St Martin"] },
  PM: { continent: "North America", geographyLabel: "the North Atlantic" },
  "BQ-SE": { continent: "North America", geographyLabel: "the Caribbean", aliases: ["Statia"] },
  SX: { continent: "North America", geographyLabel: "the Caribbean" },
  GS: { continent: "South America", geographyLabel: "the subantarctic South Atlantic" },
  SJ: { continent: "Europe", geographyLabel: "the Arctic" },
  TK: { continent: "Oceania" },
  TA: { continent: "Africa", geographyLabel: "the South Atlantic" },
  TC: { continent: "North America", geographyLabel: "the Caribbean" },
  UM: { continent: "Oceania", geographyLabel: "the Pacific and Caribbean", aliases: ["United States Minor Outlying Islands"] },
  VI: { continent: "North America", geographyLabel: "the Caribbean", aliases: ["US Virgin Islands", "United States Virgin Islands", "USVI"] },
  WF: { continent: "Oceania" },
  EH: { continent: "Africa" },
};

function rawCountry(country: Country, allowedCategoryIds?: readonly string[]): RawCountry {
  return {
    name: country.name,
    code: country.code,
    aliases: country.aliases,
    continent: country.continent,
    flagSrc: country.flagSrc,
    capital: country.capital,
    capitalAliases: country.capitalAliases,
    ...(allowedCategoryIds ? { allowedCategoryIds } : country.allowedCategoryIds ? { allowedCategoryIds: country.allowedCategoryIds } : {}),
    ...(country.geographyLabel ? { geographyLabel: country.geographyLabel } : {}),
  };
}

function territoryRawCountries(): readonly RawCountry[] {
  return territoryFlags.map((territory) => {
    const geography = TERRITORY_GEOGRAPHY[territory.code] ?? { continent: "Oceania" as const };
    return {
      name: territory.name,
      code: territory.code,
      aliases: geography.aliases ?? [],
      continent: geography.continent,
      flagSrc: territory.flagSrc,
      capital: "",
      capitalAliases: [],
      allowedCategoryIds: ["flags"],
      ...(geography.geographyLabel ? { geographyLabel: geography.geographyLabel } : {}),
    };
  });
}

/**
 * Builds the country-like prompt index used by flag rounds.
 *
 * Territories are deliberately eligible only for the plain Flags category. In a mixed multiplayer
 * rotation, choosing "Territories" means territory artwork supplies the flag rounds while normal
 * countries remain available for Capitals/Codes/etc. Choosing "Both" keeps normal countries in
 * every selected mode and adds territory-only flag rounds.
 */
export function createPromptCountryIndex(baseIndex: CountryIndex, categoryIds: readonly string[], flagPool: FlagPool): CountryIndex {
  if (!categoryIds.includes("flags") || flagPool === "countries") return baseIndex;

  const territories = territoryRawCountries();
  if (flagPool === "both") {
    return indexCountries([...baseIndex.countries.map((country) => rawCountry(country)), ...territories]);
  }

  const nonFlagCategoryIds = categoryIds.filter((categoryId) => categoryId !== "flags");
  if (nonFlagCategoryIds.length === 0) return indexCountries(territories);

  const countriesWithoutFlagRounds = baseIndex.countries.map((country) => rawCountry(country, nonFlagCategoryIds));
  return indexCountries([...countriesWithoutFlagRounds, ...territories]);
}
