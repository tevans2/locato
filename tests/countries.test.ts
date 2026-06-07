import { existsSync, readFileSync } from "node:fs";
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

  it("points every country at existing prompt image assets", () => {
    for (const country of countryIndex.countries) {
      expect(existsSync(resolve("public", country.flagSrc)), `${country.name} flag is missing`).toBe(true);
      const outlinePath = resolve("public", "assets", "country-shapes", `${country.code.toLowerCase()}.svg`);
      expect(existsSync(outlinePath), `${country.name} outline is missing`).toBe(true);
      const outline = readFileSync(outlinePath, "utf8");
      const pathFills = [...outline.matchAll(/<path\b[^>]*\bfill="([^"]+)"/g)].map((match) => match[1]);
      expect(pathFills.length, `${country.name} outline should include at least one country path`).toBeGreaterThan(0);
      expect(pathFills.every((fill) => fill === "white"), `${country.name} outline paths should render as white`).toBe(true);
      if (country.code === "SI") expect(outline, "Slovenia outline should keep provider marker circles").toContain("<circle");
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
