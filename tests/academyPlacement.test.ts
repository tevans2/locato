import { describe, expect, it } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { fameTier, FAME_TIER_1_CODES } from "../src/core/countries/fame";
import { createSeededRandom } from "../src/core/game";
import {
  applyPlacement,
  buildPlacementQuiz,
  countryMastery,
  findGroup,
  suggestGroupAfterPlacement,
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
    // Tested and extrapolated countries are reported separately and never overlap.
    expect(summary.testedCorrect).toBe(new Set(state.results.filter((r) => r.correct).map((r) => r.code)).size);
    expect(summary.testedCorrect).toBeLessThanOrEqual(summary.correct);
    expect(summary.extrapolatedCount).toBeGreaterThan(40);
    const seeded = new Set(Object.keys(progress.cards).map((key) => key.split(":")[0]));
    expect(summary.extrapolatedCount + summary.testedCorrect).toBe(seeded.size);
    // A tier-2 player starts on a difficulty-2+ unit with countries they haven't met.
    const group = findGroup(summary.suggestedGroupId!)!;
    expect(group.difficulty).toBeGreaterThanOrEqual(2);
    expect(group.countryCodes.some((code) => countryMastery(progress, code) === "new")).toBe(true);
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
    expect(summary).toMatchObject({ estimatedTier: 0, correct: 1, total: 4, testedCorrect: 1, extrapolatedCount: 0, suggestedGroupId: "europe-big-names" });
    expect(Object.keys(progress.cards)).toEqual(["FR:flag"]);
  });

  it("sends a beginner to a difficulty-1 unit even when a starter unit got a correct answer", () => {
    const results: PlacementResult[] = ["GB", "FR", "DE", "IT", "ES", "PT", "GR"].map((code) => ({ code, skill: "flag" as const, correct: true }));
    const wrong: PlacementResult[] = ["JP", "BR", "EG", "US", "CN"].map((code) => ({ code, skill: "capital" as const, correct: false }));
    const { summary } = applyPlacement(emptyProgress(), [...results, ...wrong], NOW);
    expect(summary.estimatedTier).toBe(0);
    expect(findGroup(summary.suggestedGroupId!)!.difficulty).toBe(1);
  });

  it("skips starter units a strong player effectively knows, even with a skill never shown", () => {
    // Right on flags, maps and outlines across tiers 1–2, but no capital questions at all.
    const skills = ["flag", "map", "shape"] as const;
    const tier1 = ["JP", "BR", "EG", "US", "CN", "DE"];
    const tier2 = ["HU", "CZ", "NO", "PH", "GH", "UY"];
    const results: PlacementResult[] = [...tier1, ...tier2].map((code, i) => ({ code, skill: skills[i % 3]!, correct: true }));
    const { progress, summary } = applyPlacement(emptyProgress(), results, NOW);
    expect(summary.estimatedTier).toBe(2);
    // Capitals were never shown, so starter countries aren't formally familiar...
    expect(countryMastery(progress, "FR")).not.toBe("familiar");
    // ...but the suggestion still moves past them.
    const group = findGroup(summary.suggestedGroupId!)!;
    expect(group.difficulty).toBeGreaterThanOrEqual(2);
    expect(suggestGroupAfterPlacement(progress, 2)?.id).toBe(group.id);
  });

  it("credits a strong staircase run whose hardest tier settles below 70%", () => {
    const pattern = "1+ 2+ 2+ 3+ 3+ 3+ 3+ 3- 3- 2- 2+ 2+ 3+ 3+ 3+ 3+ 3+ 3- 3- 2-".split(" ");
    const pools: Record<string, string[]> = {
      "1": ["FR", "DE"],
      "2": ["HU", "CZ", "NO", "PH", "GH", "UY"],
      "3": ["LI", "SM", "TV", "NR", "PW", "KM", "ST", "GW", "BT", "BN", "TL", "LS", "SZ"],
    };
    const results: PlacementResult[] = pattern.map((entry, i) => ({ code: pools[entry[0]!]!.shift()!, skill: (["flag", "map", "shape", "capital"] as const)[i % 4]!, correct: entry[1] === "+" }));
    expect(results.every((result) => fameTier(result.code) === Number(pattern[results.indexOf(result)]![0]))).toBe(true);
    const { summary } = applyPlacement(emptyProgress(), results, NOW);
    expect(summary.correct).toBe(14);
    // 9/13 deep cuts (69%) is a strong result on a staircase that climbs after every right answer.
    expect(summary.estimatedTier).toBe(3);
    expect(findGroup(summary.suggestedGroupId!)!.difficulty).toBeGreaterThanOrEqual(2);
  });

  it("skip marks placement done without cards", () => {
    const skipped = skipPlacement(emptyProgress(), NOW);
    expect(skipped.placementCompletedAt).toBe(NOW);
    expect(skipped.cards).toEqual({});
    expect(skipPlacement(skipped, NOW + 5).placementCompletedAt).toBe(NOW);
  });
});
