import { submitBestTime } from "../auth";
import type { TimerGameModeId } from "../gameModes";
import { formatElapsedTime } from "./playTimer";

export interface TimerLeaderboardResult {
  readonly isNewLocalBest: boolean;
  readonly serverAccepted: boolean | null;
}

export async function submitTimerToLeaderboard(input: {
  readonly gameMode: TimerGameModeId;
  readonly variant: string;
  readonly timeMs: number;
  readonly isLoggedIn: boolean;
}): Promise<boolean | null> {
  if (!input.isLoggedIn) return null;
  const result = await submitBestTime({
    gameMode: input.gameMode,
    variant: input.variant,
    timeMs: input.timeMs,
  });
  return result?.accepted ?? false;
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
