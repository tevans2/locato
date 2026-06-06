import type { GameMode } from "./types";

export const continentMode: GameMode = {
  id: "continent",
  label: "Continent Sprint",
  description: "Focus on one continent and clear a smaller board.",
  allowSkip: true,
  acceptCountryCodes: true,
  acceptAliases: true,
  hints: { enabled: true, penaltyPoints: 0 },
  createCountryPool: (countries, options) => {
    const continent = options?.continent;
    return countries.filter((country) => !continent || country.continent === continent).map((country) => country.id);
  },
  scoreCorrectGuess: ({ state }) => ({ points: 120 + Math.min(state.streak, 8) * 12 }),
  scoreWrongGuess: () => ({ points: 0 }),
  isComplete: (state) => state.currentCountryId === null,
};
