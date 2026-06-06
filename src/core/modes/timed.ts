import type { GameMode } from "./types";

export const timedMode: GameMode = {
  id: "timed",
  label: "Timed Rush",
  description: "Score quickly before the clock expires. Built for daily and multiplayer races.",
  allowSkip: true,
  acceptCountryCodes: true,
  acceptAliases: true,
  hints: { enabled: true, penaltyPoints: 25 },
  createCountryPool: (countries) => countries.map((country) => country.id),
  scoreCorrectGuess: ({ state }) => ({ points: 100 + Math.min(state.streak, 12) * 15 }),
  scoreWrongGuess: () => ({ points: 0 }),
  isComplete: (state, countryCount) => state.guessedCountryIds.size >= countryCount,
};
