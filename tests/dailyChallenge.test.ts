import { describe, expect, it } from "vitest";
import { createDailyChallenge, createDailyShareText, DAILY_PROMPT_COUNTRY_COUNT, formatDailyTime, scoreDailyMapTapRound, scoreDailyRound, parseDailyRoundResults } from "../src/core/dailyChallenge";
import { indexCountries, rawCountries } from "../src/core/countries";
import { fameTier } from "../src/core/countries/fame";
import { createGameEngine } from "../src/core/game";
import { createSoloSave, hydrateGameState } from "../src/storage/localSave";
import { streetViewCountryRounds } from "../src/core/streetview";
import { findMapTapLocation } from "../src/core/maptap/locations";

describe("daily challenge", () => {
  it("selects the same daily rounds for the same date", () => {
    const index = indexCountries(rawCountries);
    const first = createDailyChallenge(index, "2026-06-11");
    const second = createDailyChallenge(index, "2026-06-11");

    expect(first.seed).toBe("daily:2026-06-11");
    expect(first.categoryIds).toEqual(["flags", "shapes", "capitals", "pick-country", "spot-country"]);
    expect(first.countryIds).toHaveLength(DAILY_PROMPT_COUNTRY_COUNT);
    expect(first.mapTapTargetId).toBeTruthy();
    expect(first.streetViewCountryCode).toBeTruthy();
    expect(second).toEqual(first);
  });

  it("changes the selection when the date changes", () => {
    const index = indexCountries(rawCountries);
    const first = createDailyChallenge(index, "2026-06-11");
    const second = createDailyChallenge(index, "2026-06-12");

    expect([second.countryIds, second.mapTapTargetId, second.streetViewCountryCode]).not.toEqual([first.countryIds, first.mapTapTargetId, first.streetViewCountryCode]);
  });

  it("keeps all ten rounds within the theme with distinct countries across a month", () => {
    const index = indexCountries(rawCountries);
    const themes = new Set<string>();
    for (let day = 1; day <= 31; day++) {
      const challenge = createDailyChallenge(index, `2026-10-${String(day).padStart(2, "0")}`);
      themes.add(challenge.theme!.id);
      expect(challenge.promptSlots!.map((slot) => slot.categoryId)).toEqual(["flags", "flags", "capitals", "capitals", "shapes", "shapes", "pick-country", "spot-country"]);
      expect(challenge.themeScoped).toBe(true);
      expect(challenge.countryIds.slice(0, 5).map((id) => fameTier(index.byId[id]!.code))).toEqual([1, 1, 2, 2, 1]);
      expect(new Set(challenge.countryIds).size).toBe(8);
      for (const id of challenge.countryIds) expect(challenge.theme!.countryCodes).toContain(index.byId[id]!.code);
      expect(challenge.theme!.mapTapTargetIds).toContain(challenge.mapTapTargetId);
      expect(findMapTapLocation(challenge.mapTapTargetId)!.difficulty).not.toBe("hard");
      expect(challenge.theme!.countryCodes).toContain(challenge.streetViewCountryCode);
      expect(index.byCode.has(challenge.streetViewCountryCode)).toBe(true);
    }
    expect(themes.size).toBe(7);
  });

  it("keeps southern hemisphere countries and both location finales south of the equator", () => {
    const index = indexCountries(rawCountries);
    for (let day = 4; day <= 365; day += 7) {
      const date = new Date(Date.UTC(2026, 9, day)).toISOString().slice(0, 10);
      const challenge = createDailyChallenge(index, date);
      expect(challenge.theme!.id).toBe("southern");
      expect(challenge.countryIds).toHaveLength(8);
      for (const id of challenge.countryIds) expect(challenge.theme!.countryCodes).toContain(index.byId[id]!.code);
      expect(findMapTapLocation(challenge.mapTapTargetId)!.lat).toBeLessThan(0);
      const streetRound = streetViewCountryRounds.find((round) => round.countryCode === challenge.streetViewCountryCode)!;
      for (const frame of streetRound.frames) expect(frame.lat).toBeLessThan(0);
    }
  });

  it("plays and resumes the explicit daily categories instead of reassigning them", () => {
    const index = indexCountries(rawCountries);
    const challenge = createDailyChallenge(index, "2026-10-01");
    const input = { countryIndex: index, categoryIds: challenge.categoryIds, seed: challenge.seed, promptSlots: challenge.promptSlots!, poolOrdering: "fixed" as const };
    const engine = createGameEngine(input);
    for (const [position, slot] of challenge.promptSlots!.entries()) {
      expect(engine.getState()).toMatchObject({ currentCountryId: slot.countryId, currentCategoryId: slot.categoryId, roundNumber: position + 1 });
      const saved = createSoloSave(index, engine.getState(), 10_000);
      const resumed = createGameEngine({ ...input, initialState: hydrateGameState(index, saved)! });
      expect(resumed.getState().currentCategoryId).toBe(slot.categoryId);
      const country = index.byId[slot.countryId]!;
      engine.dispatch({ type: "SUBMIT_GUESS", value: slot.categoryId === "pick-country" ? country.code : country.name, now: 11_000 });
    }
    expect(engine.getState().status).toBe("complete");
    engine.dispatch({ type: "RESET_GAME", now: 12_000 });
    expect(engine.getState().currentCountryId).toBe(challenge.countryIds[0]);
  });

  it("rejects malformed review details and preserves a zero-point correct round", () => {
    const round = { categoryId: "flags", countryCode: "JP", points: 0, hintsUsed: 3, wrongGuesses: 1, missed: false };
    expect(parseDailyRoundResults([round])).toEqual([round]);
    expect(parseDailyRoundResults([{ ...round, points: 11 }])).toBeNull();
    expect(parseDailyRoundResults([{ ...round, categoryId: "invalid" }])).toBeNull();
    expect(parseDailyRoundResults([{ ...round, countryCode: "<script>" }])).toBeNull();
    expect(parseDailyRoundResults([{ ...round, categoryId: "map-tap", targetId: "tokyo", distanceKm: Infinity }])).toBeNull();
  });

  it("formats time and share text", () => {
    expect(formatDailyTime(134000)).toBe("02:14");
    expect(createDailyShareText("2026-06-11", 80, 134000, ["correct", "correct", "miss", "correct", "hint", "correct", "correct", "miss", "correct", "correct"])).toBe(`Locato Daily 2026-06-11
Score: 80/100
Time: 02:14
🟩🟩🟥🟩🟨🟩🟩🟥🟩🟩`);
  });

  it("scores daily rounds with hint, wrong-answer, and miss penalties", () => {
    expect(scoreDailyRound(0)).toBe(10);
    expect(scoreDailyRound(1)).toBe(7);
    expect(scoreDailyRound(0, false, 1)).toBe(8);
    expect(scoreDailyRound(1, false, 2)).toBe(3);
    expect(scoreDailyRound(2, true, 2)).toBe(0);
    expect(scoreDailyMapTapRound(5000, 5000)).toBe(10);
    expect(scoreDailyMapTapRound(2500, 5000)).toBe(5);
  });
});
