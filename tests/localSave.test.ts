import { describe, expect, it } from "vitest";
import { indexCountries, type RawCountry } from "../src/core/countries";
import { createGameEngine } from "../src/core/game";
import { createSoloSave, hydrateGameState } from "../src/storage/localSave";

const countries = [
  { name: "Japan", code: "JP", aliases: [], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Brazil", code: "BR", aliases: [], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: ["Brasilia"] },
] as const satisfies readonly RawCountry[];

describe("local save", () => {
  it("serializes and hydrates game state by stable country codes", () => {
    const index = indexCountries(countries);
    const engine = createGameEngine({ countryIndex: index, categoryIds: ["flags", "codes"], seed: "save-seed", now: 1000 });
    const current = index.byId[engine.getState().currentCountryId!];

    engine.dispatch({ type: "SUBMIT_GUESS", value: current!.name, now: 1200 });
    const save = createSoloSave(index, engine.getState(), 1300);
    const hydrated = hydrateGameState(index, save);

    expect(save.version).toBe(2);
    expect(save.categoryIds).toEqual(["flags", "codes"]);
    expect(save.guessedCountryCodes).toContain(current!.code);
    expect(hydrated?.guessedCountryIds.has(current!.id)).toBe(true);
    expect(hydrated?.seed).toBe("save-seed");
    // Category assignment is recomputed deterministically, so the hydrated current prompt keeps its category.
    expect(hydrated?.categoryIds).toEqual(["flags", "codes"]);
  });
});
