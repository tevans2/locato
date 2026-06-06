import type { CountryIndex, CountryId } from "../countries";
import type { GameState, GameStats } from "./types";

export function getCurrentCountry(index: CountryIndex, state: GameState) {
  return state.currentCountryId === null ? null : index.byId[state.currentCountryId] ?? null;
}

export function getGameStats(index: CountryIndex, state: GameState): GameStats {
  const totalCountries = state.poolCountryIds.length;
  const guessedCount = state.guessedCountryIds.size;
  const remainingCount = Math.max(0, totalCountries - guessedCount);
  const accuracy = state.attempts === 0 ? 1 : state.correctAnswers / state.attempts;
  const progress = totalCountries === 0 ? 0 : guessedCount / totalCountries;

  return { totalCountries, guessedCount, remainingCount, accuracy, progress };
}

export function getGuessedCountriesByContinent(index: CountryIndex, guessedCountryIds: ReadonlySet<CountryId>) {
  return index.countries.filter((country) => guessedCountryIds.has(country.id));
}
