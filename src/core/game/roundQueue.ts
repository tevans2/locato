import type { CountryId } from "../countries";
import type { RoundQueue } from "./types";
import { createSeededRandom, shuffle } from "./random";

export function createRoundQueue(countryIds: readonly CountryId[], seed: string): RoundQueue {
  return { remainingCountryIds: shuffle(countryIds, createSeededRandom(seed)) };
}

export function takeNextCountry(queue: RoundQueue, excludedCountryIds: ReadonlySet<CountryId>): {
  readonly countryId: CountryId | null;
  readonly queue: RoundQueue;
} {
  const remaining = [...queue.remainingCountryIds];

  while (remaining.length > 0) {
    const countryId = remaining.shift();
    if (countryId === undefined) continue;
    if (!excludedCountryIds.has(countryId)) {
      return { countryId, queue: { remainingCountryIds: remaining } };
    }
  }

  return { countryId: null, queue: { remainingCountryIds: [] } };
}

export function restoreRoundQueue(countryIds: readonly CountryId[]): RoundQueue {
  return { remainingCountryIds: [...countryIds] };
}
