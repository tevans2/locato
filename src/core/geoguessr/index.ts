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

export function createGeoGuessrQueue(seed: string, count = GEOGUESSR_ROUND_LIMIT, rounds: readonly StreetViewCountryRound[] = streetViewCountryRounds): GeoGuessrLocation[] {
  const locations = geoGuessrLocations(rounds);
  if (locations.length === 0) return [];
  const random = createSeededRandom(seed);
  const countryCodes = shuffle([...new Set(locations.map((location) => location.countryCode))], random);
  const queue: GeoGuessrLocation[] = [];

  for (const countryCode of countryCodes) {
    const countryLocations = locations.filter((location) => location.countryCode === countryCode);
    const selected = countryLocations[Math.floor(random() * countryLocations.length)];
    if (selected) queue.push(selected);
    if (queue.length >= count) return queue;
  }

  return shuffle([...locations], random).slice(0, count);
}
