import { describe, expect, it } from "vitest";
import { createDailyChallenge, createDailyShareText, formatDailyTime, scoreDailyRound } from "../src/core/dailyChallenge";
import { indexCountries, type RawCountry } from "../src/core/countries";

const fixtureCountries = Array.from({ length: 14 }, (_, index) => {
  const number = index + 1;
  return {
    name: `Country ${number}`,
    code: `C${String.fromCharCode(65 + index)}`,
    aliases: [],
    continent: "Europe",
    flagSrc: `assets/flags/c${number}.svg`,
    capital: `Capital ${number}`,
    capitalAliases: [],
  };
}) satisfies readonly RawCountry[];

describe("daily challenge", () => {
  it("selects the same ten countries for the same date", () => {
    const index = indexCountries(fixtureCountries);
    const first = createDailyChallenge(index, "2026-06-11");
    const second = createDailyChallenge(index, "2026-06-11");

    expect(first.seed).toBe("daily:2026-06-11");
    expect(first.categoryIds).toEqual(["flags", "shapes", "capitals", "pick-country", "spot-country"]);
    expect(first.countryIds).toHaveLength(10);
    expect(second.countryIds).toEqual(first.countryIds);
  });

  it("changes the selection when the date changes", () => {
    const index = indexCountries(fixtureCountries);
    const first = createDailyChallenge(index, "2026-06-11");
    const second = createDailyChallenge(index, "2026-06-12");

    expect(second.countryIds).not.toEqual(first.countryIds);
  });

  it("formats time and share text", () => {
    expect(formatDailyTime(134000)).toBe("02:14");
    expect(createDailyShareText("2026-06-11", 80, 134000, ["correct", "correct", "miss", "correct", "hint", "correct", "correct", "miss", "correct", "correct"])).toBe(`Locato Daily 2026-06-11
Score: 80/100
Time: 02:14
🟩🟩🟥🟩🟨🟩🟩🟥🟩🟩`);
  });

  it("scores each round with hint penalties and zero for revealed answers", () => {
    expect(scoreDailyRound(0)).toBe(10);
    expect(scoreDailyRound(1)).toBe(7);
    expect(scoreDailyRound(3)).toBe(1);
    expect(scoreDailyRound(2, true)).toBe(0);
  });
});
