import { createDailyShareText, DAILY_COUNTRY_COUNT, DAILY_MAX_SCORE, type DailyRoundMark } from "../core/dailyChallenge";

const DAILY_SAVE_PREFIX = "locato:daily:";
const DAILY_SAVE_SUFFIX = ":v2";

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

export function dailySaveKey(date: string): string {
  return `${DAILY_SAVE_PREFIX}${date}${DAILY_SAVE_SUFFIX}`;
}

export function createDailyResultSave(input: Omit<DailyResultSave, "version" | "shareText" | "completedAt">, completedAt = Date.now()): DailyResultSave {
  return {
    ...input,
    version: 2,
    shareText: createDailyShareText(input.date, input.score, input.timeMs, input.marks),
    completedAt,
  };
}

export function saveDailyResult(storage: Storage, result: DailyResultSave): void {
  storage.setItem(dailySaveKey(result.date), JSON.stringify(result));
}

export function readDailyResult(storage: Storage, date: string): DailyResultSave | null {
  const raw = storage.getItem(dailySaveKey(date));
  if (!raw) return null;

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
