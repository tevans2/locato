import type { AcademyProgress, CardKey, CardProgress } from "../../src/core/academy/types";

// The server keeps at most this many activity days; older days are dropped after a merge so the
// stored blob can't grow without bound as devices keep syncing.
export const STORED_ACTIVITY_DAYS = 90;

function answers(card: CardProgress): number {
  return card.correct + card.wrong;
}

// Newest lastSeenAt wins. Ties go to the card with more answers, then to `a`, so merging a
// payload with itself is a no-op.
function pickCard(a: CardProgress, b: CardProgress): CardProgress {
  if (a.lastSeenAt !== b.lastSeenAt) return a.lastSeenAt > b.lastSeenAt ? a : b;
  return answers(b) > answers(a) ? b : a;
}

function earliest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

// Pure merge of two already-validated progress blobs (e.g. stored account copy and an upload).
// Per card key the newer lastSeenAt wins; activity takes the max per day; placement keeps the
// earliest completion; updatedAt is the max of both.
export function mergeAcademyProgress(a: AcademyProgress, b: AcademyProgress): AcademyProgress {
  const cards: Record<CardKey, CardProgress> = { ...a.cards };
  for (const [key, card] of Object.entries(b.cards) as [CardKey, CardProgress][]) {
    const existing = cards[key];
    cards[key] = existing ? pickCard(existing, card) : card;
  }

  const activity: Record<string, number> = { ...a.activity };
  for (const [day, count] of Object.entries(b.activity)) {
    activity[day] = Math.max(activity[day] ?? 0, count);
  }

  return {
    version: 1,
    cards,
    placementCompletedAt: earliest(a.placementCompletedAt, b.placementCompletedAt),
    activity: trimActivity(activity, STORED_ACTIVITY_DAYS),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}

// Keeps the `maxDays` most recent YYYY-MM-DD keys (lexicographic order is chronological).
export function trimActivity(activity: Readonly<Record<string, number>>, maxDays: number): Record<string, number> {
  const days = Object.keys(activity).sort().slice(-maxDays);
  return Object.fromEntries(days.map((day) => [day, activity[day]!]));
}
