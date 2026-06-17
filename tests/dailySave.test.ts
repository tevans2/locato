import { describe, expect, it } from "vitest";
import { createDailyResultSave, dailySaveKey, readDailyResult, saveDailyResult } from "../src/storage/dailySave";

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
