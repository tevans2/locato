import { describe, expect, it } from "vitest";
import { rawCountries } from "../src/core/countries/countries";
import { indexCountries } from "../src/core/countries/indexCountries";
import { fameTier } from "../src/core/countries/fame";
import { createFameRampQueue } from "../src/core/game/fameRamp";

describe("fame ramp queue", () => {
  const index = indexCountries(rawCountries);
  const allIds = index.countries.map((country) => country.id);

  it("classifies famous countries into tier 1", () => {
    expect(fameTier("US")).toBe(1);
    expect(fameTier("JP")).toBe(1);
    expect(fameTier("FR")).toBe(1);
  });

  it("falls back to tier 3 for unranked codes", () => {
    expect(fameTier("TV")).toBe(3);
    expect(fameTier("XX")).toBe(3);
  });

  it("front-loads tier 1 countries and keeps every country exactly once", () => {
    const queue = createFameRampQueue(allIds, index, "seed-1");
    expect(queue.remainingCountryIds.length).toBe(allIds.length);
    expect(new Set(queue.remainingCountryIds).size).toBe(allIds.length);

    const firstTwenty = queue.remainingCountryIds.slice(0, 20).map((id) => index.byId[id]?.code ?? "");
    for (const code of firstTwenty) expect(fameTier(code)).toBe(1);

    // Tier 2 must start before any tier 3 country appears.
    const firstTier3 = queue.remainingCountryIds.findIndex((id) => fameTier(index.byId[id]?.code ?? "") === 3);
    const lastTier1 = queue.remainingCountryIds.reduce((last, id, position) => (fameTier(index.byId[id]?.code ?? "") === 1 ? position : last), -1);
    const lastTier2 = queue.remainingCountryIds.reduce((last, id, position) => (fameTier(index.byId[id]?.code ?? "") === 2 ? position : last), -1);
    expect(lastTier1).toBeLessThan(firstTier3);
    expect(lastTier2).toBeLessThan(firstTier3);
  });

  it("is deterministic per seed", () => {
    const a = createFameRampQueue(allIds, index, "seed-x");
    const b = createFameRampQueue(allIds, index, "seed-x");
    expect(a.remainingCountryIds).toEqual(b.remainingCountryIds);
  });
});
