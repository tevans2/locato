import { shuffle } from "../game";
import { streetViewLocationKey } from "./catalog";
import type { StreetViewCountryRound } from "./rounds";

export interface StreetViewHistory {
  readonly countries: readonly string[];
  readonly locations: readonly string[];
}

export const emptyStreetViewHistory: StreetViewHistory = { countries: [], locations: [] };

export function mergeStreetViewRounds(rounds: readonly StreetViewCountryRound[]): StreetViewCountryRound[] {
  const countries = new Map<string, Map<string, StreetViewCountryRound["frames"][number]>>();
  for (const { countryCode, frames } of rounds) {
    const locations = countries.get(countryCode) ?? new Map();
    for (const frame of frames) locations.set(streetViewLocationKey(frame), frame);
    countries.set(countryCode, locations);
  }
  return [...countries].map(([countryCode, locations]) => ({ countryCode, frames: [...locations.values()] }));
}

export function selectStreetViewRounds(
  catalog: readonly StreetViewCountryRound[],
  count: number,
  { history = emptyStreetViewHistory, random = Math.random, preferredCountries }: {
    readonly history?: StreetViewHistory;
    readonly random?: () => number;
    readonly preferredCountries?: ReadonlySet<string>;
  } = {},
): StreetViewCountryRound[] {
  const countryOrder = new Map(history.countries.map((code, i) => [code, i]));
  const locationOrder = new Map(history.locations.map((key, i) => [key, i]));
  const candidates = catalog.filter((round) => round.frames.length >= 3).map(({ countryCode, frames }) => ({
    countryCode, frames,
    recentCountry: countryOrder.get(countryCode) ?? -1,
    fresh: frames.filter((frame) => !locationOrder.has(streetViewLocationKey(frame))).length >= 3,
    preferred: preferredCountries?.has(countryCode) ?? false,
  }));
  return shuffle(candidates, random)
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || a.recentCountry - b.recentCountry || Number(b.preferred) - Number(a.preferred))
    .slice(0, count)
    .map(({ countryCode, frames }) => ({
      countryCode,
      frames: shuffle(frames, random)
        .sort((a, b) => (locationOrder.get(streetViewLocationKey(a)) ?? -1) - (locationOrder.get(streetViewLocationKey(b)) ?? -1))
        .slice(0, 3),
    }));
}

export function rememberStreetViewRounds(history: StreetViewHistory, rounds: readonly StreetViewCountryRound[]): StreetViewHistory {
  const countries = new Set(history.countries);
  const locations = new Set(history.locations);
  for (const round of rounds) {
    countries.delete(round.countryCode);
    countries.add(round.countryCode);
    for (const frame of round.frames) {
      const key = streetViewLocationKey(frame);
      locations.delete(key);
      locations.add(key);
    }
  }
  return { countries: [...countries].slice(-100), locations: [...locations].slice(-1000) };
}
