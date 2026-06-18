import { describe, expect, it } from "vitest";
import { haversineDistanceKm, MAP_TAP_DEFAULT_DECAY_KM, MAP_TAP_MAX_SCORE, scoreMapTapDistance } from "../src/core/maptap";

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
