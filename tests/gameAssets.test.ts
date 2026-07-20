import { describe, expect, it, vi } from "vitest";
import { shapesCategory } from "../src/core/categories";
import { indexCountries, rawCountries } from "../src/core/countries";
import { loadWorldCountryFeatures } from "../src/core/map";
import { fetchMapTapRound, validateMapTapGuess } from "../src/core/maptap";

describe("game asset routing", () => {
  it("uses origin-rooted flag and outline URLs on deep game routes", () => {
    const country = indexCountries(rawCountries).byCode.get("ZA")!;
    expect(country.flagSrc).toBe("/assets/flags/za.svg");
    expect(shapesCategory.prompt(country).value).toBe("/assets/country-shapes/za.svg");
  });

  it("loads world map data from the origin instead of the current route", async () => {
    const fetcher = vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
    await expect(loadWorldCountryFeatures(fetcher as typeof fetch)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith("/assets/world-map.json");
  });
});

describe("MapTap local fallback", () => {
  it("provides a playable round when the API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network unavailable");
    }));
    await expect(fetchMapTapRound({ category: "city", difficulty: "easy" })).resolves.toMatchObject({
      category: "city",
      difficulty: "easy",
    });
    vi.unstubAllGlobals();
  });

  it("scores a valid guess locally when the API returns the app shell", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })));
    const result = await validateMapTapGuess({ targetId: "cape-town", guessLat: -33.9249, guessLng: 18.4241 });
    expect(result).toMatchObject({ score: 5000, distanceKm: 0, target: { id: "cape-town" } });
    vi.unstubAllGlobals();
  });
});
