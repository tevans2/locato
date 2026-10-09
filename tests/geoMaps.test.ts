import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GEO_GAME_MAPS, geoGameMap, locationInGeoMap } from "../src/core/geoguessr/maps";
import { GEO_WORLD_LOCATIONS } from "../src/core/geoguessr/locations";
import { sampleGeoLocations } from "../src/core/geoguessr";
import { streetViewCountryRounds } from "../src/core/streetview";
import { isValidLeaderboardVariant } from "../src/core/leaderboards";
import { CountrySampler } from "../server/streetview/CountrySampler";
import { StreetViewLocationPool } from "../server/streetview/StreetViewLocationPool";
import { RankedGames } from "../server/ranked/RankedGames";
import { rankedWorld } from "../server/ranked/assets";
import { stateOf, privateChallenge } from "./helpers/privateGame";
import { createSeededRandom } from "../src/core/game";
import type { WorldCountryFeature } from "../src/core/map";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function storage() { const directory = await mkdtemp(join(tmpdir(), "locato-geo-maps-")); directories.push(directory); return join(directory, "pool.json"); }
const rectangle = (code: string): WorldCountryFeature => ({ name: code, code, continent: "Europe", geometry: { type: "Polygon", coordinates: [[[0,0],[10,0],[10,10],[0,10],[0,0]], [[4,4],[6,4],[6,6],[4,6],[4,4]]] } });

describe("geographic map catalogue", () => {
  it("offers world, six regions and 24 countries with five unique in-map locations each", () => {
    expect(GEO_GAME_MAPS).toHaveLength(31);
    expect(GEO_WORLD_LOCATIONS.length).toBeGreaterThan(600);
    expect(new Set(GEO_WORLD_LOCATIONS.map(location => location.countryCode)).size).toBeGreaterThan(70);
    expect(new Set(GEO_GAME_MAPS.map(map => map.id)).size).toBe(GEO_GAME_MAPS.length);
    for (const map of GEO_GAME_MAPS) {
      const eligible = GEO_WORLD_LOCATIONS.filter(location => locationInGeoMap(location, map));
      const trip = sampleGeoLocations("map-trip", eligible);
      expect(trip, map.name).toHaveLength(5);
      expect(trip.every(location => locationInGeoMap(location, map))).toBe(true);
      expect(new Set(trip.map(location => `${location.lat},${location.lng}`)).size).toBe(5);
      expect(sampleGeoLocations("map-trip", eligible)).toEqual(trip);
      expect(isValidLeaderboardVariant("geoguessr", map.id)).toBe(true);
    }
    expect(geoGameMap("made-up")).toBeNull();
    expect(isValidLeaderboardVariant("geoguessr", "made-up")).toBe(false);
    // The separate country-guess mode retains its three-attempt rules.
    expect(streetViewCountryRounds.every(round => round.frames.length === 3)).toBe(true);
  });
  it("samples across available countries before repeating, and never repeats coordinates", () => {
    const country = GEO_WORLD_LOCATIONS.filter(location => location.countryCode === "FR");
    expect(sampleGeoLocations("france", [...country, ...country], 100)).toHaveLength(country.length);
    const world = sampleGeoLocations("world", GEO_WORLD_LOCATIONS);
    expect(new Set(world.map(location => location.countryCode)).size).toBe(5);
  });
});

describe("country-wide sampling", () => {
  it("excludes polygon holes and samples away from any fixed city anchors", () => {
    const sampler = new CountrySampler([rectangle("FR")]);
    expect(sampler.contains("FR", 5, 5)).toBe(false);
    expect(sampler.contains("FR", 1, 1)).toBe(true);
    expect(sampler.contains("FR", 15, 5)).toBe(false);
    const random = createSeededRandom("whole-country");
    const points = Array.from({ length: 100 }, () => sampler.sample("FR", random)!);
    expect(points.every(point => sampler.contains("FR", point.lat, point.lng))).toBe(true);
    expect(Math.max(...points.map(point => point.lng)) - Math.min(...points.map(point => point.lng))).toBeGreaterThan(8);
    expect(sampler.sample("missing")).toBeNull();
  });
  it("supports islands and polygons that cross the date line", () => {
    const feature: WorldCountryFeature = { name: "Islands", code: "XX", continent: "Oceania", geometry: { type: "MultiPolygon", coordinates: [[[[178,-2],[-178,-2],[-178,2],[178,2],[178,-2]]], [[[170,10],[171,10],[171,11],[170,11],[170,10]]]] } };
    const sampler = new CountrySampler([feature]);
    expect(sampler.contains("XX", 0, 179)).toBe(true);
    expect(sampler.contains("XX", 0, -179)).toBe(true);
    expect(sampler.contains("XX", 0, 0)).toBe(false);
    const random = createSeededRandom("islands");
    expect(Array.from({ length: 50 }, () => sampler.sample("XX", random)).every(point => point && sampler.contains("XX", point.lat, point.lng))).toBe(true);
  });
});

describe("practice and authoritative map pools", () => {
  it("uses generated coordinates as well as the expanded starter pool, filtered to the map", async () => {
    const path = await storage();
    const entry = { id: "generated", countryCode: "FR", lat: 47.5, lng: 2.5, heading: 20, pitch: 0, fov: 90, createdAt: new Date().toISOString(), source: "generated" };
    await writeFile(path, JSON.stringify({ version: 1, entries: [entry, { ...entry, id: "invalid", lat: 200 }], lastGeneratedAt: new Date().toISOString() }));
    const pool = new StreetViewLocationPool({ storagePath: path });
    const france = await pool.geoLocations("france");
    expect(france.every(location => location.countryCode === "FR")).toBe(true);
    expect(france).toContainEqual(expect.objectContaining({ lat: 47.5, lng: 2.5 }));
    expect(france.some(location => location.lat === 200)).toBe(false);
    expect((await pool.geoLocations()).length).toBeGreaterThan(GEO_WORLD_LOCATIONS.length);
    await expect(pool.geoLocations("nope")).rejects.toThrow("Unknown");
  });
  it("rejects metadata snapped across the requested country boundary", async () => {
    const path = await storage();
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ status: "OK", pano_id: "outside", location: { lat: 30, lng: 30 } })));
    vi.stubGlobal("fetch", fetcher);
    const pool = new StreetViewLocationPool({ storagePath: path, metadataApiKey: "test-key", world: [rectangle("AD")], dailyGenerateCount: 1 });
    pool.warm();
    await vi.waitFor(async () => expect((await pool.stats()).lastGeneratedAt).not.toBeNull());
    expect(fetcher).toHaveBeenCalled();
    expect((await pool.stats()).generatedEntries).toBe(0);
    expect(new URL(fetcher.mock.calls[0]![0] as unknown as string).searchParams.get("source")).toBe("outdoor");
  });
  it("stops probing on credential failure and respects the interval after an empty refresh", async () => {
    const path = await storage();
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ status: "REQUEST_DENIED" })));
    vi.stubGlobal("fetch", fetcher);
    const pool = new StreetViewLocationPool({ storagePath: path, metadataApiKey: "test-key", dailyGenerateCount: 100 });
    pool.warm();
    await vi.waitFor(async () => expect((await pool.stats()).lastGeneratedAt).not.toBeNull());
    const calls = fetcher.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(4);
    await pool.geoLocations();
    await pool.geoLocations("france");
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it("enforces selected maps on the server and keeps regional receipts off the World board", async () => {
    const games = new RankedGames({ world: rankedWorld(), geoLocations: async () => GEO_WORLD_LOCATIONS, resolvePanorama: async frame => ({ panoId: `test-${frame.lat}-${frame.lng}`, lat: frame.lat, lng: frame.lng }) });
    let state = stateOf(await games.start("player", { gameMode: "geoguessr", variant: "france" }));
    expect(state.variant).toBe("france");
    for (let round = 0; round < 5; round++) {
      const target = privateChallenge(games, state).geo!;
      expect(target.countryCode).toBe("FR");
      state = stateOf(await games.action("player", { runId: state.runId, questionId: state.question!.id, type: "pin", lat: target.lat, lng: target.lng }));
    }
    expect(state.status).toBe("complete");
    expect(state.score).toBe(25_000);
    expect(games.consume("player", state.runId, "geoguessr", "", 25_000)).toBeNull();
    expect(games.consume("player", state.runId, "geoguessr", "france", 25_000)).toMatchObject({ variant: "france", value: 25_000 });
    expect(await games.start("player", { gameMode: "geoguessr", variant: "nope" })).toHaveProperty("error");
  });
});
