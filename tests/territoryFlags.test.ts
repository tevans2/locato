import { describe, expect, it } from "vitest";
import { buildPromptSlots } from "../src/core/categories";
import { indexCountries, rawCountries } from "../src/core/countries";
import { createPromptCountryIndex } from "../src/core/flagPools";
import { territoryFlags } from "../src/core/territoryFlags";

describe("territory flag reference", () => {
  it("keeps a unique local SVG path for every territory entry", () => {
    expect(territoryFlags).toHaveLength(57);
    expect(new Set(territoryFlags.map((flag) => flag.code)).size).toBe(territoryFlags.length);
    expect(new Set(territoryFlags.map((flag) => flag.flagSrc)).size).toBe(territoryFlags.length);
    expect(territoryFlags.every((flag) => flag.flagSrc.startsWith("assets/flags/territories/") && flag.flagSrc.endsWith(".svg"))).toBe(true);
  });

  it("contains the split Caribbean Netherlands and Saint Helena group flags", () => {
    expect(territoryFlags.map((flag) => flag.code)).toEqual(expect.arrayContaining(["BQ-BO", "BQ-SA", "BQ-SE", "AC", "SH", "TA"]));
  });
});


describe("flag prompt pools", () => {
  const countryIndex = indexCountries(rawCountries);

  it("builds territory-only and combined flag decks", () => {
    const territories = createPromptCountryIndex(countryIndex, ["flags"], "territories");
    const both = createPromptCountryIndex(countryIndex, ["flags"], "both");

    expect(territories.countries).toHaveLength(territoryFlags.length);
    expect(territories.countries.every((country) => country.allowedCategoryIds?.includes("flags"))).toBe(true);
    expect(both.countries).toHaveLength(countryIndex.countries.length + territoryFlags.length);
    expect(new Set(both.countries.map((country) => country.code)).size).toBe(both.countries.length);
  });

  it("keeps territories out of non-flag rounds in a mixed multiplayer rotation", () => {
    const mixedIndex = createPromptCountryIndex(countryIndex, ["flags", "capitals"], "territories");
    const slots = buildPromptSlots(mixedIndex, ["flags", "capitals"], "mixed-territories");
    const territoryPaths = new Set(territoryFlags.map((flag) => flag.flagSrc));

    const territorySlots = slots.filter((slot) => territoryPaths.has(mixedIndex.byId[slot.countryId]!.flagSrc));
    expect(territorySlots.length).toBe(territoryFlags.length);
    expect(territorySlots.every((slot) => slot.categoryId === "flags")).toBe(true);
    expect(slots.some((slot) => slot.categoryId === "capitals")).toBe(true);
  });
});
