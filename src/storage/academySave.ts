import { emptyProgress, parseCardKey } from "../core/academy/srs";
import type { AcademyProgress, CardKey, CardProgress, LeitnerBox } from "../core/academy/types";

export const ACADEMY_SAVE_KEY = "locato:academy:v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseCard(value: unknown): CardProgress | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Record<string, unknown>;
  const { box, correct, wrong, lastSeenAt, dueAt } = card;
  if (!isFiniteNumber(box) || !Number.isInteger(box) || box < 0 || box > 5) return null;
  if (![correct, wrong, lastSeenAt, dueAt].every((field) => isFiniteNumber(field) && field >= 0)) return null;
  return { box: box as LeitnerBox, correct: correct as number, wrong: wrong as number, lastSeenAt: lastSeenAt as number, dueAt: dueAt as number };
}

/** Validates untrusted data; invalid cards and activity days are dropped, an invalid shape yields empty progress. */
export function parseAcademyProgress(value: unknown): AcademyProgress {
  if (!value || typeof value !== "object") return emptyProgress();
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || !data.cards || typeof data.cards !== "object" || Array.isArray(data.cards)) return emptyProgress();

  const cards: Record<CardKey, CardProgress> = {};
  for (const [key, raw] of Object.entries(data.cards as Record<string, unknown>)) {
    const parsed = parseCardKey(key);
    const card = parseCard(raw);
    if (parsed && card) cards[`${parsed.code}:${parsed.skill}`] = card;
  }

  const activity: Record<string, number> = {};
  if (data.activity && typeof data.activity === "object" && !Array.isArray(data.activity)) {
    for (const [day, count] of Object.entries(data.activity as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && isFiniteNumber(count) && count >= 0) activity[day] = count;
    }
  }

  return {
    version: 1,
    cards,
    placementCompletedAt: isFiniteNumber(data.placementCompletedAt) ? data.placementCompletedAt : null,
    activity,
    updatedAt: isFiniteNumber(data.updatedAt) ? data.updatedAt : 0,
  };
}

export function readAcademyProgress(storage: StorageLike | null | undefined): AcademyProgress {
  try {
    const raw = storage?.getItem(ACADEMY_SAVE_KEY);
    return raw ? parseAcademyProgress(JSON.parse(raw)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

/** Returns false when storage is unavailable or full. */
export function saveAcademyProgress(storage: StorageLike | null | undefined, progress: AcademyProgress): boolean {
  try {
    if (!storage) return false;
    storage.setItem(ACADEMY_SAVE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
