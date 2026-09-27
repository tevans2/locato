import { describe, expect, it } from "vitest";
import { indexCountries, type RawCountry } from "../src/core/countries";
import { createGameEngine } from "../src/core/game";
import { clearSoloRun, clearSoloSave, createSoloSave, persistSoloRun, hydrateGameState, LEGACY_SOLO_SAVE_KEY, readLatestSoloSave, readSoloSave, saveSoloGame, soloSaveKey } from "../src/storage/localSave";

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
    expect(save.flagPool).toBe("countries");
    expect(save.guessedCountryCodes).toContain(current!.code);
    expect(hydrated?.guessedCountryIds.has(current!.id)).toBe(true);
    expect(hydrated?.seed).toBe("save-seed");
    // Category assignment is recomputed deterministically, so the hydrated current prompt keeps its category.
    expect(hydrated?.categoryIds).toEqual(["flags", "codes"]);
  });
  it("persists the selected flag source with a solo save", () => {
    const index = indexCountries(countries);
    const engine = createGameEngine({ countryIndex: index, categoryIds: ["flags"], seed: "territory-save", now: 1000 });
    const save = createSoloSave(index, engine.getState(), 1100, "territories");
    expect(save.flagPool).toBe("territories");
  });

  it("keeps a separate practice save per mode and flag set", () => {
    const storage = new MemoryStorage();
    const index = indexCountries(countries);
    const flags = createGameEngine({ countryIndex: index, categoryIds: ["flags"], seed: "flags-run", now: 1000 });
    flags.dispatch({ type: "SUBMIT_GUESS", value: index.byId[flags.getState().currentCountryId!]!.name, now: 1100 });
    saveSoloGame(storage, index, flags.getState(), 2000, "countries");
    const capitals = createGameEngine({ countryIndex: index, categoryIds: ["capitals"], seed: "capitals-run", now: 1000 });
    saveSoloGame(storage, index, capitals.getState(), 3000);
    const territories = createGameEngine({ countryIndex: index, categoryIds: ["flags"], seed: "territory-run", now: 1000 });
    saveSoloGame(storage, index, territories.getState(), 2500, "territories");

    expect(readSoloSave(storage, ["flags"], "countries")?.seed).toBe("flags-run");
    expect(readSoloSave(storage, ["flags"], "territories")?.seed).toBe("territory-run");
    expect(readSoloSave(storage, ["capitals"])?.seed).toBe("capitals-run");
    // No flag set given: the most recently played flags run.
    expect(readSoloSave(storage, ["flags"])?.seed).toBe("territory-run");
    expect(readSoloSave(storage, ["shapes"])).toBeNull();
    expect(readLatestSoloSave(storage)?.seed).toBe("capitals-run");

    // Restart clears only that mode.
    clearSoloSave(storage, ["capitals"]);
    expect(readSoloSave(storage, ["capitals"])).toBeNull();
    expect(readSoloSave(storage, ["flags"], "countries")?.guessedCountryCodes).toHaveLength(1);
    expect(readLatestSoloSave(storage)?.seed).toBe("territory-run");
  });

  it("skips completed runs when picking the run to resume", () => {
    const storage = new MemoryStorage();
    const index = indexCountries(countries);
    const done = createSoloSave(index, createGameEngine({ countryIndex: index, categoryIds: ["codes"], seed: "done", now: 1 }).getState(), 5000);
    storage.setItem(soloSaveKey(["codes"]), JSON.stringify({ ...done, status: "complete", currentCountryCode: null }));
    saveSoloGame(storage, index, createGameEngine({ countryIndex: index, categoryIds: ["shapes"], seed: "live", now: 1 }).getState(), 1000);
    expect(readLatestSoloSave(storage)?.seed).toBe("live");
  });

  it("migrates the old single solo save into its mode's slot", () => {
    const storage = new MemoryStorage();
    const index = indexCountries(countries);
    const legacy = createSoloSave(index, createGameEngine({ countryIndex: index, categoryIds: ["capitals"], seed: "legacy", now: 1 }).getState(), 1000);
    storage.setItem(LEGACY_SOLO_SAVE_KEY, JSON.stringify(legacy));

    expect(readSoloSave(storage, ["capitals"])?.seed).toBe("legacy");
    expect(storage.getItem(LEGACY_SOLO_SAVE_KEY)).toBeNull();
    expect(storage.getItem(soloSaveKey(["capitals"]))).not.toBeNull();
    expect(readLatestSoloSave(storage)?.seed).toBe("legacy");
  });

  it("migrates an old flags save without a flag set to the countries slot, keeping newer per-mode saves", () => {
    const storage = new MemoryStorage();
    const index = indexCountries(countries);
    const { flagPool: _pool, ...legacyWithoutPool } = createSoloSave(index, createGameEngine({ countryIndex: index, categoryIds: ["flags"], seed: "old", now: 1 }).getState(), 1000);
    storage.setItem(LEGACY_SOLO_SAVE_KEY, JSON.stringify(legacyWithoutPool));
    saveSoloGame(storage, index, createGameEngine({ countryIndex: index, categoryIds: ["flags"], seed: "newer", now: 1 }).getState(), 9000, "countries");

    expect(readSoloSave(storage, ["flags"], "countries")?.seed).toBe("newer");
    expect(storage.getItem(LEGACY_SOLO_SAVE_KEY)).toBeNull();

    const other = new MemoryStorage();
    other.setItem(LEGACY_SOLO_SAVE_KEY, JSON.stringify(legacyWithoutPool));
    expect(other.getItem(soloSaveKey(["flags"], "countries"))).toBeNull();
    expect(readSoloSave(other, ["flags"])?.seed).toBe("old");
    expect(other.getItem(soloSaveKey(["flags"], "countries"))).not.toBeNull();
  });
});

describe("timed runs and the practice save", () => {
  it("never writes or clears the mode's practice save", () => {
    const storage = new MemoryStorage();
    const index = indexCountries(countries);
    const practice = createGameEngine({ countryIndex: index, categoryIds: ["flags"], seed: "practice-run", now: 1000 });
    practice.dispatch({ type: "SUBMIT_GUESS", value: index.byId[practice.getState().currentCountryId!]!.name, now: 1100 });
    persistSoloRun(storage, index, practice.getState(), "practice", 1200);
    const before = storage.getItem(soloSaveKey(["flags"]));
    expect(before).not.toBeNull();

    const timed = createGameEngine({ countryIndex: index, categoryIds: ["flags"], seed: "timed-run", now: 2000 });
    persistSoloRun(storage, index, timed.getState(), "timed", 2100);
    clearSoloRun(storage, ["flags"], "timed");
    expect(storage.getItem(soloSaveKey(["flags"]))).toBe(before);
    expect(readSoloSave(storage, ["flags"])?.seed).toBe("practice-run");

    clearSoloRun(storage, ["flags"], "practice");
    expect(readSoloSave(storage, ["flags"])).toBeNull();
  });
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
