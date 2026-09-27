import { fetchLeaderboardRank, submitBestTime } from "../auth";
import type { TimerGameModeId } from "../gameModes";
import { formatElapsedTime } from "./playTimer";

export interface TimerLeaderboardResult {
  readonly isNewLocalBest: boolean;
  readonly serverAccepted: boolean | null;
}

export interface TimedRunPosting {
  /** null = not signed in (nothing posted); true = posted; false = kept locally (not faster than the posted best). */
  readonly serverAccepted: boolean | null;
  /** Signed in: your rank after posting. Guest: where this time would place. null when unknown or offline. */
  readonly rank: number | null;
  /** Signed in but the post didn't go through (offline, or the server rejected the time). */
  readonly failed?: true;
}

/** Post a finished timed run (signed in) or look up where it would place (guest). Never throws. */
export async function postTimedRun(input: {
  readonly gameMode: TimerGameModeId;
  readonly variant: string;
  readonly timeMs: number;
  readonly isLoggedIn: boolean;
}): Promise<TimedRunPosting> {
  if (!input.isLoggedIn) {
    const placement = await fetchLeaderboardRank(input.gameMode, input.variant, input.timeMs);
    return { serverAccepted: null, rank: placement?.rank ?? null };
  }
  const result = await submitBestTime({ gameMode: input.gameMode, variant: input.variant, timeMs: input.timeMs });
  if (!result) return { serverAccepted: false, rank: null, failed: true };
  return { serverAccepted: result.accepted, rank: result.rank ?? null };
}

export function timerLeaderboardNote(result: TimerLeaderboardResult, isLoggedIn: boolean): string {
  if (!isLoggedIn) {
    return result.isNewLocalBest ? " Sign in to post your time." : "";
  }
  if (result.serverAccepted === true) return " Posted to leaderboard.";
  if (result.serverAccepted === false) return " Saved locally only — beat your posted best to update the board.";
  return "";
}

export function formatTimerCompletionSuffix(finalTimeMs: number, result: TimerLeaderboardResult, isLoggedIn: boolean): string {
  const time = formatElapsedTime(finalTimeMs);
  const localNote = result.isNewLocalBest ? " — new personal best." : ".";
  return `${time}${localNote}${timerLeaderboardNote(result, isLoggedIn)}`;
}
