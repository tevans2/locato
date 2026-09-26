import { CONTINENTS, type Continent, type CountryCode, type CountryIndex } from "../countries";
import { fameTier, type FameTier } from "../countries/fame";
import { shuffle } from "../game/random";
import { ACADEMY_COUNTRY_CODES, groupForCountry, LEARNING_GROUPS } from "./groups";
import { pickDistractors } from "./lessons";
import { countryMastery, suggestNextGroup } from "./mastery";
import { seedCard } from "./srs";
import { ACADEMY_SKILLS, type AcademyProgress, type AcademySkill, type LearningGroup, type LeitnerBox } from "./types";

export const PLACEMENT_LENGTH = 20;
/** Box given to a card the player answered correctly in placement. */
export const PLACEMENT_KNOWN_BOX: LeitnerBox = 3;
/** Box given to untested cards in a fame tier the player clearly knows. */
export const PLACEMENT_EXTRAPOLATED_BOX: LeitnerBox = 2;
const ESTIMATE_MIN_ANSWERS = 3;
const ESTIMATE_MIN_ACCURACY = 0.7;
/**
 * Accuracy needed across a tier and everything harder. The adaptive staircase climbs after each
 * right answer, so a strong player's hardest tier settles near 50%; pooling the harder questions
 * credits them (9/13 deep cuts right is not a "fresh start").
 */
const ESTIMATE_MIN_POOLED_ACCURACY = 0.6;

type Random = () => number;

export interface PlacementQuestion {
  readonly code: CountryCode;
  readonly skill: AcademySkill;
  /** Country codes including the answer, shuffled. */
  readonly options: readonly CountryCode[];
  readonly tier: FameTier;
}

export interface PlacementResult {
  readonly code: CountryCode;
  readonly skill: AcademySkill;
  readonly correct: boolean;
}

/** Rungs 0–5 map to fame tier 1,1,2,2,3,3; higher rungs also get more options. */
const RUNG_TIERS: readonly FameTier[] = [1, 1, 2, 2, 3, 3];
const MAX_RUNG = RUNG_TIERS.length - 1;
const START_RUNG = 1;

export interface PlacementState {
  readonly countryIndex: CountryIndex;
  readonly random: Random;
  readonly length: number;
  readonly rung: number;
  readonly current: PlacementQuestion | null;
  readonly results: readonly PlacementResult[];
  readonly asked: readonly CountryCode[];
  readonly continentCycle: readonly Continent[];
}

function makeQuestion(
  countryIndex: CountryIndex,
  random: Random,
  tier: FameTier,
  continent: Continent,
  skill: AcademySkill,
  optionCount: number,
  exclude: ReadonlySet<CountryCode>,
): PlacementQuestion | null {
  const eligible = countryIndex.countries.filter((country) => !exclude.has(country.code) && groupForCountry(country.code));
  // Prefer the target tier and continent, then relax continent, then tier.
  const pools = [
    eligible.filter((country) => fameTier(country.code) === tier && country.continent === continent),
    eligible.filter((country) => fameTier(country.code) === tier),
    eligible,
  ];
  const pool = pools.find((candidates) => candidates.length > 0);
  if (!pool) return null;
  const country = shuffle(pool, random)[0]!;
  const distractors = pickDistractors(country.code, skill, optionCount - 1, countryIndex, random, []);
  return { code: country.code, skill, options: shuffle([country.code, ...distractors], random), tier: fameTier(country.code) };
}

function questionAt(state: Omit<PlacementState, "current">): PlacementQuestion | null {
  const number = state.results.length;
  if (number >= state.length) return null;
  const skill = ACADEMY_SKILLS[number % ACADEMY_SKILLS.length]!;
  const continent = state.continentCycle[number % state.continentCycle.length]!;
  const optionCount = state.rung >= 4 ? 4 : 3;
  return makeQuestion(state.countryIndex, state.random, RUNG_TIERS[state.rung]!, continent, skill, optionCount, new Set(state.asked));
}

/** Adaptive placement: starts easy, climbs a rung after each correct answer and drops one after a miss. */
export function createPlacementState(countryIndex: CountryIndex, random: Random, length = PLACEMENT_LENGTH): PlacementState {
  const base = {
    countryIndex,
    random,
    length,
    rung: START_RUNG,
    results: [],
    asked: [],
    continentCycle: shuffle(CONTINENTS, random),
  };
  const current = questionAt(base);
  return { ...base, current, asked: current ? [current.code] : [] };
}

export function nextPlacementQuestion(state: PlacementState, correct: boolean): PlacementState {
  const question = state.current;
  if (!question) return state;
  const results = [...state.results, { code: question.code, skill: question.skill, correct }];
  const rung = Math.max(0, Math.min(MAX_RUNG, state.rung + (correct ? 1 : -1)));
  const next = { ...state, results, rung };
  const current = questionAt(next);
  return { ...next, current, asked: current ? [...state.asked, current.code] : state.asked };
}

export function isPlacementComplete(state: PlacementState): boolean {
  return state.current === null;
}

/** Non-adaptive alternative: a fixed spread across tiers, continents and skills. */
export function buildPlacementQuiz(countryIndex: CountryIndex, random: Random, length = PLACEMENT_LENGTH): readonly PlacementQuestion[] {
  const continents = shuffle(CONTINENTS, random);
  const questions: PlacementQuestion[] = [];
  const asked = new Set<CountryCode>();
  for (let number = 0; number < length; number += 1) {
    // Tier rises through the quiz: first ~40% tier 1, next ~35% tier 2, the rest tier 3.
    const fraction = number / length;
    const tier: FameTier = fraction < 0.4 ? 1 : fraction < 0.75 ? 2 : 3;
    const skill = ACADEMY_SKILLS[number % ACADEMY_SKILLS.length]!;
    const question = makeQuestion(countryIndex, random, tier, continents[number % continents.length]!, skill, tier === 3 ? 4 : 3, asked);
    if (!question) break;
    asked.add(question.code);
    questions.push(question);
  }
  return questions;
}

export interface PlacementSummary {
  /** Highest fame tier answered confidently; 0 means start from the very beginning. */
  readonly estimatedTier: 0 | FameTier;
  readonly label: string;
  readonly correct: number;
  readonly total: number;
  /** Distinct countries the player answered right in the quiz itself. */
  readonly testedCorrect: number;
  /**
   * Untested countries pre-filled from the estimated tier (box 2 in the skills shown). These are
   * a guess, not knowledge: reviews will confirm or correct them.
   */
  readonly extrapolatedCount: number;
  readonly suggestedGroupId: string | null;
}

const TIER_LABELS: Readonly<Record<0 | FameTier, string>> = {
  0: "Fresh start",
  1: "Knows the big names",
  2: "Well travelled",
  3: "Seasoned geographer",
};

function tierAccuracy(results: readonly PlacementResult[], tier: FameTier, andHarder = false): { answered: number; accuracy: number } {
  const inTier = results.filter((result) => (andHarder ? fameTier(result.code) >= tier : fameTier(result.code) === tier));
  const correct = inTier.filter((result) => result.correct).length;
  return { answered: inTier.length, accuracy: inTier.length === 0 ? 0 : correct / inTier.length };
}

/**
 * Seeds cards from placement answers: each correct answer puts that card in box 3. The estimated
 * tier is the highest fame tier answered well — ≥3 questions and ≥70% right in that tier, or ≥60%
 * right across it and every harder tier; knowing a harder tier implies the easier ones. Every country in an estimated tier 1–2 also gets box 2 in the skills
 * the player got right at that tier or above. Deep cuts are never extrapolated.
 */
export function applyPlacement(
  progress: AcademyProgress,
  results: readonly PlacementResult[],
  now: number,
  countryCodes: readonly CountryCode[] = ACADEMY_COUNTRY_CODES,
): { readonly progress: AcademyProgress; readonly summary: PlacementSummary } {
  let estimatedTier: 0 | FameTier = 0;
  for (const tier of [1, 2, 3] as const) {
    const own = tierAccuracy(results, tier);
    const pooled = tierAccuracy(results, tier, true);
    const ownOk = own.answered >= ESTIMATE_MIN_ANSWERS && own.accuracy >= ESTIMATE_MIN_ACCURACY;
    const pooledOk = pooled.answered >= ESTIMATE_MIN_ANSWERS && pooled.accuracy >= ESTIMATE_MIN_POOLED_ACCURACY;
    if (ownOk || pooledOk) estimatedTier = tier;
  }

  const testedCorrectCodes = new Set(results.filter((result) => result.correct).map((result) => result.code));
  const extrapolated = new Set<CountryCode>();
  let next = progress;
  for (const tier of [1, 2] as const) {
    if (tier > estimatedTier) break;
    const skills = new Set(results.filter((result) => result.correct && fameTier(result.code) >= tier).map((result) => result.skill));
    for (const code of countryCodes.filter((candidate) => fameTier(candidate) === tier)) {
      for (const skill of skills) {
        const seeded = seedCard(next, code, skill, PLACEMENT_EXTRAPOLATED_BOX, now);
        if (seeded !== next && !testedCorrectCodes.has(code)) extrapolated.add(code);
        next = seeded;
      }
    }
  }

  for (const result of results) {
    if (result.correct) next = seedCard(next, result.code, result.skill, PLACEMENT_KNOWN_BOX, now);
  }

  next = { ...next, placementCompletedAt: next.placementCompletedAt ?? now, updatedAt: Math.max(next.updatedAt, now) };

  return {
    progress: next,
    summary: {
      estimatedTier,
      label: TIER_LABELS[estimatedTier],
      correct: results.filter((result) => result.correct).length,
      total: results.length,
      testedCorrect: testedCorrectCodes.size,
      extrapolatedCount: extrapolated.size,
      suggestedGroupId: suggestGroupAfterPlacement(next, estimatedTier)?.id ?? null,
    },
  };
}

/**
 * Where to start after placement: the first group in suggested order that still has a country
 * the player hasn't met (tested or pre-filled), within a difficulty band for their tier — so a
 * beginner starts on a difficulty-1 unit and a strong player skips the starter units whose
 * countries placement already filled in (even when a skill, say capitals, was never shown and
 * so those countries aren't formally "familiar").
 */
export function suggestGroupAfterPlacement(progress: AcademyProgress, estimatedTier: 0 | FameTier): LearningGroup | null {
  const floor = Math.max(1, estimatedTier);
  const ceiling = Math.min(3, estimatedTier + 1);
  const hasUnmet = (group: LearningGroup) => group.countryCodes.some((code) => countryMastery(progress, code) === "new");
  const candidates = LEARNING_GROUPS.filter(hasUnmet);
  return (
    candidates.find((group) => group.difficulty >= floor && group.difficulty <= ceiling) ??
    candidates.find((group) => group.difficulty >= floor) ??
    candidates[0] ??
    suggestNextGroup(progress)
  );
}

export function skipPlacement(progress: AcademyProgress, now: number): AcademyProgress {
  return { ...progress, placementCompletedAt: progress.placementCompletedAt ?? now, updatedAt: Math.max(progress.updatedAt, now) };
}
