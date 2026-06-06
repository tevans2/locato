import type { GameMode } from "./types";

export const classicMode: GameMode = {
  id: "classic",
  label: "Classic World Tour",
  description: "Guess every flag at your own pace with hints, skips, aliases, and country codes.",
  allowSkip: true,
  acceptCountryCodes: true,
  acceptAliases: true,
  hints: { enabled: true, penaltyPoints: 0 },
  createCountryPool: (countries) => countries.map((country) => country.id),
  scoreCorrectGuess: ({ state }) => ({ points: 100 + Math.min(state.streak, 10) * 10 }),
  scoreWrongGuess: () => ({ points: 0 }),
  isComplete: (state, countryCount) => state.guessedCountryIds.size >= countryCount,
};
