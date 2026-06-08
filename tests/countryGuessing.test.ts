import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { detectCountryGuess, submitCountryGuess, type WorldCountryFeature } from "../src/core/map";

const countryIndex = indexCountries(rawCountries);
const worldCountryFeatures = JSON.parse(readFileSync(resolve("public", "assets", "world-map.json"), "utf8")) as readonly WorldCountryFeature[];

describe("country guessing mode", () => {
  it("detects normalized country names and aliases", () => {
    const guessedCountryIds = new Set<number>();

    expect(detectCountryGuess(countryIndex, "  cote d ivoire  ", guessedCountryIds)?.code).toBe("CI");
    expect(detectCountryGuess(countryIndex, "USA", guessedCountryIds)?.code).toBe("US");
    expect(detectCountryGuess(countryIndex, "South Korea", guessedCountryIds)?.code).toBe("KR");
  });

  it("does not auto-detect two-letter codes while the user is typing", () => {
    expect(detectCountryGuess(countryIndex, "US", new Set())?.code).toBeUndefined();
    expect(detectCountryGuess(countryIndex, "ZA", new Set())?.code).toBeUndefined();
  });

  it("accepts country codes when the user locks in the guess", () => {
    expect(submitCountryGuess(countryIndex, "US", new Set())?.code).toBe("US");
    expect(submitCountryGuess(countryIndex, "za", new Set())?.code).toBe("ZA");
    expect(submitCountryGuess(countryIndex, "U.S.", new Set())?.code).toBe("US");
  });

  it("does not detect an already-highlighted country again", () => {
    const brazil = countryIndex.byCode.get("BR");
    expect(brazil).toBeDefined();

    expect(detectCountryGuess(countryIndex, "Brazil", new Set([brazil!.id]))).toBeNull();
  });

  it("has map outlines for every playable country", () => {
    const featureCodes = new Set(worldCountryFeatures.map((feature) => feature.code.toUpperCase()));

    for (const country of countryIndex.countries) {
      expect(featureCodes.has(country.code), `${country.name} is missing from the world map`).toBe(true);
    }
  });
});
