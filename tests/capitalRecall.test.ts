import { describe, expect, it } from "vitest";
import { matchFreestyleCapital } from "../src/core/capitalRecall";
import { indexCountries, type RawCountry } from "../src/core/countries";

const countries = indexCountries([
  { name: "Japan", code: "JP", aliases: [], continent: "Asia", flagSrc: "jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Brazil", code: "BR", aliases: [], continent: "South America", flagSrc: "br.svg", capital: "Brasília", capitalAliases: ["Brasilia"] },
  { name: "Canada", code: "CA", aliases: [], continent: "North America", flagSrc: "ca.svg", capital: "Ottawa", capitalAliases: [] },
] as const satisfies readonly RawCountry[]);

describe("freestyle capital recall", () => {
  it("matches a capital without requiring its country prompt", () => {
    const result = matchFreestyleCapital(countries, "Tokyo", new Set(), true);

    expect(result.newCountries.map((country) => country.code)).toEqual(["JP"]);
    expect(result.alreadySolvedCountries).toEqual([]);
  });

  it("accepts capital aliases and submitted misspellings", () => {
    expect(matchFreestyleCapital(countries, "Brasilia", new Set(), true).newCountries[0]?.code).toBe("BR");
    expect(matchFreestyleCapital(countries, "Otawa", new Set(), false).newCountries[0]?.code).toBe("CA");
  });

  it("reports an already solved capital without counting it again", () => {
    const japan = countries.byCode.get("JP")!;
    const result = matchFreestyleCapital(countries, "Tokyo", new Set([japan.id]));

    expect(result.newCountries).toEqual([]);
    expect(result.alreadySolvedCountries.map((country) => country.code)).toEqual(["JP"]);
  });

  it("does not fuzzy-match incomplete auto-submit input", () => {
    expect(matchFreestyleCapital(countries, "Toky", new Set(), true).matchedCountries).toEqual([]);
  });
});
