import { rawCountries } from "../countries/countries";
import { fameTier, type FameTier } from "../countries/fame";
import { createSeededRandom, shuffle } from "../game/random";
import { mysteryClues, mysteryHintText, type MysteryClues } from "./clues";

/**
 * Mystery country: find the hidden country in a few guesses. Every guess earns clues
 * (src/core/mystery/clues.ts); two hints name its region and then its first letter.
 */

export const MYSTERY_MAX_GUESSES = 8;
export const MYSTERY_MAX_HINTS = 2;
/** Points for finding the country first time with no hints. */
export const MYSTERY_MAX_POINTS = 100;
/** Lost for every guess after the first. */
export const MYSTERY_GUESS_PENALTY = 12;
export const MYSTERY_HINT_PENALTY = 15;
/** A found country is always worth at least this much; a missed one scores nothing. */
export const MYSTERY_MIN_SOLVED_POINTS = 10;

export interface MysteryGuess {
  readonly code: string;
  readonly clues: MysteryClues;
}

/** solved: found · failed: out of guesses · revealed: given up. */
export type MysteryStatus = "playing" | "solved" | "failed" | "revealed";

export interface MysteryRound {
  readonly target: string;
  readonly guesses: readonly MysteryGuess[];
  readonly hintsUsed: number;
  readonly status: MysteryStatus;
}

export type MysteryGuessError = "finished" | "unknown" | "repeat";

export function createMysteryRound(target: string): MysteryRound {
  return { target, guesses: [], hintsUsed: 0, status: "playing" };
}

export function guessMystery(round: MysteryRound, code: string): { readonly round: MysteryRound; readonly guess: MysteryGuess } | { readonly error: MysteryGuessError } {
  if (round.status !== "playing") return { error: "finished" };
  if (round.guesses.some((guess) => guess.code === code)) return { error: "repeat" };
  const clues = mysteryClues(code, round.target);
  if (!clues) return { error: "unknown" };
  const guess = { code, clues };
  const guesses = [...round.guesses, guess];
  const status: MysteryStatus = clues.correct ? "solved" : guesses.length >= MYSTERY_MAX_GUESSES ? "failed" : "playing";
  return { round: { ...round, guesses, status }, guess };
}

export function hintMystery(round: MysteryRound): { readonly round: MysteryRound; readonly hint: { readonly level: number; readonly text: string } } | { readonly error: "finished" | "no-hints" } {
  if (round.status !== "playing") return { error: "finished" };
  if (round.hintsUsed >= MYSTERY_MAX_HINTS) return { error: "no-hints" };
  const level = round.hintsUsed + 1;
  return { round: { ...round, hintsUsed: level }, hint: { level, text: mysteryHintText(round.target, level) } };
}

export function revealMystery(round: MysteryRound): MysteryRound {
  return round.status === "playing" ? { ...round, status: "revealed" } : round;
}

export function mysteryPoints(guessesUsed: number, hintsUsed: number, solved: boolean): number {
  if (!solved) return 0;
  return Math.max(MYSTERY_MIN_SOLVED_POINTS, MYSTERY_MAX_POINTS - MYSTERY_GUESS_PENALTY * Math.max(0, guessesUsed - 1) - MYSTERY_HINT_PENALTY * hintsUsed);
}

export function mysteryRoundPoints(round: MysteryRound): number {
  return mysteryPoints(round.guesses.length, round.hintsUsed, round.status === "solved");
}

/** Share squares: found, then hot (within ~2,000 km), warm (~5,000 km), cold. */
export function mysteryShareSquare(clues: MysteryClues): string {
  return clues.correct ? "🟩" : clues.proximity >= 90 ? "🟧" : clues.proximity >= 75 ? "🟨" : "🟦";
}

// ---- Which countries are hidden ------------------------------------------------------------

/** A run's five countries get harder: two household names, two regionally known, one deep cut. */
export const MYSTERY_RUN_TIERS: readonly FameTier[] = [1, 1, 2, 2, 3];

const ALL_CODES = rawCountries.map((country) => country.code).sort();

/** The run's hidden countries for `seed`: distinct, and the same seed always picks the same ones. */
export function createMysteryTargets(seed: string, tiers: readonly FameTier[] = MYSTERY_RUN_TIERS): readonly string[] {
  const random = createSeededRandom(`mystery:${seed}`);
  const picked: string[] = [];
  for (const tier of tiers) {
    const pool = shuffle(ALL_CODES.filter((code) => fameTier(code) === tier && !picked.includes(code)), random);
    picked.push(pool[0]!);
  }
  return picked;
}

/** Today's mystery #1 was played on this date. */
export const MYSTERY_DAILY_FIRST_DATE = "2026-10-14";

export function mysteryDailyNumber(date: string): number {
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${MYSTERY_DAILY_FIRST_DATE}T12:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) ? Math.max(1, days + 1) : 1;
}

/** Today's mystery: the same well-known-enough country for everyone on a date (YYYY-MM-DD). */
export function createDailyMysteryTarget(date: string): string {
  const pool = ALL_CODES.filter((code) => fameTier(code) <= 2);
  return shuffle(pool, createSeededRandom(`mystery-today:${date}`))[0]!;
}

/**
 * Today's mystery as share text, without naming the country:
 *
 *   #locato Mystery #3 4/8
 *   🟦🟨🟧🟩
 *   https://locato.quest/?game=mystery&daily=1
 */
export function mysteryDailyShareText(round: MysteryRound, details: { readonly number: number; readonly url: string }): string {
  const tally = round.status === "solved" ? `${round.guesses.length}/${MYSTERY_MAX_GUESSES}` : `X/${MYSTERY_MAX_GUESSES}`;
  const hints = round.hintsUsed > 0 ? ` ${"💡".repeat(round.hintsUsed)}` : "";
  const squares = round.guesses.map((guess) => mysteryShareSquare(guess.clues)).join("") || "·";
  return `#locato Mystery #${details.number} ${tally}${hints}\n${squares}\n${details.url}`;
}
