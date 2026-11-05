import type { Country, CountryId, CountryIndex } from "../countries";
import { COUNTRY_BORDERS } from "../countries/borders.data";
import { WORLD_SPLIT_POPULATION_MILLIONS } from "../worldsplit/population";
import type { Hint } from "./types";

// Number of distinct hints before the hint button flips to "Reveal answer".
export const TOTAL_HINTS = 3;

export interface HintContext {
  /**
   * True when the active pool is dominated by borderless (island) nations — e.g. the
   * "Island hopping" daily. Border-profile hints narrow nothing down there, so the ladder
   * swaps them for population clues instead.
   */
  readonly islandPool?: boolean;
}

function countNameLetters(name: string): number {
  return name.replace(/[^A-Za-z]/g, "").length;
}

function countNameWords(name: string): number {
  return name.split(/\s+/).filter(Boolean).length;
}

function regionOf(country: Country): string {
  return country.geographyLabel ?? country.continent;
}

function regionHint(country: Country): string {
  return `It sits in ${regionOf(country)}.`;
}

function landNeighborCount(code: string): number {
  return COUNTRY_BORDERS[code]?.length ?? 0;
}

function borderHint(country: Country): string {
  const neighbors = landNeighborCount(country.code);
  if (neighbors === 0) return "It has no land borders — an island nation, surrounded by sea.";
  if (neighbors === 1) return "It shares a land border with exactly one other country.";
  return `It shares land borders with ${neighbors} countries.`;
}

function populationHint(country: Country): string {
  const millions = WORLD_SPLIT_POPULATION_MILLIONS[country.code];
  if (millions === undefined) return "Its population is neither among the largest nor the smallest.";
  if (millions >= 300) return "It is one of the most populous countries on earth.";
  if (millions >= 100) return "Well over 100 million people live there.";
  if (millions >= 30) return "Over 30 million people live there.";
  if (millions >= 10) return "Over 10 million people live there.";
  if (millions >= 1) return "It has just over a million residents.";
  return "Fewer than a million people live there.";
}

function nameShapeHint(country: Country): string {
  const letterCount = countNameLetters(country.name);
  const wordCount = countNameWords(country.name);
  const shape = `Starts with “${country.name.charAt(0).toUpperCase()}”; ${letterCount} letters${wordCount > 1 ? ` across ${wordCount} words` : ""}.`;
  return country.aliases.length > 0 ? `${shape} An alternate name is also accepted.` : shape;
}

/**
 * Share of a pool's countries that have no land borders. Pools above ISLAND_POOL_RATIO are
 * treated as island collections: a "no land borders" clue would apply to nearly every round,
 * so the engine swaps that hint level for population instead.
 */
const ISLAND_POOL_RATIO = 0.7;

export function isIslandPool(poolCountryIds: readonly CountryId[], countryIndex: { readonly byId: { readonly [id: number]: { readonly code: string } | undefined } }): boolean {
  if (poolCountryIds.length === 0) return false;
  let borderless = 0;
  for (const id of poolCountryIds) {
    const code = countryIndex.byId[id]?.code;
    if (code !== undefined && landNeighborCount(code) === 0) borderless += 1;
  }
  return borderless / poolCountryIds.length >= ISLAND_POOL_RATIO;
}

// Name-the-country prompts (flag, outline, code, capital city, map flash): the player must name
// the country, so every hint narrows it down without repeating what is already on screen.
function countryNameHint(country: Country, level: number, islandPool: boolean): Hint {
  if (level === 0) {
    return { title: "Where in the world", message: regionHint(country), level };
  }

  if (level === 1) {
    return islandPool
      ? { title: "Population", message: populationHint(country), level }
      : { title: "Land borders", message: borderHint(country), level };
  }

  return { title: "Name shape", message: nameShapeHint(country), level };
}

// Capital recall shows the country itself, so country facts are worthless — the hints climb the
// capital's name instead: length first, then the initial, then an alternate spelling or letter.
function capitalRecallHint(country: Country, level: number): Hint {
  if (level === 0) {
    const letterCount = countNameLetters(country.capital);
    const wordCount = countNameWords(country.capital);
    return {
      title: "Capital size",
      message: `${letterCount} letters${wordCount > 1 ? ` across ${wordCount} words` : ""}.${country.capitalAliases.length > 0 ? " Alternate capital spellings are accepted." : ""}`,
      level,
    };
  }

  if (level === 1) {
    const letterCount = countNameLetters(country.capital);
    const wordCount = countNameWords(country.capital);
    return {
      title: "Capital shape",
      message: `Starts with “${country.capital.charAt(0).toUpperCase()}”; ${letterCount} letters${wordCount > 1 ? ` across ${wordCount} words` : ""}.`,
      level,
    };
  }

  return {
    title: "Capital trace",
    message: country.capitalAliases.length > 0 ? `Also accepted: ${country.capitalAliases[0]}.` : `One letter inside it is “${country.capital.charAt(Math.max(0, Math.floor(country.capital.length / 2))).toUpperCase()}”.`,
    level,
  };
}

/**
 * Hints tailored to what the round's prompt already shows. Category picks the ladder:
 * "capital-recall" climbs the capital's name (the country is on screen), everything else is a
 * name-the-country round and climbs region → border profile (or population in island pools) →
 * name shape. The ISO-code-letter hint is gone everywhere: in "codes" the code is the prompt,
 * and everywhere else it was a weaker clue than the name's own shape.
 */
export function createHint(country: Country, level: number, categoryId: string, context?: HintContext): Hint {
  const hintLevel = Math.min(Math.max(level, 0), TOTAL_HINTS - 1);
  if (categoryId === "capital-recall") return capitalRecallHint(country, hintLevel);
  return countryNameHint(country, hintLevel, context?.islandPool ?? false);
}
