/**
 * Streaks for the once-a-day puzzles (Overland's today's route, Today's mystery): from each
 * finished day's outcome, the run of days won up to today (or yesterday, while today is
 * unplayed), the longest run, and how many days were played and won.
 */

const DAY_MS = 86_400_000;

export interface DailyPuzzleStats {
  readonly streak: number;
  readonly bestStreak: number;
  readonly played: number;
  readonly solved: number;
}

function dayNumber(date: string): number | null {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) ? Math.round(time / DAY_MS) : null;
}

/** `outcomes` maps a date (YYYY-MM-DD) to whether that finished day was won. */
export function dailyPuzzleStats(outcomes: ReadonlyMap<string, boolean>, today: string): DailyPuzzleStats {
  const won = new Set([...outcomes].filter(([, solved]) => solved).map(([date]) => dayNumber(date)).filter((day): day is number => day !== null));
  const todayNumber = dayNumber(today);
  let streak = 0;
  if (todayNumber !== null) for (let day = won.has(todayNumber) ? todayNumber : todayNumber - 1; won.has(day); day -= 1) streak += 1;
  let bestStreak = 0;
  for (const day of won) {
    if (won.has(day - 1)) continue;
    let length = 0;
    while (won.has(day + length)) length += 1;
    bestStreak = Math.max(bestStreak, length);
  }
  return { streak, bestStreak, played: outcomes.size, solved: won.size };
}
