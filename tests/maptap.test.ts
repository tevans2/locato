import { describe, expect, it } from "vitest";
import { haversineDistanceKm, MAP_TAP_DEFAULT_DECAY_KM, MAP_TAP_DEFAULT_TOLERANCE_KM, MAP_TAP_MAX_SCORE, scoreMapTapDistance, scoreMapTapGuess } from "../src/core/maptap";

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

  it("awards full marks inside a location's tolerance zone", () => {
    // ~110 km east of the target, inside a 150 km zone.
    const scored = scoreMapTapGuess({ lat: -3.0674, lng: 38.5 }, { lat: -3.0674, lng: 37.3556, toleranceKm: 150 });
    expect(scored.score).toBe(MAP_TAP_MAX_SCORE);
    expect(scored.toleranceKm).toBe(150);
  });

  it("decays only on distance beyond the tolerance zone", () => {
    const withZone = scoreMapTapGuess({ lat: -3.0674, lng: 37.9 }, { lat: -3.0674, lng: 37.3556, toleranceKm: 100 });
    // ~60 km out, all inside the zone.
    expect(withZone.score).toBe(MAP_TAP_MAX_SCORE);
    // Score decays on the kilometres past the zone, not the whole distance.
    const far = scoreMapTapGuess({ lat: -3.0674, lng: 47.0 }, { lat: -3.0674, lng: 37.3556, toleranceKm: 100 });
    expect(far.distanceKm).toBeGreaterThan(100);
    expect(far.score).toBe(Math.round(MAP_TAP_MAX_SCORE * Math.exp(-(far.distanceKm - 100) / MAP_TAP_DEFAULT_DECAY_KM)));
  });

  it("scores sprawling targets against their nearest anchor", () => {
    // Guess near the north anchor of a range whose center is thousands of km away.
    const scored = scoreMapTapGuess(
      { lat: 4.6, lng: -74.1 },
      { lat: -32.6532, lng: -70.0112, toleranceKm: 900, anchors: [{ lat: 4.5, lng: -73.5 }] },
    );
    expect(scored.distanceKm).toBeLessThan(100);
    expect(scored.score).toBe(MAP_TAP_MAX_SCORE);
  });

  it("applies a small default tolerance to pinpoint targets", () => {
    const scored = scoreMapTapGuess({ lat: 55.7525 + 0.2, lng: 37.6231 }, { lat: 55.7525, lng: 37.6231 });
    expect(scored.toleranceKm).toBe(MAP_TAP_DEFAULT_TOLERANCE_KM);
    expect(scored.score).toBe(MAP_TAP_MAX_SCORE);
  });
});
