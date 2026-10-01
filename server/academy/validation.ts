import { rawCountries } from "../../src/core/countries";
import type { AcademyProgress, CardKey, CardProgress, LeitnerBox } from "../../src/core/academy/types";

// Hard limits for an uploaded Academy progress blob. A full deck (every country × every skill)
// with 60 days of activity serializes to well under 100 KB, so these leave generous headroom.
export const MAX_ACADEMY_PAYLOAD_BYTES = 256 * 1024;
export const ACADEMY_SKILL_IDS = ["flag", "shape", "capital", "map"] as const;
export const KNOWN_COUNTRY_CODES: ReadonlySet<string> = new Set(rawCountries.map((country) => country.code));
export const MAX_ACADEMY_CARDS = KNOWN_COUNTRY_CODES.size * ACADEMY_SKILL_IDS.length;
export const MAX_CARD_ANSWER_COUNT = 100_000;
export const MAX_ACTIVITY_DAYS = 400;
export const MAX_ACTIVITY_PER_DAY = 10_000;
// Past-tense timestamps (lastSeenAt, placementCompletedAt, updatedAt) slightly ahead of the
// server clock are clamped to "now" — a device clock a few minutes fast shouldn't break sync,
// and clamping stops a future lastSeenAt from winning every later merge. Anything further out
// is rejected as bogus.
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
// dueAt is a scheduled review time, so it's legitimately in the future — but not by years.
export const MAX_DUE_AHEAD_MS = 2 * 365 * 24 * 60 * 60 * 1000;

const CARD_KEY_PATTERN = /^([A-Z]{2}):(flag|shape|capital|map)$/;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type AcademyValidation = { readonly ok: true; readonly progress: AcademyProgress } | { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedInt(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

function isCalendarDay(key: string): boolean {
  const match = DAY_PATTERN.exec(key);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// A past-tense timestamp: non-negative integer, clamped to `now` within the skew allowance.
function pastTimestamp(value: unknown, now: number): number | null {
  if (!isBoundedInt(value, Number.MAX_SAFE_INTEGER)) return null;
  if (value > now + MAX_CLOCK_SKEW_MS) return null;
  return Math.min(value, now);
}

function parseCard(value: unknown, now: number): CardProgress | string {
  if (!isRecord(value)) return "must be an object";
  const { box, correct, wrong, lastSeenAt, dueAt } = value;
  if (!isBoundedInt(box, 5)) return "box must be an integer 0–5";
  if (!isBoundedInt(correct, MAX_CARD_ANSWER_COUNT) || !isBoundedInt(wrong, MAX_CARD_ANSWER_COUNT)) return "counts must be non-negative integers";
  const seen = pastTimestamp(lastSeenAt, now);
  if (seen === null) return "lastSeenAt is invalid or in the future";
  if (!isBoundedInt(dueAt, now + MAX_DUE_AHEAD_MS)) return "dueAt is invalid";
  return { box: box as LeitnerBox, correct, wrong, lastSeenAt: seen, dueAt };
}

// Strictly validates an untrusted AcademyProgress and returns a sanitized copy containing only
// known fields. `now` is the server clock (epoch ms).
export function validateAcademyProgress(input: unknown, now: number): AcademyValidation {
  if (!isRecord(input)) return { ok: false, error: "Progress must be an object." };
  if (input.version !== 1) return { ok: false, error: "Unsupported progress version." };

  if (!isRecord(input.cards)) return { ok: false, error: "Progress cards must be an object." };
  const cardEntries = Object.entries(input.cards);
  if (cardEntries.length > MAX_ACADEMY_CARDS) return { ok: false, error: "Too many cards." };
  const cards: Record<CardKey, CardProgress> = {};
  for (const [key, value] of cardEntries) {
    const match = CARD_KEY_PATTERN.exec(key);
    if (!match) return { ok: false, error: `Invalid card key: ${key.slice(0, 32)}` };
    if (!KNOWN_COUNTRY_CODES.has(match[1]!)) return { ok: false, error: `Unknown country in card key: ${key}` };
    const card = parseCard(value, now);
    if (typeof card === "string") return { ok: false, error: `Card ${key}: ${card}.` };
    cards[key as CardKey] = card;
  }

  let placementCompletedAt: number | null = null;
  if (input.placementCompletedAt !== null && input.placementCompletedAt !== undefined) {
    placementCompletedAt = pastTimestamp(input.placementCompletedAt, now);
    if (placementCompletedAt === null) return { ok: false, error: "placementCompletedAt is invalid or in the future." };
  }

  if (!isRecord(input.activity)) return { ok: false, error: "Progress activity must be an object." };
  const activityEntries = Object.entries(input.activity);
  if (activityEntries.length > MAX_ACTIVITY_DAYS) return { ok: false, error: "Too many activity days." };
  const activity: Record<string, number> = {};
  for (const [day, count] of activityEntries) {
    if (!isCalendarDay(day)) return { ok: false, error: `Invalid activity day: ${day.slice(0, 16)}` };
    if (!isBoundedInt(count, MAX_ACTIVITY_PER_DAY)) return { ok: false, error: `Invalid activity count for ${day}.` };
    activity[day] = count;
  }

  const updatedAt = pastTimestamp(input.updatedAt, now);
  if (updatedAt === null) return { ok: false, error: "updatedAt is invalid or in the future." };

  return { ok: true, progress: { version: 1, cards, placementCompletedAt, activity, updatedAt } };
}
