import {
  LEADERBOARD_MODES,
  PUZZLE_CONTINENT_VARIANTS,
  isValidLeaderboardVariant,
  leaderboardConfig,
  type LeaderboardMetric,
  type LeaderboardModeConfig,
} from "../../src/core/leaderboards";
import type { GameModeId } from "../../src/core/gameModes";

// Every board, its metric and its variants come from src/core/leaderboards.ts (shared with the client).
export const GAME_MODE_IDS: readonly GameModeId[] = LEADERBOARD_MODES.map((config) => config.mode);
export const TIME_GAME_MODE_IDS: readonly GameModeId[] = LEADERBOARD_MODES.filter((config) => config.metric === "time").map((config) => config.mode);
export const SCORE_GAME_MODE_IDS: readonly GameModeId[] = LEADERBOARD_MODES.filter((config) => config.metric === "score").map((config) => config.mode);

export type LeaderboardGameMode = GameModeId;

export const CONTINENTS = PUZZLE_CONTINENT_VARIANTS;

export type LeaderboardContinent = (typeof CONTINENTS)[number];

export const MIN_TIME_MS = 5_000;
export const MAX_TIME_MS = 7_200_000;
export const MAX_LEADERBOARD_LIMIT = 100;
export const DEFAULT_LEADERBOARD_LIMIT = 50;

export function isLeaderboardGameMode(value: string): value is LeaderboardGameMode {
  return leaderboardConfig(value) !== null;
}

export function isLeaderboardContinent(value: string): value is LeaderboardContinent {
  return (CONTINENTS as readonly string[]).includes(value);
}

export function leaderboardMetric(gameMode: string): LeaderboardMetric | null {
  return leaderboardConfig(gameMode)?.metric ?? null;
}

export function leaderboardModeConfig(gameMode: string): LeaderboardModeConfig | null {
  return leaderboardConfig(gameMode);
}

/** The variant as stored ("" = default board), or null when the mode has no such board. */
export function normalizeLeaderboardVariant(gameMode: LeaderboardGameMode, variant: string): string | null {
  return isValidLeaderboardVariant(gameMode, variant) ? variant : null;
}

export function isValidLeaderboardTime(timeMs: unknown): timeMs is number {
  return typeof timeMs === "number" && Number.isInteger(timeMs) && timeMs >= MIN_TIME_MS && timeMs <= MAX_TIME_MS;
}

export function isValidLeaderboardScore(gameMode: string, score: unknown): score is number {
  const maxScore = leaderboardConfig(gameMode)?.maxScore;
  return typeof score === "number" && Number.isInteger(score) && score >= 0 && maxScore !== undefined && score <= maxScore;
}
