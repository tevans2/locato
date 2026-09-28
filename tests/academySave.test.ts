import { describe, expect, it } from "vitest";
import { emptyProgress, recordAnswer } from "../src/core/academy";
import { ACADEMY_SAVE_KEY, readAcademyProgress, saveAcademyProgress } from "../src/storage/academySave";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe("academy save", () => {
  it("round-trips progress", () => {
    const storage = memoryStorage();
    const progress = { ...recordAnswer(emptyProgress(), "FR", "flag", true, 1000, "2026-09-26"), placementCompletedAt: 900 };
    expect(saveAcademyProgress(storage, progress)).toBe(true);
    expect(storage.data.has(ACADEMY_SAVE_KEY)).toBe(true);
    expect(readAcademyProgress(storage)).toEqual(progress);
  });

  it("returns empty progress for missing or corrupt data", () => {
    expect(readAcademyProgress(memoryStorage())).toEqual(emptyProgress());
    expect(readAcademyProgress(null)).toEqual(emptyProgress());
    for (const raw of ["{not json", "null", "[]", '{"version":2,"cards":{}}', '{"version":1,"cards":[]}']) {
      expect(readAcademyProgress(memoryStorage({ [ACADEMY_SAVE_KEY]: raw })), raw).toEqual(emptyProgress());
    }
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
    expect(readAcademyProgress(throwing)).toEqual(emptyProgress());
    expect(saveAcademyProgress(throwing, emptyProgress())).toBe(false);
  });

  it("drops invalid cards and activity but keeps the rest", () => {
    const raw = JSON.stringify({
      version: 1,
      cards: {
        "FR:flag": { box: 2, correct: 2, wrong: 0, lastSeenAt: 5, dueAt: 10 },
        "DE:flag": { box: 9, correct: 2, wrong: 0, lastSeenAt: 5, dueAt: 10 },
        "IT:smell": { box: 1, correct: 1, wrong: 0, lastSeenAt: 5, dueAt: 10 },
        "ES:map": { box: 1, correct: "x", wrong: 0, lastSeenAt: 5, dueAt: 10 },
      },
      placementCompletedAt: "soon",
      activity: { "2026-09-26": 3, bogus: 4, "2026-09-25": -1 },
      updatedAt: 7,
    });
    const progress = readAcademyProgress(memoryStorage({ [ACADEMY_SAVE_KEY]: raw }));
    expect(Object.keys(progress.cards)).toEqual(["FR:flag"]);
    expect(progress.activity).toEqual({ "2026-09-26": 3 });
    expect(progress.placementCompletedAt).toBeNull();
    expect(progress.updatedAt).toBe(7);
  });
});
