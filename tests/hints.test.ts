import { describe, expect, it } from "vitest";
import { indexCountries, type RawCountry } from "../src/core/countries";
import { createHint, isIslandPool, TOTAL_HINTS } from "../src/core/game/hints";

const fixtureCountries = [
  { name: "Brazil", code: "BR", aliases: [], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: [] },
  { name: "Canada", code: "CA", aliases: [], continent: "North America", flagSrc: "assets/flags/ca.svg", capital: "Ottawa", capitalAliases: [] },
  { name: "Japan", code: "JP", aliases: ["Nippon"], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Iceland", code: "IS", aliases: [], continent: "Europe", flagSrc: "assets/flags/is.svg", capital: "Reykjavík", capitalAliases: [] },
  { name: "Fiji", code: "FJ", aliases: [], continent: "Oceania", flagSrc: "assets/flags/fj.svg", capital: "Suva", capitalAliases: [] },
] as const satisfies readonly RawCountry[];

const index = indexCountries(fixtureCountries);
const country = (code: string) => {
  const found = Object.values(index.byId).find((entry) => entry.code === code);
  if (!found) throw new Error(`Missing fixture country ${code}`);
  return found;
};

function hintLadder(code: string, categoryId: string, islandPool = false) {
  const target = country(code);
  return Array.from({ length: TOTAL_HINTS }, (_, level) => createHint(target, level, categoryId, { islandPool }));
}

describe("mode-aware hints", () => {
  it("climbs region → borders → name shape for name-the-country modes", () => {
    for (const categoryId of ["flags", "flag-colors", "shapes", "capitals", "codes"]) {
      const ladder = hintLadder("BR", categoryId);
      expect(ladder[0]!.title).toBe("Where in the world");
      expect(ladder[0]!.message).toContain("South America");
      expect(ladder[1]!.title).toBe("Land borders");
      expect(ladder[2]!.title).toBe("Name shape");
      expect(ladder[2]!.message).toContain("Starts with “B”");
    }
  });

  it("never leaks the answer name", () => {
    for (const categoryId of ["flags", "flag-colors", "shapes", "codes", "capitals", "capital-recall"]) {
      for (const hint of hintLadder("BR", categoryId)) {
        expect(hint.message).not.toContain("Brazil");
      }
    }
  });

  it("never hints about ISO-code letters, even in the codes mode", () => {
    for (const hint of hintLadder("BR", "codes")) {
      expect(hint.message).not.toMatch(/ISO|code letter/i);
    }
  });

  it("uses population instead of border clues in island-dominated pools", () => {
    const islandIds = [country("JP").id, country("IS").id, country("FJ").id];
    expect(isIslandPool(islandIds, index)).toBe(true);

    const ladder = hintLadder("JP", "flags", true);
    expect(ladder[1]!.title).toBe("Population");
    expect(ladder[1]!.message).not.toMatch(/land border/i);
  });

  it("keeps border clues for mixed pools", () => {
    const mixedIds = [country("BR").id, country("CA").id, country("JP").id];
    expect(isIslandPool(mixedIds, index)).toBe(false);
    expect(hintLadder("JP", "flags")[1]!.title).toBe("Land borders");
  });

  it("rejects empty pools as island pools", () => {
    expect(isIslandPool([], index)).toBe(false);
  });

  it("hints the capital's name in capital-recall, not the country the player can see", () => {
    const ladder = hintLadder("JP", "capital-recall");
    expect(ladder[0]!.title).toBe("Capital size");
    expect(ladder[0]!.message).toContain("5 letters");
    expect(ladder[0]!.message).not.toContain("Asia");
    expect(ladder[1]!.title).toBe("Capital shape");
    expect(ladder[1]!.message).toContain("Starts with “T”");
    expect(ladder[2]!.title).toBe("Capital trace");
  });

  it("clamps out-of-range hint levels", () => {
    const target = country("BR");
    expect(createHint(target, -1, "flags").level).toBe(0);
    expect(createHint(target, 99, "flags").level).toBe(TOTAL_HINTS - 1);
  });
});
