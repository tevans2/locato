import type { RankedGames } from "../../server/ranked/RankedGames";
import type { Country } from "../../src/core/countries";
import type { FlyoverCountry } from "../../src/core/flyover";
import type { RankedAction, RankedState } from "../../src/core/ranked";
import type { MapTapLocation } from "../../src/core/maptap/types";
import type { GeoGuessrLocation } from "../../src/core/geoguessr";
import type { StreetViewCountryRound } from "../../src/core/streetview";

// Test-only introspection: expected answers come from the server fixture, never a public response.
export interface PrivateChallenge { mode: string; country?: Country; mapCountry?: FlyoverCountry; location?: MapTapLocation; geo?: GeoGuessrLocation; street?: StreetViewCountryRound; }
export function privateChallenge(games: RankedGames, state: RankedState): PrivateChallenge {
  const runs = (games as unknown as { runs: Map<string, { queue: PrivateChallenge[]; index: number }> }).runs;
  const run = runs.get(state.runId)!;
  return run.queue[run.index]!;
}
export function answerFor(games: RankedGames, state: RankedState): Omit<RankedAction, "runId" | "questionId"> {
  const c = privateChallenge(games, state);
  if (c.location || c.geo) { const p = c.location ?? c.geo!; return { type: "pin", lat: p.lat, lng: p.lng }; }
  if (c.mode === "worldsplit") return { type: "line", line: [[500, 0], [500, 500]] };
  if (c.mode === "puzzle" || c.mode === "click-country") return { type: "place", x: c.mapCountry!.centre[0], y: c.mapCountry!.centre[1] };
  if (c.street) return { type: "answer", answer: c.street.countryCode };
  if (c.mode === "capital-recall") return { type: "answer", answer: c.country!.capital! };
  if (c.mode === "name-all") {
    const run = (games as unknown as { runs: Map<string, { found: Set<string>; queue: PrivateChallenge[] }> }).runs.get(state.runId)!;
    return { type: "answer", answer: run.queue.find((q) => !run.found.has(q.country!.code))!.country!.name };
  }
  return { type: "answer", answer: c.country!.name };
}
export function stateOf(value: RankedState | { error: string }): RankedState { if ("error" in value) throw new Error(value.error); return value; }
