import type { CountryId, CountryIndex } from "../countries";
import { fameTier } from "../countries/fame";
import type { RoundQueue } from "./types";
import { createSeededRandom, shuffle } from "./random";

// Solo "fame ramp": famous countries come first so a brand-new player's opening rounds are
// winnable, and the pool widens as the run progresses. Deterministic per seed.
export function createFameRampQueue(countryIds: readonly CountryId[], index: CountryIndex, seed: string): RoundQueue {
  const tiers: [CountryId[], CountryId[], CountryId[]] = [[], [], []];
  for (const countryId of countryIds) {
    const country = index.byId[countryId];
    const tier = fameTier(country?.code ?? "");
    const bucket = tier === 1 ? tiers[0] : tier === 2 ? tiers[1] : tiers[2];
    if (bucket) bucket.push(countryId);
  }
  const random = createSeededRandom(`${seed}:fame-ramp`);
  return {
    remainingCountryIds: [
      ...shuffle(tiers[0] ?? [], random),
      ...shuffle(tiers[1] ?? [], random),
      ...shuffle(tiers[2] ?? [], random),
    ],
  };
}
