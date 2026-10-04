import { createDailyShareText, DAILY_COUNTRY_COUNT, DAILY_MAX_SCORE, parseDailyRoundResults, type DailyRoundMark, type DailyRoundResult } from "../core/dailyChallenge";
import type { SoloSave } from "./localSave";

const DAILY_SAVE_PREFIX = "locato:daily:";
const DAILY_SAVE_SUFFIX = ":v2";
const GUEST_DAILY_SAVE_SCOPE = "guest";

export interface DailyResultSave {
  readonly version: 2;
  readonly date: string;
  readonly seed: string;
  readonly score: number;
  readonly timeMs: number;
  readonly hintsUsed: number;
  readonly marks: readonly DailyRoundMark[];
  readonly shareText: string;
  readonly completedAt: number;
  readonly challengeVersion?: 2;
  readonly rounds?: readonly DailyRoundResult[];
}

function dailySaveScope(userId?: string | null): string {
  return userId ? `user:${encodeURIComponent(userId)}` : GUEST_DAILY_SAVE_SCOPE;
}

function legacyDailySaveKey(date: string): string {
  return `${DAILY_SAVE_PREFIX}${date}${DAILY_SAVE_SUFFIX}`;
}

export function dailySaveKey(date: string, userId?: string | null): string {
  return `${DAILY_SAVE_PREFIX}${dailySaveScope(userId)}:${date}${DAILY_SAVE_SUFFIX}`;
}

export function createDailyResultSave(input: Omit<DailyResultSave, "version" | "shareText" | "completedAt">, completedAt = Date.now()): DailyResultSave {
  return {
    ...input,
    version: 2,
    shareText: createDailyShareText(input.date, input.score, input.timeMs, input.marks),
    completedAt,
  };
}

export function saveDailyResult(storage: Storage, result: DailyResultSave, userId?: string | null): void {
  storage.setItem(dailySaveKey(result.date, userId), JSON.stringify(result));
}

function parseDailyResult(raw: string, date: string): DailyResultSave | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DailyResultSave>;
    if (
      parsed.version !== 2 ||
      parsed.date !== date ||
      typeof parsed.seed !== "string" ||
      typeof parsed.score !== "number" ||
      parsed.score < 0 ||
      parsed.score > DAILY_MAX_SCORE ||
      typeof parsed.timeMs !== "number" ||
      typeof parsed.hintsUsed !== "number" ||
      !Array.isArray(parsed.marks) ||
      parsed.marks.length !== DAILY_COUNTRY_COUNT ||
      typeof parsed.shareText !== "string"
    ) {
      return null;
    }
    if (parsed.rounds !== undefined) {
      const rounds = parseDailyRoundResults(parsed.rounds);
      if (!rounds || rounds.length !== DAILY_COUNTRY_COUNT || rounds.reduce((sum, round) => sum + round.points, 0) !== parsed.score) return null;
      return { ...parsed, rounds } as DailyResultSave;
    }
    return parsed as DailyResultSave;
  } catch {
    return null;
  }
}

export function readDailyResult(storage: Storage, date: string, userId?: string | null): DailyResultSave | null {
  const raw = storage.getItem(dailySaveKey(date, userId));
  if (raw) return parseDailyResult(raw, date);

  // Older Locato versions stored daily results in one browser-wide key. Keep that save
  // available only for signed-out guests; signed-in accounts must not inherit another
  // account's completed daily from the same browser.
  if (userId) return null;

  const legacyRaw = storage.getItem(legacyDailySaveKey(date));
  return legacyRaw ? parseDailyResult(legacyRaw, date) : null;
}

// ---------------------------------------------------------------------------------------------
// In-progress daily: saved after every round so leaving, Back or a refresh resumes where the
// player left off (and a round can't be replayed after its answer was shown).

const DAILY_PROGRESS_PREFIX = "locato:daily-progress:";
const DAILY_PROGRESS_SUFFIX = ":v1";

export type DailyStage = "prompt" | "map-tap" | "street-view";

export interface DailyProgressSave {
  readonly version: 1;
  readonly date: string;
  readonly seed: string;
  readonly stage: DailyStage;
  /** Rounds finished so far (0–10); equals marks.length. */
  readonly roundIndex: number;
  readonly score: number;
  readonly marks: readonly DailyRoundMark[];
  readonly hintsUsed: number;
  /** Active play time so far; time away from the daily is not counted. */
  readonly elapsedMs: number;
  /** Prompt stage only: the engine's saved run, so the same country order resumes. */
  readonly engine: SoloSave | null;
  /** Prompt stage only: penalties already taken on the round in progress. */
  readonly roundHintsUsed: number;
  readonly roundWrongGuesses: number;
  readonly updatedAt: number;
  /** Preserve the generator used when an attempt began. */
  readonly themeScoped?: true;
  readonly challengeVersion?: 2;
  readonly rounds?: readonly DailyRoundResult[];
}

export function dailyProgressKey(userId?: string | null): string {
  return `${DAILY_PROGRESS_PREFIX}${dailySaveScope(userId)}${DAILY_PROGRESS_SUFFIX}`;
}

export function saveDailyProgress(storage: Storage, progress: DailyProgressSave, userId?: string | null): void {
  storage.setItem(dailyProgressKey(userId), JSON.stringify(progress));
}

export function clearDailyProgress(storage: Storage, userId?: string | null): void {
  storage.removeItem(dailyProgressKey(userId));
}

const DAILY_STAGES: readonly DailyStage[] = ["prompt", "map-tap", "street-view"];

/** Today's in-progress daily, or null. A stored run for any other date (or seed) is discarded. */
export function readDailyProgress(storage: Storage, date: string, seed: string, userId?: string | null): DailyProgressSave | null {
  const key = dailyProgressKey(userId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DailyProgressSave>;
    const valid =
      parsed.version === 1 &&
      parsed.date === date &&
      parsed.seed === seed &&
      DAILY_STAGES.includes(parsed.stage as DailyStage) &&
      Array.isArray(parsed.marks) &&
      parsed.marks.length <= DAILY_COUNTRY_COUNT &&
      typeof parsed.roundIndex === "number" &&
      typeof parsed.score === "number" &&
      parsed.score >= 0 &&
      parsed.score <= DAILY_MAX_SCORE &&
      typeof parsed.hintsUsed === "number" &&
      typeof parsed.elapsedMs === "number";
    if (valid) {
      const rounds = parsed.rounds === undefined ? undefined : parseDailyRoundResults(parsed.rounds);
      if (rounds === null || (rounds && (rounds.length !== parsed.marks!.length || rounds.reduce((sum, round) => sum + round.points, 0) !== parsed.score))) {
        storage.removeItem(key);
        return null;
      }
      return {
        ...(parsed as DailyProgressSave),
        engine: parsed.engine ?? null,
        roundHintsUsed: parsed.roundHintsUsed ?? 0,
        roundWrongGuesses: parsed.roundWrongGuesses ?? 0,
        ...(rounds ? { rounds } : {}),
      };
    }
  } catch {
    // fall through: unreadable progress is discarded
  }
  storage.removeItem(key);
  return null;
}
