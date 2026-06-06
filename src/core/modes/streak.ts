import type { GameMode } from "./types";

export const streakMode: GameMode = {
  id: "streak",
  label: "Streak Lock",
  description: "Build the longest run possible. One wrong answer ends the game.",
  allowSkip: false,
  acceptCountryCodes: false,
  acceptAliases: true,
  hints: { enabled: false, penaltyPoints: 0 },
  createCountryPool: (countries) => countries.map((country) => country.id),
  scoreCorrectGuess: ({ state }) => ({ points: 150 + state.streak * 25 }),
  scoreWrongGuess: () => ({ points: 0 }),
  isComplete: (state, countryCount) => state.status === "complete" || state.guessedCountryIds.size >= countryCount,
};
