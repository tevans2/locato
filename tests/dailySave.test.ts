import { describe, expect, it } from "vitest";
import { clearDailyProgress, createDailyResultSave, dailyProgressKey, dailySaveKey, readDailyProgress, readDailyResult, saveDailyProgress, saveDailyResult, type DailyProgressSave } from "../src/storage/dailySave";
import { indexCountries, type RawCountry } from "../src/core/countries";
import { createGameEngine } from "../src/core/game";
import { createSoloSave, hydrateGameState } from "../src/storage/localSave";

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

function makeResult(date: string, score: number) {
  return createDailyResultSave(
    {
      date,
      seed: `daily:${date}`,
      score,
      timeMs: 120_000,
      hintsUsed: 0,
      marks: ["correct", "correct", "correct", "correct", "correct", "correct", "correct", "correct", "correct", "correct"],
    },
    1_797_000_000_000,
  );
}

describe("daily result save", () => {
  it("keeps daily saves separate per signed-in account", () => {
    const storage = new MemoryStorage();
    const date = "2026-06-12";

    saveDailyResult(storage, makeResult(date, 80), "account-a");

    expect(readDailyResult(storage, date, "account-a")?.score).toBe(80);
    expect(readDailyResult(storage, date, "account-b")).toBeNull();
  });

  it("does not expose old browser-wide daily saves to signed-in accounts", () => {
    const storage = new MemoryStorage();
    const date = "2026-06-12";
    const legacyKey = `locato:daily:${date}:v2`;

    storage.setItem(legacyKey, JSON.stringify(makeResult(date, 70)));

    expect(readDailyResult(storage, date)?.score).toBe(70);
    expect(readDailyResult(storage, date, "fresh-account")).toBeNull();
    expect(storage.getItem(dailySaveKey(date, "fresh-account"))).toBeNull();
  });
});

const countries = [
  { name: "Japan", code: "JP", aliases: [], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Brazil", code: "BR", aliases: [], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: [] },
  { name: "Kenya", code: "KE", aliases: [], continent: "Africa", flagSrc: "assets/flags/ke.svg", capital: "Nairobi", capitalAliases: [] },
] as const satisfies readonly RawCountry[];

function makeProgress(date: string, overrides: Partial<DailyProgressSave> = {}): DailyProgressSave {
  return {
    version: 1,
    date,
    seed: `daily:${date}`,
    stage: "prompt",
    roundIndex: 3,
    score: 27,
    marks: ["correct", "hint", "correct"],
    hintsUsed: 1,
    elapsedMs: 45_000,
    engine: null,
    roundHintsUsed: 1,
    roundWrongGuesses: 0,
    updatedAt: 1_797_000_000_000,
    ...overrides,
  };
}

describe("daily progress save", () => {
  it("round-trips today's progress, including the prompt engine so the same order resumes", () => {
    const storage = new MemoryStorage();
    const date = "2026-09-27";
    const index = indexCountries(countries);
    const engine = createGameEngine({ countryIndex: index, categoryIds: ["flags"], seed: `daily:${date}`, now: 1000 });
    const first = index.byId[engine.getState().currentCountryId!]!;
    engine.dispatch({ type: "SUBMIT_GUESS", value: first.name, now: 1200 });
    const next = engine.getState().currentCountryId;

    saveDailyProgress(storage, makeProgress(date, { engine: createSoloSave(index, engine.getState(), 1300) }));
    const restored = readDailyProgress(storage, date, `daily:${date}`);

    expect(restored).toMatchObject({ stage: "prompt", roundIndex: 3, score: 27, hintsUsed: 1, elapsedMs: 45_000, roundHintsUsed: 1 });
    expect(restored?.marks).toEqual(["correct", "hint", "correct"]);
    const hydrated = hydrateGameState(index, restored!.engine!);
    expect(hydrated?.currentCountryId).toBe(next);
    expect(hydrated?.guessedCountryIds.has(first.id)).toBe(true);
  });

  it("keeps later stages and scopes progress per account", () => {
    const storage = new MemoryStorage();
    const date = "2026-09-27";
    saveDailyProgress(storage, makeProgress(date, { stage: "map-tap", roundIndex: 8 }), "account-a");
    expect(readDailyProgress(storage, date, `daily:${date}`, "account-a")?.stage).toBe("map-tap");
    expect(readDailyProgress(storage, date, `daily:${date}`, "account-b")).toBeNull();
    expect(readDailyProgress(storage, date, `daily:${date}`)).toBeNull();
    clearDailyProgress(storage, "account-a");
    expect(readDailyProgress(storage, date, `daily:${date}`, "account-a")).toBeNull();
  });

  it("discards an in-progress daily from a past date", () => {
    const storage = new MemoryStorage();
    saveDailyProgress(storage, makeProgress("2026-09-26"));
    expect(readDailyProgress(storage, "2026-09-27", "daily:2026-09-27")).toBeNull();
    expect(storage.getItem(dailyProgressKey())).toBeNull();
  });

  it("discards corrupt progress", () => {
    const storage = new MemoryStorage();
    storage.setItem(dailyProgressKey(), "{not json");
    expect(readDailyProgress(storage, "2026-09-27", "daily:2026-09-27")).toBeNull();
    saveDailyProgress(storage, makeProgress("2026-09-27", { score: 999 }));
    expect(readDailyProgress(storage, "2026-09-27", "daily:2026-09-27")).toBeNull();
  });
});
