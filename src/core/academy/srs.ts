import type { CountryCode } from "../countries";
import { ACADEMY_SKILLS, type AcademyProgress, type AcademySkill, type CardKey, type CardProgress, type LeitnerBox } from "./types";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Wait before a card in each box is due again. Box 0 is never scheduled. */
export const BOX_INTERVALS_MS: Readonly<Record<LeitnerBox, number>> = {
  0: 0,
  1: 10 * MINUTE,
  2: DAY,
  3: 3 * DAY,
  4: 7 * DAY,
  5: 21 * DAY,
};

export const MAX_BOX: LeitnerBox = 5;
export const ACTIVITY_DAYS_KEPT = 60;

export const EMPTY_CARD: CardProgress = { box: 0, correct: 0, wrong: 0, lastSeenAt: 0, dueAt: 0 };

export interface DueCard {
  readonly key: CardKey;
  readonly code: CountryCode;
  readonly skill: AcademySkill;
  readonly card: CardProgress;
}

export function emptyProgress(): AcademyProgress {
  return { version: 1, cards: {}, placementCompletedAt: null, activity: {}, updatedAt: 0 };
}

export function cardKey(code: CountryCode, skill: AcademySkill): CardKey {
  return `${code.toUpperCase()}:${skill}`;
}

export function parseCardKey(key: string): { readonly code: CountryCode; readonly skill: AcademySkill } | null {
  const separator = key.lastIndexOf(":");
  if (separator <= 0) return null;
  const skill = key.slice(separator + 1) as AcademySkill;
  if (!ACADEMY_SKILLS.includes(skill)) return null;
  return { code: key.slice(0, separator), skill };
}

export function getCard(progress: AcademyProgress, code: CountryCode, skill: AcademySkill): CardProgress {
  return progress.cards[cardKey(code, skill)] ?? EMPTY_CARD;
}

export function boxOf(progress: AcademyProgress, code: CountryCode, skill: AcademySkill): LeitnerBox {
  return getCard(progress, code, skill).box;
}

export function clampBox(value: number): LeitnerBox {
  return Math.max(0, Math.min(MAX_BOX, Math.floor(value))) as LeitnerBox;
}

/** Local calendar day for a timestamp, e.g. "2026-09-26". */
export function toDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whole days between two YYYY-MM-DD keys (later minus earlier); NaN for malformed keys. */
export function dayKeyDiff(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY);
}

export function scheduleCard(card: CardProgress, box: LeitnerBox, now: number): CardProgress {
  return { ...card, box, lastSeenAt: now, dueAt: box === 0 ? 0 : now + BOX_INTERVALS_MS[box] };
}

/** Correct moves up one box (capped at 5); a miss drops back to box 1. */
export function nextCard(card: CardProgress, correct: boolean, now: number): CardProgress {
  const box = correct ? clampBox(card.box + 1) : 1;
  return scheduleCard(
    { ...card, correct: card.correct + (correct ? 1 : 0), wrong: card.wrong + (correct ? 0 : 1) },
    box,
    now,
  );
}

export function pruneActivity(activity: Readonly<Record<string, number>>, todayKey: string): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [day, count] of Object.entries(activity)) {
    const age = dayKeyDiff(todayKey, day);
    if (Number.isFinite(age) && age < ACTIVITY_DAYS_KEPT) kept[day] = count;
  }
  return kept;
}

export function recordAnswer(
  progress: AcademyProgress,
  code: CountryCode,
  skill: AcademySkill,
  correct: boolean,
  now: number,
  dayKey: string,
): AcademyProgress {
  const key = cardKey(code, skill);
  const activity = pruneActivity({ ...progress.activity, [dayKey]: (progress.activity[dayKey] ?? 0) + 1 }, dayKey);
  return {
    ...progress,
    cards: { ...progress.cards, [key]: nextCard(progress.cards[key] ?? EMPTY_CARD, correct, now) },
    activity,
    updatedAt: Math.max(progress.updatedAt, now),
  };
}

/** Sets a card to at least `box` without counting an answer; used by placement seeding. */
export function seedCard(progress: AcademyProgress, code: CountryCode, skill: AcademySkill, box: LeitnerBox, now: number): AcademyProgress {
  const key = cardKey(code, skill);
  const existing = progress.cards[key] ?? EMPTY_CARD;
  if (existing.box >= box) return progress;
  return {
    ...progress,
    cards: { ...progress.cards, [key]: scheduleCard(existing, box, now) },
    updatedAt: Math.max(progress.updatedAt, now),
  };
}

export function allCards(progress: AcademyProgress): readonly DueCard[] {
  const cards: DueCard[] = [];
  for (const [key, card] of Object.entries(progress.cards) as [CardKey, CardProgress][]) {
    const parsed = parseCardKey(key);
    if (parsed) cards.push({ key, ...parsed, card });
  }
  return cards;
}

/** Seen cards whose due time has passed, most overdue first. */
export function dueCards(progress: AcademyProgress, now: number): readonly DueCard[] {
  return allCards(progress)
    .filter(({ card }) => card.box > 0 && card.dueAt <= now)
    .sort((left, right) => left.card.dueAt - right.card.dueAt || left.key.localeCompare(right.key));
}

export function dueCount(progress: AcademyProgress, now: number): number {
  return dueCards(progress, now).length;
}

/** Combines two copies (e.g. local and account): per card the newest answer wins. */
export function mergeProgress(left: AcademyProgress, right: AcademyProgress): AcademyProgress {
  const cards: Record<CardKey, CardProgress> = { ...left.cards };
  for (const [key, card] of Object.entries(right.cards) as [CardKey, CardProgress][]) {
    const existing = cards[key];
    if (!existing || card.lastSeenAt > existing.lastSeenAt || (card.lastSeenAt === existing.lastSeenAt && card.box > existing.box)) {
      cards[key] = card;
    }
  }

  const activity: Record<string, number> = { ...left.activity };
  for (const [day, count] of Object.entries(right.activity)) activity[day] = Math.max(activity[day] ?? 0, count);
  const latestDay = Object.keys(activity).sort().at(-1);

  const placements = [left.placementCompletedAt, right.placementCompletedAt].filter((value): value is number => value !== null);

  return {
    version: 1,
    cards,
    placementCompletedAt: placements.length > 0 ? Math.min(...placements) : null,
    activity: latestDay ? pruneActivity(activity, latestDay) : {},
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
  };
}
