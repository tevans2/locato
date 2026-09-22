import { describe, expect, it } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { createGeoGuessrQueue, GEOGUESSR_MAX_ROUND_SCORE, scoreGeoGuessrDistance } from "../src/core/geoguessr";
import { GeoGuessrRoom } from "../server/rooms/GeoGuessrRoom";

describe("GeoGuessr scoring and rounds", () => {
  it("awards 5,000 for a precise pin and decreases with distance", () => {
    expect(scoreGeoGuessrDistance(0)).toBe(GEOGUESSR_MAX_ROUND_SCORE);
    expect(scoreGeoGuessrDistance(0.02)).toBe(GEOGUESSR_MAX_ROUND_SCORE);
    expect(scoreGeoGuessrDistance(100)).toBeGreaterThan(scoreGeoGuessrDistance(1000));
    expect(scoreGeoGuessrDistance(1000)).toBeGreaterThan(scoreGeoGuessrDistance(10_000));
    expect(scoreGeoGuessrDistance(Number.NaN)).toBe(0);
  });

  it("builds a seeded five-round trip without repeating countries", () => {
    const first = createGeoGuessrQueue("world-trip", 5);
    const second = createGeoGuessrQueue("world-trip", 5);

    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
    expect(new Set(first.map((location) => location.countryCode)).size).toBe(5);
  });
});

describe("GeoGuessr multiplayer room", () => {
  it("waits for every connected player, then reveals distance-scored results", () => {
    const room = new GeoGuessrRoom({
      code: "GEO42",
      hostPlayerId: "host",
      hostName: "Host",
      countryIndex: indexCountries(rawCountries),
      seed: "shared-trip",
      now: 1000,
      roundLimit: 3,
      roundDurationMs: 60_000,
      resultDisplayMs: 1000,
    });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.setReady("guest", true, 1020).ok).toBe(true);
    const started = room.startGame("host", 1030);
    expect(started.ok).toBe(true);
    const round = started.ok ? started.messages.find((message) => message.type === "GAME_STARTED")?.round : null;
    expect(round?.prompt.kind).toBe("geoguessr-streetview");
    const target = JSON.parse(round?.prompt.value ?? "{}") as { lat: number; lng: number };

    const firstGuess = room.submitGuess("host", target.lat, target.lng, 1040);
    expect(firstGuess.ok).toBe(true);
    expect(room.snapshot().status).toBe("playing");

    const secondGuess = room.submitGuess("guest", target.lat + 5, target.lng + 5, 1050);
    expect(secondGuess.ok).toBe(true);
    const reveal = secondGuess.ok ? secondGuess.messages.find((message) => message.type === "GEOGUESSR_ROUND_ENDED") : null;
    expect(reveal?.type).toBe("GEOGUESSR_ROUND_ENDED");
    if (reveal?.type !== "GEOGUESSR_ROUND_ENDED") throw new Error("Expected a GeoGuessr reveal.");
    expect(reveal.results[0]?.playerId).toBe("host");
    expect(reveal.results[0]?.score).toBe(GEOGUESSR_MAX_ROUND_SCORE);
    expect(reveal.results[1]?.distanceKm).toBeGreaterThan(0);
    expect(room.snapshot().status).toBe("round-result");
  });
});
