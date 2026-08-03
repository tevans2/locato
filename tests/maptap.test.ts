import { describe, expect, it } from "vitest";
import { filterMapTapLocations, haversineDistanceKm, isMapTapCategory, MAP_TAP_DEFAULT_DECAY_KM, MAP_TAP_LOCATIONS, MAP_TAP_MAX_SCORE, scoreMapTapDistance, type MapTapCategory } from "../src/core/maptap";

describe("MapTap distance and scoring", () => {
  it("returns zero distance for the same coordinate", () => {
    expect(haversineDistanceKm({ lat: -3.0674, lng: 37.3556 }, { lat: -3.0674, lng: 37.3556 })).toBeCloseTo(0, 6);
  });

  it("scores a perfect guess at max score", () => {
    expect(scoreMapTapDistance(0)).toBe(MAP_TAP_MAX_SCORE);
  });

  it("uses exponential decay", () => {
    expect(scoreMapTapDistance(MAP_TAP_DEFAULT_DECAY_KM)).toBe(Math.round(MAP_TAP_MAX_SCORE * Math.exp(-1)));
  });

  it("handles antimeridian distance using the shortest path", () => {
    const distance = haversineDistanceKm({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 });
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });
});

describe("MapTap location pool", () => {
  const categories: readonly MapTapCategory[] = ["city", "region", "mountain", "mountain-range", "ocean", "poi", "landmark"];

  it("offers a large pool with every selectable category represented", () => {
    expect(MAP_TAP_LOCATIONS.length).toBeGreaterThanOrEqual(130);
    for (const category of categories) {
      expect(isMapTapCategory(category)).toBe(true);
      expect(filterMapTapLocations({ category }).length).toBeGreaterThan(0);
    }
  });

  it("uses unique ids and valid globe coordinates", () => {
    expect(new Set(MAP_TAP_LOCATIONS.map((location) => location.id)).size).toBe(MAP_TAP_LOCATIONS.length);
    for (const location of MAP_TAP_LOCATIONS) {
      expect(location.lat).toBeGreaterThanOrEqual(-90);
      expect(location.lat).toBeLessThanOrEqual(90);
      expect(location.lng).toBeGreaterThanOrEqual(-180);
      expect(location.lng).toBeLessThanOrEqual(180);
    }
  });

  it("combines category and difficulty filters", () => {
    const hardOceans = filterMapTapLocations({ category: "ocean", difficulty: "hard" });
    expect(hardOceans.length).toBeGreaterThan(0);
    expect(hardOceans.every((location) => location.category === "ocean" && location.difficulty === "hard")).toBe(true);
  });
});
