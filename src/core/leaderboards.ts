import type { GameModeId } from "./gameModes";

/**
 * Every game mode has a leaderboard. The server (server/leaderboard/validation.ts), the game
 * screens that post attempts, and Leaderboards all read this table, so it is the one place to add a
 * mode or change how a board ranks.
 *
 * - "time" boards rank the fastest completed run (lower is better) — the modes you finish.
 * - "score" boards rank the highest total from one fixed-length attempt (higher is better) — the
 *   modes you score points in, where a clock would be meaningless.
 */
export type LeaderboardMetric = "time" | "score";

/**
 * How a mode is played (docs/navigation.md, "Practice vs timed"):
 * - "split": a practice run and a separate timed / ranked run. Practice offers something the
 *   board can't (a resumable run, free hints, custom settings), so the two stay apart.
 * - "single": one way to play. Practice and ranked were the same game, so every finished run
 *   counts and the board keeps your best.
 */
export type RunStyle = "split" | "single";

export interface LeaderboardModeConfig {
  readonly mode: GameModeId;
  readonly metric: LeaderboardMetric;
  /** Allowed variants; "" is the default board. Flags: flag sets. Puzzle: one board per continent. */
  readonly variants: readonly string[];
  /** Score boards: the best possible total for one attempt (the server rejects anything above it). */
  readonly maxScore?: number;
  /** One line shown on the board describing what an attempt is. */
  readonly attempt: string;
  readonly runs: RunStyle;
}

export const PUZZLE_CONTINENT_VARIANTS = ["Africa", "Asia", "Europe", "North America", "Oceania", "South America"] as const;
export const FLAG_SET_VARIANTS = ["", "territories", "both"] as const;

/** Attempt lengths for the score modes (the attempt is the mode's standard practice-length run). */
export const MAP_TAP_ATTEMPT_TARGETS = 10;
export const WORLD_SPLIT_ATTEMPT_ROUNDS = 5;
export const GEOGUESSR_ATTEMPT_ROUNDS = 5;
export const STREET_VIEW_ATTEMPT_COUNTRIES = 5;
/** Flyover: one attempt is a run against this clock; the score is how many countries you reach. */
export const FLYOVER_ATTEMPT_SECONDS = 90;
/** Flyover excludes the 29 countries below its minimum target area in the shipped map. */
export const FLYOVER_MAX_SCORE = 167;
/** Street View country points per country: 3 for the first guess, 2 for the second, 1 for the third, 0 if missed. */
export const STREET_VIEW_POINTS_BY_GUESS = [3, 2, 1] as const;

const time = (mode: GameModeId, attempt: string, variants: readonly string[] = [""]): LeaderboardModeConfig => ({ mode, metric: "time", variants, attempt, runs: "split" });
const score = (mode: GameModeId, attempt: string, maxScore: number, runs: RunStyle = "single"): LeaderboardModeConfig => ({ mode, metric: "score", variants: [""], maxScore, attempt, runs });

export const LEADERBOARD_MODES: readonly LeaderboardModeConfig[] = [
  time("flags", "Name every flag in the set as fast as you can.", FLAG_SET_VARIANTS),
  time("flag-colors", "Reveal and name every flag, colour by colour, as fast as you can."),
  time("shapes", "Name every country from its outline as fast as you can."),
  time("codes", "Decode every country code as fast as you can."),
  time("capitals", "Name the country for every capital as fast as you can."),
  time("capital-recall", "Name the capital of every country as fast as you can."),
  time("name-all", "Type every country in the world as fast as you can."),
  time("click-country", "Click every named country on the map as fast as you can."),
  time("spot-country", "Name every highlighted country as fast as you can."),
  time("puzzle", "Place every country of a continent as fast as you can.", PUZZLE_CONTINENT_VARIANTS),
  score("map-tap", `Pin ${MAP_TAP_ATTEMPT_TARGETS} places on the globe. Closer pins score more.`, MAP_TAP_ATTEMPT_TARGETS * 5000, "split"),
  score("worldsplit", `Split the population in ${WORLD_SPLIT_ATTEMPT_ROUNDS} rounds. Fairer lines score more.`, WORLD_SPLIT_ATTEMPT_ROUNDS * 100),
  score("geoguessr", `Pin ${GEOGUESSR_ATTEMPT_ROUNDS} Street View locations. Closer pins score more.`, GEOGUESSR_ATTEMPT_ROUNDS * 5000),
  score("flyover", `Fly over as many named countries as you can in ${FLYOVER_ATTEMPT_SECONDS} seconds.`, FLYOVER_MAX_SCORE),
  score("streetview-country", `Name ${STREET_VIEW_ATTEMPT_COUNTRIES} countries from Street View. Fewer guesses score more.`, STREET_VIEW_ATTEMPT_COUNTRIES * STREET_VIEW_POINTS_BY_GUESS[0]),
];

export function leaderboardConfig(mode: string): LeaderboardModeConfig | null {
  return LEADERBOARD_MODES.find((config) => config.mode === mode) ?? null;
}

/** Single-run modes have no practice / ranked split: every finished run posts and your best stands. */
export function isSingleRunMode(mode: string): boolean {
  return leaderboardConfig(mode)?.runs === "single";
}

/**
 * The two sides of a split mode's run switch. Time boards race a clock ("Timed"); MapTap's
 * practice is really its settings screen, so it reads "Custom" beside "Ranked".
 */
export function runLabels(mode: string): { readonly practice: string; readonly timed: string } {
  if (mode === "map-tap") return { practice: "Custom", timed: "Ranked" };
  return leaderboardConfig(mode)?.metric === "score" ? { practice: "Practice", timed: "Ranked" } : { practice: "Practice", timed: "Timed" };
}

export function isRankedMode(mode: string): boolean {
  return leaderboardConfig(mode) !== null;
}

export function isValidLeaderboardVariant(mode: string, variant: string): boolean {
  return leaderboardConfig(mode)?.variants.includes(variant) ?? false;
}

/** Street View country points for one country, from how many guesses it took (null = missed). */
export function streetViewCountryPoints(guessesUsed: number | null): number {
  if (guessesUsed === null || guessesUsed < 1) return 0;
  return STREET_VIEW_POINTS_BY_GUESS[guessesUsed - 1] ?? 0;
}
