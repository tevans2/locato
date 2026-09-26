import { describe, expect, it } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { fameTier, FAME_TIER_1_CODES } from "../src/core/countries/fame";
import { createSeededRandom } from "../src/core/game";
import {
  applyPlacement,
  buildPlacementQuiz,
  createPlacementState,
  emptyProgress,
  getCard,
  isPlacementComplete,
  nextPlacementQuestion,
  skipPlacement,
  type PlacementResult,
} from "../src/core/academy";

const index = indexCountries(rawCountries);
const NOW = Date.UTC(2026, 8, 26, 12);

function runAdaptive(answer: (tier: number) => boolean, seed = "p") {
  let state = createPlacementState(index, createSeededRandom(seed));
  const tiers: number[] = [];
  while (!isPlacementComplete(state)) {
    const question = state.current!;
    expect(question.options).toContain(question.code);
    expect(new Set(question.options).size).toBe(question.options.length);
    tiers.push(question.tier);
    state = nextPlacementQuestion(state, answer(question.tier));
  }
  return { state, tiers };
}

describe("placement quiz", () => {
  it("builds a fixed spread across skills, tiers and continents", () => {
    const quiz = buildPlacementQuiz(index, createSeededRandom("fixed"));
    expect(quiz).toHaveLength(20);
    expect(new Set(quiz.map((question) => question.code)).size).toBe(20);
    expect(new Set(quiz.map((question) => question.skill)).size).toBe(4);
    expect(new Set(quiz.map((question) => question.tier))).toEqual(new Set([1, 2, 3]));
    expect(new Set(quiz.map((question) => index.byCode.get(question.code)!.continent)).size).toBe(6);
  });

  it("moves harder after correct answers and easier after misses", () => {
    const expert = runAdaptive(() => true);
    expect(expert.tiers).toHaveLength(20);
    expect(expert.tiers.slice(-5).every((tier) => tier === 3)).toBe(true);

    const beginner = runAdaptive(() => false);
    expect(beginner.tiers.every((tier) => tier === 1)).toBe(true);

    const middling = runAdaptive((tier) => tier <= 2);
    expect(middling.tiers.slice(5)).toContain(2);
    expect(middling.tiers.slice(5)).toContain(3);
    expect(new Set(middling.state.results.map((result) => result.code)).size).toBe(20);
  });

  it("is deterministic for a seed", () => {
    expect(runAdaptive(() => true, "same").tiers).toEqual(runAdaptive(() => true, "same").tiers);
  });
});

describe("applyPlacement", () => {
  it("seeds known cards, extrapolates strong tiers and summarises", () => {
    const { state } = runAdaptive((tier) => tier <= 2, "mid");
    const { progress, summary } = applyPlacement(emptyProgress(), state.results, NOW);
    expect(progress.placementCompletedAt).toBe(NOW);
    for (const result of state.results) {
      if (result.correct) expect(getCard(progress, result.code, result.skill).box).toBe(3);
    }
    expect(summary.estimatedTier).toBe(2);
    expect(summary.total).toBe(20);
    const untestedTier1 = FAME_TIER_1_CODES.find((code) => !state.results.some((result) => result.code === code))!;
    expect(getCard(progress, untestedTier1, "flag").box).toBe(2);
    expect(summary.knownCount).toBeGreaterThan(40);
    expect(summary.suggestedGroupId).toBeTruthy();
    const tier3Untested = rawCountries.map((c) => c.code).find((code) => fameTier(code) === 3 && !state.results.some((r) => r.code === code))!;
    expect(getCard(progress, tier3Untested, "flag").box).toBe(0);
  });

  it("gives beginners a fresh start", () => {
    const results: PlacementResult[] = [
      { code: "FR", skill: "flag", correct: true },
      { code: "DE", skill: "capital", correct: false },
      { code: "JP", skill: "map", correct: false },
      { code: "BR", skill: "shape", correct: false },
    ];
    const { progress, summary } = applyPlacement(emptyProgress(), results, NOW);
    expect(summary).toMatchObject({ estimatedTier: 0, correct: 1, total: 4, knownCount: 1, suggestedGroupId: "europe-big-names" });
    expect(Object.keys(progress.cards)).toEqual(["FR:flag"]);
  });

  it("skip marks placement done without cards", () => {
    const skipped = skipPlacement(emptyProgress(), NOW);
    expect(skipped.placementCompletedAt).toBe(NOW);
    expect(skipped.cards).toEqual({});
    expect(skipPlacement(skipped, NOW + 5).placementCompletedAt).toBe(NOW);
  });
});
