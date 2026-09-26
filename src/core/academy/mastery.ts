import type { Continent, CountryCode } from "../countries";
import { ACADEMY_COUNTRY_CODES, LEARNING_GROUPS, groupsForContinent } from "./groups";
import { boxOf } from "./srs";
import { ACADEMY_SKILLS, type AcademyLevel, type AcademyProgress, type LearningGroup, type MasteryLevel } from "./types";

/** Box every skill must reach for "familiar" (or an average of FAMILIAR_AVERAGE_BOX with every skill seen). */
export const FAMILIAR_MIN_BOX = 2;
export const FAMILIAR_AVERAGE_BOX = 3;
/** Box every skill must reach for "mastered" (a week-long interval survived). */
export const MASTERED_MIN_BOX = 4;

export const ACADEMY_LEVELS: readonly AcademyLevel[] = [
  { index: 0, title: "Tourist", minMastered: 0 },
  { index: 1, title: "Backpacker", minMastered: 5 },
  { index: 2, title: "Explorer", minMastered: 20 },
  { index: 3, title: "Navigator", minMastered: 50 },
  { index: 4, title: "Cartographer", minMastered: 100 },
  { index: 5, title: "Atlas", minMastered: 160 },
];

export function countryMastery(progress: AcademyProgress, code: CountryCode): MasteryLevel {
  const boxes = ACADEMY_SKILLS.map((skill) => boxOf(progress, code, skill));
  const min = Math.min(...boxes);
  const max = Math.max(...boxes);
  const average = boxes.reduce<number>((sum, box) => sum + box, 0) / boxes.length;

  if (max === 0) return "new";
  if (min >= MASTERED_MIN_BOX) return "mastered";
  if (min >= FAMILIAR_MIN_BOX || (min >= 1 && average >= FAMILIAR_AVERAGE_BOX)) return "familiar";
  return "learning";
}

export interface CompletionSummary {
  readonly mastered: number;
  /** Familiar but not yet mastered. */
  readonly familiar: number;
  readonly learning: number;
  readonly new: number;
  readonly total: number;
  /** 0–100, box progress towards mastery (each card counts up to box 4). */
  readonly percent: number;
  /** At least one country has been seen. */
  readonly started: boolean;
  /** Every country is at least familiar. */
  readonly completed: boolean;
}

function summarize(progress: AcademyProgress, codes: readonly CountryCode[]): CompletionSummary {
  const counts: Record<MasteryLevel, number> = { new: 0, learning: 0, familiar: 0, mastered: 0 };
  let boxPoints = 0;
  for (const code of codes) {
    counts[countryMastery(progress, code)] += 1;
    for (const skill of ACADEMY_SKILLS) boxPoints += Math.min(boxOf(progress, code, skill), MASTERED_MIN_BOX);
  }
  const maxPoints = codes.length * ACADEMY_SKILLS.length * MASTERED_MIN_BOX;
  return {
    ...counts,
    total: codes.length,
    percent: maxPoints === 0 ? 0 : Math.round((boxPoints / maxPoints) * 100),
    started: counts.new < codes.length,
    completed: codes.length > 0 && counts.familiar + counts.mastered === codes.length,
  };
}

export function groupCompletion(progress: AcademyProgress, group: LearningGroup): CompletionSummary {
  return summarize(progress, group.countryCodes);
}

export interface ContinentSummary extends CompletionSummary {
  readonly continent: Continent;
  readonly groupCount: number;
  readonly completedGroups: number;
}

export function continentSummary(progress: AcademyProgress, continent: Continent): ContinentSummary {
  const groups = groupsForContinent(continent);
  return {
    ...summarize(progress, groups.flatMap((group) => group.countryCodes)),
    continent,
    groupCount: groups.length,
    completedGroups: groups.filter((group) => groupCompletion(progress, group).completed).length,
  };
}

export function masteredCount(progress: AcademyProgress): number {
  return ACADEMY_COUNTRY_CODES.filter((code) => countryMastery(progress, code) === "mastered").length;
}

export interface AcademyLevelStatus {
  readonly level: AcademyLevel;
  readonly next: AcademyLevel | null;
  readonly mastered: number;
  /** 0–1 progress from the current level's threshold to the next; 1 at the top level. */
  readonly progressToNext: number;
}

export function academyLevel(progress: AcademyProgress): AcademyLevelStatus {
  return levelForMastered(masteredCount(progress));
}

export function levelForMastered(mastered: number): AcademyLevelStatus {
  let levelIndex = 0;
  ACADEMY_LEVELS.forEach((candidate, index) => {
    if (mastered >= candidate.minMastered) levelIndex = index;
  });
  const level = ACADEMY_LEVELS[levelIndex]!;
  const next = ACADEMY_LEVELS[levelIndex + 1] ?? null;
  const progressToNext = next ? (mastered - level.minMastered) / (next.minMastered - level.minMastered) : 1;
  return { level, next, mastered, progressToNext };
}

/**
 * Consecutive days with at least one answer, ending today. A streak stays alive through today
 * until the player studies, so if today is empty the count starts from yesterday.
 */
export function studyStreak(activity: Readonly<Record<string, number>>, todayKey: string): number {
  const days = new Set(Object.entries(activity).filter(([, count]) => count > 0).map(([day]) => day));
  const start = days.has(todayKey) ? 0 : 1;
  let streak = 0;
  for (let offset = start; ; offset += 1) {
    const day = shiftDayKey(todayKey, -offset);
    if (!days.has(day)) break;
    streak += 1;
  }
  return streak;
}

export function shiftDayKey(dayKey: string, days: number): string {
  const date = new Date(Date.parse(`${dayKey}T00:00:00Z`) + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** The lowest-order group that is not yet completed; null once everything is at least familiar. */
export function suggestNextGroup(progress: AcademyProgress): LearningGroup | null {
  return LEARNING_GROUPS.find((group) => !groupCompletion(progress, group).completed) ?? null;
}

