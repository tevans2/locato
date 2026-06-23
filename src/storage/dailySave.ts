import { createDailyShareText, DAILY_COUNTRY_COUNT, DAILY_MAX_SCORE, type DailyRoundMark } from "../core/dailyChallenge";

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
