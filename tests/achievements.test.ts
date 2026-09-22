import { describe, expect, it } from "vitest";
import { indexCountries, rawCountries, type Continent, type CountryId } from "../src/core/countries";
import { recordSoloAchievements, recordWorldAchievements } from "../src/storage/achievements";

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

const countryIndex = indexCountries(rawCountries);

function countryIdsForContinent(continent: Continent): Set<CountryId> {
  return new Set(countryIndex.countries.filter((country) => country.continent === continent).map((country) => country.id));
}

function countryIdsForCodes(codes: readonly string[]): Set<CountryId> {
  const ids = new Set<CountryId>();
  for (const code of codes) {
    const country = countryIndex.byCode.get(code);
    if (country) ids.add(country.id);
  }
  return ids;
}

describe("achievement geography milestones", () => {
  it("unlocks continent world-map badges when a continent is fully revealed", () => {
    const storage = new MemoryStorage();
    const unlocked = recordWorldAchievements(storage, {
      playMode: "name-all",
      completed: false,
      countryIndex,
      guessedCountryIds: countryIdsForContinent("Africa"),
    });

    expect(unlocked.map((achievement) => achievement.id)).toContain("world-africa-complete");
  });

  it("tracks landlocked countries across world-map runs", () => {
    const storage = new MemoryStorage();
    const firstBatch = [
      "AF", "AD", "AM", "AT", "AZ", "BY", "BT", "BO", "BW", "BF", "BI", "CF", "TD", "CZ", "SZ",
      "ET", "HU", "KZ", "KG", "LA", "LS", "LI", "LU", "MW", "ML",
    ];
    const secondBatch = [
      "AF", "AD", "AM", "AT", "AZ", "BY", "BT", "BO", "BW", "BF", "BI", "CF", "TD", "CZ", "SZ",
      "ET", "HU", "KZ", "KG", "LA", "LS", "LI", "LU", "MW", "ML", "MD", "MN", "NP", "NE", "MK",
      "PY", "RW", "SM", "RS", "SK", "SS", "CH", "TJ", "TM", "UG", "UZ", "ZM", "ZW", "VA",
    ];

    const firstUnlocks = recordWorldAchievements(storage, {
      playMode: "spot-country",
      completed: false,
      countryIndex,
      guessedCountryIds: countryIdsForCodes(firstBatch),
    });
    const secondUnlocks = recordWorldAchievements(storage, {
      playMode: "click-country",
      completed: false,
      countryIndex,
      guessedCountryIds: countryIdsForCodes(secondBatch),
    });

    expect(firstUnlocks.map((achievement) => achievement.id)).toContain("world-landlocked-25");
    expect(secondUnlocks.map((achievement) => achievement.id)).toContain("world-landlocked-all");
  });

  it("unlocks clean regional solo badges only when the run has no hints or misses", () => {
    const storage = new MemoryStorage();
    const guessedCountryIds = new Set(countryIndex.countries.map((country) => country.id));

    const blocked = recordSoloAchievements(storage, {
      completed: true,
      wrongAnswers: 0,
      bestStreak: countryIndex.countries.length,
      gameMode: "flags",
      hintsUsed: 1,
      countryIndex,
      guessedCountryIds,
    });
    const unlocked = recordSoloAchievements(storage, {
      completed: true,
      wrongAnswers: 0,
      bestStreak: countryIndex.countries.length,
      gameMode: "flags",
      hintsUsed: 0,
      countryIndex,
      guessedCountryIds,
    });

    expect(blocked.map((achievement) => achievement.id)).not.toContain("solo-africa-clean");
    expect(unlocked.map((achievement) => achievement.id)).toEqual(expect.arrayContaining(["solo-no-hints", "solo-africa-clean", "solo-south-america-clean", "solo-oceania-clean"]));
  });
});
