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
  /** The server's signed note of when this attempt started; sent with the result. */
  readonly startTicket?: string;
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

export type DailyStage = "prompt" | "overland" | "map-tap" | "street-view";

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
  /** Round 8 is an Overland route (dailies started before it keep eight prompt rounds). */
  readonly overlandRound?: true;
  readonly challengeVersion?: 2;
  readonly rounds?: readonly DailyRoundResult[];
  /** The server's signed note of when this attempt started (requested when play begins). */
  readonly startTicket?: string;
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

const DAILY_STAGES: readonly DailyStage[] = ["prompt", "overland", "map-tap", "street-view"];

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

// ---------------------------------------------------------------------------------------------
// Guest → account: dailies played before signing in move to the account that signs in on this
// device, so they count toward its history and streak. Guest copies are removed once moved, so a
// second account signing in later can't claim them too.

const DAILY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dailySyncQueueKey(userId: string): string {
  return `${DAILY_SAVE_PREFIX}${dailySaveScope(userId)}:pending-sync:v1`;
}

/** Dates of this account's local dailies that still need uploading. */
export function readDailySyncQueue(storage: Storage, userId: string): readonly string[] {
  try {
    const parsed = JSON.parse(storage.getItem(dailySyncQueueKey(userId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((date): date is string => typeof date === "string" && DAILY_DATE_PATTERN.test(date)) : [];
  } catch {
    return [];
  }
}

export function writeDailySyncQueue(storage: Storage, userId: string, dates: readonly string[]): void {
  if (dates.length === 0) storage.removeItem(dailySyncQueueKey(userId));
  else storage.setItem(dailySyncQueueKey(userId), JSON.stringify([...new Set(dates)].sort()));
}

/** Every finished guest daily on this device (current and legacy keys), with the keys holding it. */
function guestDailyEntries(storage: Storage): Map<string, string[]> {
  const byDate = new Map<string, string[]>();
  const guest = `${DAILY_SAVE_PREFIX}${GUEST_DAILY_SAVE_SCOPE}:`;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.endsWith(DAILY_SAVE_SUFFIX)) continue;
    const rest = key.startsWith(guest) ? key.slice(guest.length) : key.startsWith(DAILY_SAVE_PREFIX) ? key.slice(DAILY_SAVE_PREFIX.length) : null;
    const date = rest?.slice(0, -DAILY_SAVE_SUFFIX.length);
    if (!date || !DAILY_DATE_PATTERN.test(date)) continue;
    byDate.set(date, [...(byDate.get(date) ?? []), key]);
  }
  return byDate;
}

/**
 * Move guest dailies (finished and in progress) to `userId` on this device and queue the finished
 * ones for upload. A day the account already has locally keeps the account's copy. Returns the
 * dates waiting to upload, including any left over from an earlier failed sync.
 */
export function adoptGuestDailies(storage: Storage, userId: string): readonly string[] {
  const queue = new Set(readDailySyncQueue(storage, userId));
  for (const [date, keys] of guestDailyEntries(storage)) {
    const result = readDailyResult(storage, date, null);
    if (result && !readDailyResult(storage, date, userId)) {
      saveDailyResult(storage, result, userId);
      queue.add(date);
    }
    for (const key of keys) storage.removeItem(key);
  }
  const guestProgress = storage.getItem(dailyProgressKey(null));
  if (guestProgress !== null) {
    if (storage.getItem(dailyProgressKey(userId)) === null) storage.setItem(dailyProgressKey(userId), guestProgress);
    storage.removeItem(dailyProgressKey(null));
  }
  writeDailySyncQueue(storage, userId, [...queue]);
  return readDailySyncQueue(storage, userId);
}

// ---------------------------------------------------------------------------------------------
// The landing page's view of today's daily: whatever this device holds for the date, whether a
// guest or any account played it (the page doesn't wait for the session check).

export interface DailyOnDevice {
  readonly result: DailyResultSave | null;
  /** Rounds finished in an unfinished attempt (0 when none). */
  readonly roundsPlayed: number;
}

export function readDailyOnDevice(storage: Storage, date: string): DailyOnDevice {
  let result: DailyResultSave | null = null;
  let roundsPlayed = 0;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    if (key.startsWith(DAILY_SAVE_PREFIX) && key.endsWith(`:${date}${DAILY_SAVE_SUFFIX}`)) {
      const parsed = parseDailyResult(storage.getItem(key) ?? "", date);
      if (parsed && (!result || parsed.completedAt < result.completedAt)) result = parsed;
    } else if (key.startsWith(DAILY_PROGRESS_PREFIX)) {
      try {
        const progress = JSON.parse(storage.getItem(key) ?? "null") as { date?: unknown; roundIndex?: unknown } | null;
        if (progress?.date === date && typeof progress.roundIndex === "number") roundsPlayed = Math.max(roundsPlayed, Math.max(0, Math.min(DAILY_COUNTRY_COUNT, progress.roundIndex)));
      } catch {
        // unreadable progress: ignore
      }
    }
  }
  return { result, roundsPlayed: result ? 0 : roundsPlayed };
}
