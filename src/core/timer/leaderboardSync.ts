import { fetchLeaderboardRank, submitLeaderboardAttempt } from "../auth";
import type { GameModeId, TimerGameModeId } from "../gameModes";
import { leaderboardConfig } from "../leaderboards";
import { formatElapsedTime } from "./playTimer";

export interface TimerLeaderboardResult {
  readonly isNewLocalBest: boolean;
  readonly serverAccepted: boolean | null;
}

export interface TimedRunPosting {
  /** null = not signed in (nothing posted); true = posted; false = kept locally (not faster than the posted best). */
  readonly serverAccepted: boolean | null;
  /** Signed in: your rank after posting. Guest: where this time/score would place. null when unknown or offline. */
  readonly rank: number | null;
  /** Signed in but the post didn't go through (offline, or the server rejected the time). */
  readonly failed?: true;
}

/**
 * Post a finished ranked attempt (signed in) or look up where it would place (guest). `value` is a
 * time in ms on time boards and a score on score boards (src/core/leaderboards.ts). Never throws.
 */
export async function postRankedAttempt(input: {
  readonly gameMode: GameModeId;
  readonly variant: string;
  readonly value: number;
  readonly isLoggedIn: boolean;
}): Promise<TimedRunPosting> {
  const config = leaderboardConfig(input.gameMode);
  if (!config) return { serverAccepted: null, rank: null };
  if (!input.isLoggedIn) {
    const placement = await fetchLeaderboardRank(input.gameMode, input.variant, input.value);
    return { serverAccepted: null, rank: placement?.rank ?? null };
  }
  const result = await submitLeaderboardAttempt(
    config.metric === "score"
      ? { gameMode: input.gameMode, variant: input.variant, score: input.value }
      : { gameMode: input.gameMode, variant: input.variant, timeMs: input.value },
  );
  if (!result) return { serverAccepted: false, rank: null, failed: true };
  return { serverAccepted: result.accepted, rank: result.rank ?? null };
}

/** Post a finished timed run (time boards). A thin wrapper over postRankedAttempt. */
export async function postTimedRun(input: {
  readonly gameMode: TimerGameModeId;
  readonly variant: string;
  readonly timeMs: number;
  readonly isLoggedIn: boolean;
}): Promise<TimedRunPosting> {
  return postRankedAttempt({ gameMode: input.gameMode, variant: input.variant, value: input.timeMs, isLoggedIn: input.isLoggedIn });
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
