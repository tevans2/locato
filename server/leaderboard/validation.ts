export const GAME_MODE_IDS = [
  "flags",
  "shapes",
  "codes",
  "capitals",
  "name-all",
  "click-country",
  "spot-country",
  "puzzle",
] as const;

export type LeaderboardGameMode = (typeof GAME_MODE_IDS)[number];

export const CONTINENTS = [
  "Africa",
  "Asia",
  "Europe",
  "North America",
  "Oceania",
  "South America",
] as const;

export type LeaderboardContinent = (typeof CONTINENTS)[number];

export const MIN_TIME_MS = 5_000;
export const MAX_TIME_MS = 7_200_000;
export const MAX_LEADERBOARD_LIMIT = 100;
export const DEFAULT_LEADERBOARD_LIMIT = 50;

export function isLeaderboardGameMode(value: string): value is LeaderboardGameMode {
  return (GAME_MODE_IDS as readonly string[]).includes(value);
}

export function isLeaderboardContinent(value: string): value is LeaderboardContinent {
  return (CONTINENTS as readonly string[]).includes(value);
}

export function normalizeLeaderboardVariant(gameMode: LeaderboardGameMode, variant: string): string | null {
  if (gameMode === "puzzle") {
    return isLeaderboardContinent(variant) ? variant : null;
  }
  return variant === "" ? "" : null;
}
