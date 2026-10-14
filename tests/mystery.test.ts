import { describe, expect, it } from "vitest";
import { fameTier } from "../src/core/countries/fame";
import { rawCountries } from "../src/core/countries";
import { MYSTERY_ATTEMPT_COUNTRIES, leaderboardConfig } from "../src/core/leaderboards";
import {
  MYSTERY_MAX_GUESSES,
  MYSTERY_MAX_POINTS,
  MYSTERY_RUN_TIERS,
  bearingDegrees,
  compassFor,
  createDailyMysteryTarget,
  createMysteryRound,
  createMysteryTargets,
  guessMystery,
  hintMystery,
  mysteryClues,
  mysteryDailyNumber,
  mysteryDailyShareText,
  mysteryRoundPoints,
  revealMystery,
  type MysteryRound,
} from "../src/core/mystery";

function play(round: MysteryRound, ...codes: string[]): MysteryRound {
  for (const code of codes) {
    const result = guessMystery(round, code);
    if ("error" in result) throw new Error(`${code}: ${result.error}`);
    round = result.round;
  }
  return round;
}

describe("Mystery country clues", () => {
  it("points from the guess towards the mystery country", () => {
    expect(compassFor(bearingDegrees({ lat: 0, lng: 0 }, { lat: 10, lng: 0 }))).toBe("N");
    expect(compassFor(bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: -10 }))).toBe("W");
    expect(compassFor(bearingDegrees({ lat: 10, lng: 10 }, { lat: 0, lng: 0 }))).toBe("SW");
    expect(mysteryClues("ES", "FR")).toMatchObject({ correct: false, direction: "NE", sameContinent: true, neighbour: true, sameDrivingSide: true });
    expect(mysteryClues("FR", "ES")?.direction).toBe("SW");
  });

  it("compares the mystery country with the guess and says how close it is", () => {
    const clues = mysteryClues("FR", "DE")!;
    expect(clues.population).toBe("higher");
    expect(clues.area).toBe("lower");
    expect(clues.distanceKm).toBeGreaterThan(500);
    expect(clues.distanceKm).toBeLessThan(1200);
    expect(clues.proximity).toBeGreaterThan(90);
    expect(clues.proximity).toBeLessThan(100);
    expect(mysteryClues("AU", "DE")!.proximity).toBeLessThan(30);
    expect(mysteryClues("AT", "CH")).toMatchObject({ sameLandlocked: true, population: "same" });
    expect(mysteryClues("GB", "FR")).toMatchObject({ sameDrivingSide: false, neighbour: false });
    expect(mysteryClues("DE", "DE")).toMatchObject({ correct: true, distanceKm: 0, direction: null, proximity: 100 });
    expect(mysteryClues("XX", "DE")).toBeNull();
  });
});

describe("Mystery country rounds", () => {
  it("is found in a few guesses, scoring less for each extra guess and hint", () => {
    let round = play(createMysteryRound("DE"), "FR", "PL");
    expect(round.status).toBe("playing");
    const hinted = hintMystery(round);
    if ("error" in hinted) throw new Error(hinted.error);
    expect(hinted.hint).toEqual({ level: 1, text: "It's in Western Europe." });
    round = play(hinted.round, "DE");
    expect(round.status).toBe("solved");
    expect(mysteryRoundPoints(round)).toBe(MYSTERY_MAX_POINTS - 2 * 12 - 15);
    expect(mysteryRoundPoints(play(createMysteryRound("DE"), "DE"))).toBe(MYSTERY_MAX_POINTS);
  });

  it("refuses repeats and unknown codes without using a guess, and gives two hints", () => {
    const round = play(createMysteryRound("DE"), "FR");
    expect(guessMystery(round, "FR")).toEqual({ error: "repeat" });
    expect(guessMystery(round, "XX")).toEqual({ error: "unknown" });
    const second = hintMystery((hintMystery(round) as { round: MysteryRound }).round);
    expect(second).toMatchObject({ hint: { level: 2, text: "Its name starts with “G”." } });
    expect(hintMystery((second as { round: MysteryRound }).round)).toEqual({ error: "no-hints" });
  });

  it("fails after the last guess and scores nothing when missed or given up", () => {
    const wrong = ["FR", "PL", "IT", "ES", "PT", "NL", "BE", "AT"];
    expect(wrong).toHaveLength(MYSTERY_MAX_GUESSES);
    const failed = play(createMysteryRound("DE"), ...wrong);
    expect(failed.status).toBe("failed");
    expect(mysteryRoundPoints(failed)).toBe(0);
    expect(guessMystery(failed, "DE")).toEqual({ error: "finished" });
    expect(mysteryRoundPoints(revealMystery(createMysteryRound("DE")))).toBe(0);
  });
});

describe("Mystery country targets", () => {
  it("deals five distinct countries per run, getting harder, the same for the same seed", () => {
    const targets = createMysteryTargets("seed-a");
    expect(targets).toHaveLength(MYSTERY_ATTEMPT_COUNTRIES);
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets.map(fameTier)).toEqual([...MYSTERY_RUN_TIERS]);
    expect(createMysteryTargets("seed-a")).toEqual(targets);
    expect(createMysteryTargets("seed-b")).not.toEqual(targets);
    for (const code of targets) expect(rawCountries.some((country) => country.code === code)).toBe(true);
  });

  it("picks one well-known country per day and shares without naming it", () => {
    const target = createDailyMysteryTarget("2026-10-14");
    expect(createDailyMysteryTarget("2026-10-14")).toBe(target);
    expect(fameTier(target)).toBeLessThanOrEqual(2);
    expect(mysteryDailyNumber("2026-10-14")).toBe(1);
    expect(mysteryDailyNumber("2026-10-20")).toBe(7);
    const near = target === "FR" ? "DE" : "FR";
    const far = ["AU", "NZ"].find((code) => code !== target)!;
    const round = play(createMysteryRound(target), far, near, target);
    const text = mysteryDailyShareText(round, { number: 1, url: "https://locato.quest/?game=mystery&daily=1" });
    expect(text.split("\n")[0]).toBe("#locato Mystery #1 3/8");
    expect(text.split("\n")[1]).toMatch(/^🟦[🟦🟨🟧]🟩$/u);
    expect(text).toContain("https://locato.quest/?game=mystery&daily=1");
    expect(mysteryDailyShareText(revealMystery(createMysteryRound(target)), { number: 2, url: "u" })).toBe("#locato Mystery #2 X/8\n·\nu");
  });

  it("matches the leaderboard's attempt", () => {
    expect(leaderboardConfig("mystery")).toMatchObject({ metric: "score", runs: "single", maxScore: MYSTERY_ATTEMPT_COUNTRIES * MYSTERY_MAX_POINTS });
  });
});
