import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rawCountries } from "../src/core/countries";
import { GENERATED_COUNTRY_PROFILES } from "../src/core/countries/profiles.data";
import { CURATED_COUNTRY_PROFILES } from "../src/core/countries/profiles.curated";
import {
  allCountryProfiles,
  areaRank,
  formatArea,
  formatOrdinal,
  formatPopulation,
  getCountryProfile,
  neighboursOf,
  populationRank,
} from "../src/core/countries/profiles";

const codes = rawCountries.map((c) => c.code);
const codeSet = new Set<string>(codes);

/** Every string reachable inside a value, with its path. */
function strings(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`));
  return [];
}

describe("country profiles data", () => {
  it("has generated and curated entries for exactly the 196 playable countries", () => {
    expect(codes).toHaveLength(196);
    expect(Object.keys(GENERATED_COUNTRY_PROFILES).sort()).toEqual([...codes].sort());
    expect(Object.keys(CURATED_COUNTRY_PROFILES).sort()).toEqual([...codes].sort());
    for (const code of codes) expect(GENERATED_COUNTRY_PROFILES[code]!.code).toBe(code);
  });

  it("only references known codes in borders, and borders are symmetric", () => {
    const asymmetric: string[] = [];
    for (const code of codes) {
      const { borders } = GENERATED_COUNTRY_PROFILES[code]!;
      expect(new Set(borders).size, `${code} has duplicate borders`).toBe(borders.length);
      for (const other of borders) {
        expect(codeSet.has(other), `${code} borders unknown code ${other}`).toBe(true);
        expect(other).not.toBe(code);
        if (!GENERATED_COUNTRY_PROFILES[other]!.borders.includes(code)) asymmetric.push(`${code}->${other}`);
      }
    }
    expect(asymmetric).toEqual([]);
  });

  it("has sane generated values", () => {
    for (const code of codes) {
      const p = GENERATED_COUNTRY_PROFILES[code]!;
      expect(p.areaKm2, code).toBeGreaterThan(0);
      expect(p.latlng, code).toHaveLength(2);
      expect(p.capitalLatLng, code).not.toBeNull();
      expect(p.languages.length, code).toBeGreaterThan(0);
      expect(p.currencies.length, code).toBeGreaterThan(0);
      expect(p.nativeNames.length, code).toBeGreaterThan(0);
      expect(p.nativeNames.length, code).toBeLessThanOrEqual(2);
      expect(p.callingCode, code).toMatch(/^\+\d{1,4}$/);
      if (p.landlocked) expect(p.borders.length, `${code} is landlocked but has no borders`).toBeGreaterThan(0);
    }
  });

  it("has complete curated content", () => {
    for (const code of codes) {
      const c = CURATED_COUNTRY_PROFILES[code]!;
      expect(["left", "right"], code).toContain(c.drivingSide);
      expect(c.funFacts.length, `${code} funFacts`).toBeGreaterThanOrEqual(2);
      expect(c.funFacts.length, `${code} funFacts`).toBeLessThanOrEqual(3);
      expect(c.landmarks.length, `${code} landmarks`).toBeGreaterThanOrEqual(1);
      expect(c.landmarks.length, `${code} landmarks`).toBeLessThanOrEqual(3);
      expect(new Set(c.funFacts).size, `${code} duplicate fun facts`).toBe(c.funFacts.length);
      if (c.highestPoint) {
        expect(c.highestPoint.metres, code).toBeGreaterThan(0);
        expect(c.highestPoint.metres, code).toBeLessThanOrEqual(8849);
      }
    }
  });

  it("has no empty or padded strings anywhere", () => {
    const bad: string[] = [];
    for (const code of codes) {
      for (const [path, s] of [
        ...strings(GENERATED_COUNTRY_PROFILES[code], `generated.${code}`),
        ...strings(CURATED_COUNTRY_PROFILES[code], `curated.${code}`),
      ]) {
        if (s.trim() === "" || s !== s.trim()) bad.push(path);
      }
    }
    expect(bad).toEqual([]);
  });

  it("gets well-known driving sides right", () => {
    const left = ["GB", "IE", "JP", "IN", "AU", "NZ", "ZA", "KE", "TH", "ID", "JM", "BB", "TT", "GY", "SR", "MT", "CY", "SG", "WS"];
    const right = ["US", "FR", "DE", "CN", "BR", "RU", "SE", "MM", "RW", "SA", "CA"];
    for (const code of left) expect(CURATED_COUNTRY_PROFILES[code]!.drivingSide, code).toBe("left");
    for (const code of right) expect(CURATED_COUNTRY_PROFILES[code]!.drivingSide, code).toBe("right");
  });
});

describe("country profile API", () => {
  it("merges generated, curated, population, fame and capital", () => {
    const za = getCountryProfile("za")!;
    expect(za.name).toBe("South Africa");
    expect(za.capital).toBe("Pretoria");
    expect(za.capitals).toContain("Cape Town");
    expect(za.drivingSide).toBe("left");
    expect(za.populationMillions).toBeGreaterThan(50);
    expect(za.fameTier).toBe(1);
    expect(za.shapeSrc).toBe("assets/country-shapes/za.svg");
    expect(getCountryProfile("XX")).toBeNull();
    expect(allCountryProfiles()).toHaveLength(196);
  });

  it("ranks by population and area", () => {
    expect(populationRank("IN")).toBe(1);
    expect(populationRank("CN")).toBe(2);
    expect(areaRank("RU")).toBe(1);
    expect(areaRank("VA")).toBe(196);
    const popRanks = allCountryProfiles().map((p) => p.populationRank);
    expect(popRanks.every((r) => r !== null && r >= 1 && r <= 196)).toBe(true);
  });

  it("lists neighbours", () => {
    expect(neighboursOf("LS").map((p) => p.code)).toEqual(["ZA"]);
    expect(neighboursOf("FR").map((p) => p.code)).toContain("ES");
    expect(neighboursOf("JP")).toEqual([]);
  });

  it("formats numbers", () => {
    expect(formatPopulation(1450)).toBe("1.45 billion");
    expect(formatPopulation(59)).toBe("59 million");
    expect(formatPopulation(2.8)).toBe("2.8 million");
    expect(formatPopulation(0.039)).toBe("39,000");
    expect(formatPopulation(null)).toBe("Unknown");
    expect(formatArea(1221037)).toBe("1,221,037 km²");
    expect(formatArea(0.44)).toBe("0.44 km²");
    expect(formatOrdinal(1)).toBe("1st");
    expect(formatOrdinal(12)).toBe("12th");
    expect(formatOrdinal(23)).toBe("23rd");
    expect(formatOrdinal(111)).toBe("111th");
  });

  it("is not exported from the countries barrel (keeps it out of the main bundle)", () => {
    const barrel = readFileSync(resolve("src/core/countries/index.ts"), "utf8");
    expect(barrel).not.toMatch(/profiles/);
  });
});
