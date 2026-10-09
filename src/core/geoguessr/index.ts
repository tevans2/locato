import { GEO_WORLD_LOCATIONS } from "./locations";
import { createSeededRandom, shuffle } from "../game";
import { haversineDistanceKm, normalizeLongitude, type LngLatPoint } from "../maptap/distance";
import { streetViewCountryRounds, type StreetViewCountryRound, type StreetViewFrame } from "../streetview";

export const GEOGUESSR_ROUND_LIMIT = 5;
export const GEOGUESSR_MAX_ROUND_SCORE = 5000;
export const GEOGUESSR_MAX_GAME_SCORE = GEOGUESSR_ROUND_LIMIT * GEOGUESSR_MAX_ROUND_SCORE;
export const GEOGUESSR_SCORE_DECAY_KM = 2000;

export interface GeoGuessrLocation extends StreetViewFrame {
  readonly countryCode: string;
}

/** A real panorama reference; Google supplies its scoring coordinates at play time. */
export type GeoPanoramaReference = Omit<GeoGuessrLocation, "lat" | "lng"> & {
  readonly panoId: string;
  readonly lat?: undefined;
  readonly lng?: undefined;
};
export type GeoGuessrCandidate = GeoGuessrLocation | GeoPanoramaReference;
export function hasGeoCoordinates(location: GeoGuessrCandidate): location is GeoGuessrLocation {
  return typeof location.lat === "number" && Number.isFinite(location.lat) && typeof location.lng === "number" && Number.isFinite(location.lng);
}
export function geoLocationKey(location: GeoGuessrCandidate): string {
  return location.panoId ? `pano:${location.panoId}` : `${location.countryCode}:${location.lat!.toFixed(5)}:${location.lng!.toFixed(5)}`;
}

export interface GeoGuessrGuessResult {
  readonly guess: LngLatPoint;
  readonly target: GeoGuessrLocation;
  readonly distanceKm: number;
  readonly score: number;
}

export function scoreGeoGuessrDistance(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  if (distanceKm <= 0.025) return GEOGUESSR_MAX_ROUND_SCORE;
  return Math.max(0, Math.min(GEOGUESSR_MAX_ROUND_SCORE, Math.round(GEOGUESSR_MAX_ROUND_SCORE * Math.exp(-distanceKm / GEOGUESSR_SCORE_DECAY_KM))));
}

export function scoreGeoGuessrGuess(guess: LngLatPoint, target: GeoGuessrLocation): GeoGuessrGuessResult {
  const normalizedGuess = { lat: guess.lat, lng: normalizeLongitude(guess.lng) };
  const distanceKm = haversineDistanceKm(normalizedGuess, target);
  return {
    guess: normalizedGuess,
    target,
    distanceKm,
    score: scoreGeoGuessrDistance(distanceKm),
  };
}

export function geoGuessrLocations(rounds: readonly StreetViewCountryRound[] = streetViewCountryRounds): readonly GeoGuessrLocation[] {
  return rounds.flatMap((round) => round.frames.map((frame) => ({ ...frame, countryCode: round.countryCode })));
}

/** Country-balanced selection, with unique locations even on single-country maps. */
export function sampleGeoLocations<T extends GeoGuessrCandidate>(seed: string, locations: readonly T[], count = GEOGUESSR_ROUND_LIMIT): T[] {
  if (locations.length === 0 || count <= 0) return [];
  const random = createSeededRandom(seed);
  const countries = new Map<string, T[]>();
  const seen = new Set<string>();
  for (const location of shuffle([...locations], random)) {
    const key = geoLocationKey(location);
    if (seen.has(key)) continue;
    seen.add(key);
    const pool = countries.get(location.countryCode) ?? [];
    pool.push(location); countries.set(location.countryCode, pool);
  }
  const queue: T[] = [];
  // Each pass visits countries in a new order. No location is reused within a trip.
  while (queue.length < count && countries.size) {
    for (const code of shuffle([...countries.keys()], random)) {
      const pool = countries.get(code)!;
      const location = pool.pop()!;
      // Graph datasets contain neighbouring road nodes. Keep known starts apart.
      const nearby = location.panoId && hasGeoCoordinates(location) && queue.some(prior => prior.panoId && hasGeoCoordinates(prior) && haversineDistanceKm(prior, location) < 1);
      if (!nearby) queue.push(location);
      if (!pool.length) countries.delete(code);
      if (queue.length === count) break;
    }
  }
  return queue;
}

export function createGeoGuessrQueue(seed: string, count = GEOGUESSR_ROUND_LIMIT, rounds?: readonly StreetViewCountryRound[]): GeoGuessrLocation[] {
  return sampleGeoLocations(seed, rounds ? geoGuessrLocations(rounds) : GEO_WORLD_LOCATIONS, count);
}
