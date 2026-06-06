import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { indexCountries, isCorrectAnswer, rawCountries, validateCountries } from "../src/core/countries";

const countryIndex = indexCountries(rawCountries);

describe("country dataset", () => {
  it("contains a valid playable country set", () => {
    const validation = validateCountries(countryIndex, { expectedCount: 196 });
    expect(validation.issues).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  it("points every country at an existing flag asset", () => {
    for (const country of countryIndex.countries) {
      expect(existsSync(resolve("public", country.flagSrc)), `${country.name} flag is missing`).toBe(true);
    }
  });

  it("matches names, aliases, and country codes without over-normalizing important words", () => {
    const unitedKingdom = countryIndex.byCode.get("GB");
    const unitedStates = countryIndex.byCode.get("US");
    const ivoryCoast = countryIndex.byCode.get("CI");

    expect(unitedKingdom).toBeDefined();
    expect(unitedStates).toBeDefined();
    expect(ivoryCoast).toBeDefined();

    expect(isCorrectAnswer(countryIndex, unitedKingdom!.id, "United Kingdom")).toBe(true);
    expect(isCorrectAnswer(countryIndex, unitedKingdom!.id, "UK")).toBe(true);
    expect(isCorrectAnswer(countryIndex, unitedStates!.id, "USA")).toBe(true);
    expect(isCorrectAnswer(countryIndex, ivoryCoast!.id, "Cote d Ivoire")).toBe(true);
    expect(isCorrectAnswer(countryIndex, unitedKingdom!.id, "U.K.")).toBe(true);
    expect(isCorrectAnswer(countryIndex, unitedStates!.id, "U.S.A.")).toBe(true);
    expect(isCorrectAnswer(countryIndex, unitedStates!.id, "Untied States")).toBe(true);
    expect(isCorrectAnswer(countryIndex, ivoryCoast!.id, "Ivory Cost")).toBe(true);
  });
});
