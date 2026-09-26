import type { Continent, CountryCode } from "../countries";

/**
 * Shared contract for the Academy (training) feature. Core logic, storage, server sync and
 * UI all build against these types, so change them deliberately.
 *
 * Countries are always referenced by ISO code (e.g. "FR"), never by display name.
 */

/** What a player can learn about a country. Each (country, skill) pair is one spaced-repetition card. */
export type AcademySkill = "flag" | "shape" | "capital" | "map";

export const ACADEMY_SKILLS: readonly AcademySkill[] = ["flag", "shape", "capital", "map"];

/** A small regional lesson unit (5–8 countries), e.g. "Southern Africa". */
export interface LearningGroup {
  readonly id: string;
  readonly title: string;
  /** One-line description shown on the group card, e.g. "The countries south of the Zambezi". */
  readonly blurb: string;
  readonly continent: Continent;
  readonly countryCodes: readonly CountryCode[];
  /** 1 = famous starter unit, 2 = regional, 3 = deep cuts. Drives the suggested order. */
  readonly difficulty: 1 | 2 | 3;
  /** Global suggested order across all groups (0-based, unique). */
  readonly order: number;
}

/**
 * Leitner box: 0 = never seen, 1 = just introduced / just missed, 5 = long-term memory.
 * A correct answer moves the card up one box; a miss drops it to box 1.
 */
export type LeitnerBox = 0 | 1 | 2 | 3 | 4 | 5;

export interface CardProgress {
  readonly box: LeitnerBox;
  readonly correct: number;
  readonly wrong: number;
  /** Epoch ms of the last answer; 0 when never seen. */
  readonly lastSeenAt: number;
  /** Epoch ms when the card is next due for review; 0 when never seen. */
  readonly dueAt: number;
}

/** `${CountryCode}:${AcademySkill}`, e.g. "FR:flag". */
export type CardKey = `${string}:${AcademySkill}`;

export interface AcademyProgress {
  readonly version: 1;
  readonly cards: Readonly<Record<CardKey, CardProgress>>;
  /** Epoch ms when the placement quiz was finished or skipped; null when never taken. */
  readonly placementCompletedAt: number | null;
  /** Local calendar day (YYYY-MM-DD) → cards answered that day. Only the last ~60 days are kept. */
  readonly activity: Readonly<Record<string, number>>;
  /** Epoch ms of the last change; used to merge local and account copies (newest card wins per key). */
  readonly updatedAt: number;
}

/** Per-country mastery rolled up across skills; drives the mastery map colours. */
export type MasteryLevel = "new" | "learning" | "familiar" | "mastered";

/** One screen in a lesson, in ladder order: meet → recognise (choice) → recall (type) → place. */
export type LessonStep =
  | { readonly kind: "meet"; readonly code: CountryCode }
  | {
      readonly kind: "choice";
      readonly code: CountryCode;
      readonly skill: AcademySkill;
      /** Country codes to offer, including the answer, already shuffled. 2–4 options. */
      readonly options: readonly CountryCode[];
    }
  | {
      readonly kind: "type";
      readonly code: CountryCode;
      readonly skill: Exclude<AcademySkill, "map">;
      /** Scaffolding shown with the input; drops away as the card climbs boxes. */
      readonly scaffold: "first-letter" | "length" | "none";
    }
  | { readonly kind: "place"; readonly code: CountryCode };

export interface Lesson {
  /** Group id, "review" for due-card review, or "lookalikes" for confusion drills. */
  readonly id: string;
  readonly title: string;
  readonly steps: readonly LessonStep[];
}

/** A pair (or small set) of easily confused countries for one skill, with the tell-apart tip. */
export interface LookalikeSet {
  readonly skill: AcademySkill;
  readonly codes: readonly CountryCode[];
  readonly tip: string;
}

export interface AcademyLevel {
  readonly index: number;
  readonly title: string;
  /** Countries mastered needed to reach this level. */
  readonly minMastered: number;
}
