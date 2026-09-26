import { describe, expect, it } from "vitest";
import { CONTINENTS, indexCountries, rawCountries } from "../src/core/countries";
import { ACADEMY_COUNTRY_CODES, LEARNING_GROUPS, LOOKALIKES, findGroup, groupForCountry, groupsForContinent, lookalikesFor } from "../src/core/academy";

const index = indexCountries(rawCountries);

describe("learning groups", () => {
  it("cover every main country exactly once", () => {
    expect(rawCountries).toHaveLength(196);
    expect(ACADEMY_COUNTRY_CODES).toHaveLength(196);
    expect(new Set(ACADEMY_COUNTRY_CODES).size).toBe(196);
    for (const country of index.countries) expect(groupForCountry(country.code), country.code).toBeDefined();
  });

  it("keep groups small, on one continent, with unique ids and orders", () => {
    for (const group of LEARNING_GROUPS) {
      expect(group.countryCodes.length, group.id).toBeGreaterThanOrEqual(4);
      expect(group.countryCodes.length, group.id).toBeLessThanOrEqual(9);
      for (const code of group.countryCodes) expect(index.byCode.get(code)?.continent, `${group.id}:${code}`).toBe(group.continent);
      expect(group.blurb.length).toBeGreaterThan(0);
    }
    expect(new Set(LEARNING_GROUPS.map((group) => group.id)).size).toBe(LEARNING_GROUPS.length);
    expect(LEARNING_GROUPS.map((group) => group.order)).toEqual(LEARNING_GROUPS.map((_, position) => position));
  });

  it("offers an easy starter path and a group per continent", () => {
    const first = LEARNING_GROUPS.slice(0, 5);
    expect(first.every((group) => group.difficulty === 1)).toBe(true);
    for (const continent of CONTINENTS) expect(groupsForContinent(continent).length).toBeGreaterThan(0);
    expect(findGroup("the-stans")?.countryCodes).toContain("UZ");
    expect(findGroup("nope")).toBeUndefined();
    expect(groupForCountry("fr")?.id).toBe("europe-big-names");
  });
});

describe("lookalikes", () => {
  it("only reference real countries and have tips", () => {
    expect(LOOKALIKES.length).toBeGreaterThanOrEqual(25);
    for (const set of LOOKALIKES) {
      expect(set.codes.length).toBeGreaterThanOrEqual(2);
      expect(new Set(set.codes).size).toBe(set.codes.length);
      for (const code of set.codes) expect(index.byCode.has(code), code).toBe(true);
      expect(set.tip.length).toBeGreaterThan(10);
    }
  });

  it("finds sets by country and skill", () => {
    expect(lookalikesFor("TD", "flag")[0]?.codes).toContain("RO");
    expect(lookalikesFor("SK", "capital")[0]?.codes).toContain("SI");
    expect(lookalikesFor("SK").length).toBeGreaterThanOrEqual(3);
    expect(lookalikesFor("TD", "capital")).toEqual([]);
  });
});
