import { OVERLAND_MAX_HINTS, createOverlandRound, guessOverland, overlandGraph, revealOverland, type OverlandRound, type OverlandRoute } from "../core/overland";

/**
 * Overland's "Today's route", saved on this device: each day's guesses and hints, so a route in
 * progress resumes (and a finished one can't be replayed), plus the streak of days solved.
 */

export const OVERLAND_DAILY_KEY = "locato:overland-daily:v1";
/** Days kept; older ones only ever mattered to the streak, which this comfortably covers. */
const KEPT_DAYS = 400;
const DAY_MS = 86_400_000;

interface SavedDay {
  readonly start: string;
  readonly end: string;
  readonly guesses: readonly string[];
  readonly hintsUsed: number;
  readonly outlined: readonly string[];
  readonly revealed: boolean;
  /** Final status, kept so the streak doesn't need to replay every day. */
  readonly status: OverlandRound["status"];
}

type SavedDays = Record<string, SavedDay>;

function readDays(storage: Storage): SavedDays {
  try {
    const parsed = JSON.parse(storage.getItem(OVERLAND_DAILY_KEY) ?? "null") as { version?: number; days?: SavedDays } | null;
    return parsed?.version === 1 && parsed.days && typeof parsed.days === "object" ? parsed.days : {};
  } catch {
    return {};
  }
}

function writeDays(storage: Storage, days: SavedDays): void {
  const kept = Object.keys(days).sort().slice(-KEPT_DAYS);
  try {
    storage.setItem(OVERLAND_DAILY_KEY, JSON.stringify({ version: 1, days: Object.fromEntries(kept.map((date) => [date, days[date]])) }));
  } catch {
    // Private mode / full storage: today's route just isn't kept.
  }
}

/** Save the state of `date`'s route after a move. */
export function saveOverlandDay(storage: Storage, date: string, round: OverlandRound): void {
  const days = readDays(storage);
  days[date] = {
    start: round.route.start,
    end: round.route.end,
    guesses: round.guesses.map((guess) => guess.code),
    hintsUsed: round.hintsUsed,
    outlined: [...round.outlined],
    revealed: round.status === "revealed",
    status: round.status,
  };
  writeDays(storage, days);
}

/**
 * `date`'s route as saved, rebuilt by replaying its guesses (so verdicts and status are always
 * recomputed), or null when nothing valid is saved for that route.
 */
export function readOverlandDay(storage: Storage, date: string, route: OverlandRoute): OverlandRound | null {
  const saved = readDays(storage)[date];
  if (!saved || saved.start !== route.start || saved.end !== route.end || !Array.isArray(saved.guesses)) return null;
  const graph = overlandGraph();
  let round = createOverlandRound(route);
  for (const code of saved.guesses) {
    const result = typeof code === "string" ? guessOverland(graph, round, code) : null;
    if (!result || "error" in result) return null;
    round = result.round;
  }
  const hintsUsed = Number.isInteger(saved.hintsUsed) ? Math.min(OVERLAND_MAX_HINTS, Math.max(0, saved.hintsUsed)) : 0;
  const outlined = Array.isArray(saved.outlined) ? saved.outlined.filter((code) => typeof code === "string" && graph.has(code)) : [];
  round = { ...round, hintsUsed, outlined };
  return saved.revealed ? revealOverland(round) : round;
}

export interface OverlandDailyStats {
  /** Consecutive days solved, up to today (or yesterday, while today is unsolved). */
  readonly streak: number;
  readonly bestStreak: number;
  readonly played: number;
  readonly solved: number;
}

function dayNumber(date: string): number | null {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) ? Math.round(time / DAY_MS) : null;
}

export function readOverlandDailyStats(storage: Storage, today: string): OverlandDailyStats {
  const days = readDays(storage);
  const finished = Object.entries(days).filter(([, day]) => day.status !== "playing");
  const solvedDays = new Set(finished.filter(([, day]) => day.status === "solved").map(([date]) => dayNumber(date)).filter((day): day is number => day !== null));
  const todayNumber = dayNumber(today);
  let streak = 0;
  if (todayNumber !== null) for (let day = solvedDays.has(todayNumber) ? todayNumber : todayNumber - 1; solvedDays.has(day); day -= 1) streak += 1;
  let bestStreak = 0;
  for (const day of solvedDays) {
    if (solvedDays.has(day - 1)) continue;
    let length = 0;
    while (solvedDays.has(day + length)) length += 1;
    bestStreak = Math.max(bestStreak, length);
  }
  return { streak, bestStreak, played: finished.length, solved: solvedDays.size };
}
