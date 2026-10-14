import { MYSTERY_MAX_HINTS, createMysteryRound, guessMystery, revealMystery, type MysteryRound } from "../core/mystery";
import { dailyPuzzleStats, type DailyPuzzleStats } from "./dailyStreak";

/**
 * Today's mystery, saved on this device: each day's guesses and hints, so a game in progress
 * resumes (and a finished one can't be replayed), plus the streak of days solved.
 */

export const MYSTERY_DAILY_KEY = "locato:mystery-daily:v1";
const KEPT_DAYS = 400;

interface SavedDay {
  readonly target: string;
  readonly guesses: readonly string[];
  readonly hintsUsed: number;
  readonly revealed: boolean;
  readonly status: MysteryRound["status"];
}

function readDays(storage: Storage): Record<string, SavedDay> {
  try {
    const parsed = JSON.parse(storage.getItem(MYSTERY_DAILY_KEY) ?? "null") as { version?: number; days?: Record<string, SavedDay> } | null;
    return parsed?.version === 1 && parsed.days && typeof parsed.days === "object" ? parsed.days : {};
  } catch {
    return {};
  }
}

export function saveMysteryDay(storage: Storage, date: string, round: MysteryRound): void {
  const days = readDays(storage);
  days[date] = { target: round.target, guesses: round.guesses.map((guess) => guess.code), hintsUsed: round.hintsUsed, revealed: round.status === "revealed", status: round.status };
  const kept = Object.keys(days).sort().slice(-KEPT_DAYS);
  try {
    storage.setItem(MYSTERY_DAILY_KEY, JSON.stringify({ version: 1, days: Object.fromEntries(kept.map((day) => [day, days[day]])) }));
  } catch {
    // Private mode / full storage: today's mystery just isn't kept.
  }
}

/** `date`'s game as saved, rebuilt by replaying its guesses, or null when nothing valid is saved. */
export function readMysteryDay(storage: Storage, date: string, target: string): MysteryRound | null {
  const saved = readDays(storage)[date];
  if (!saved || saved.target !== target || !Array.isArray(saved.guesses)) return null;
  let round = createMysteryRound(target);
  for (const code of saved.guesses) {
    const result = typeof code === "string" ? guessMystery(round, code) : null;
    if (!result || "error" in result) return null;
    round = result.round;
  }
  round = { ...round, hintsUsed: Number.isInteger(saved.hintsUsed) ? Math.min(MYSTERY_MAX_HINTS, Math.max(0, saved.hintsUsed)) : 0 };
  return saved.revealed ? revealMystery(round) : round;
}

export function readMysteryDailyStats(storage: Storage, today: string): DailyPuzzleStats {
  const finished = Object.entries(readDays(storage)).filter(([, day]) => day.status !== "playing");
  return dailyPuzzleStats(new Map(finished.map(([date, day]) => [date, day.status === "solved"])), today);
}
