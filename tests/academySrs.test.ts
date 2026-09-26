import { describe, expect, it } from "vitest";
import {
  BOX_INTERVALS_MS,
  cardKey,
  dueCards,
  emptyProgress,
  getCard,
  mergeProgress,
  recordAnswer,
  type AcademyProgress,
} from "../src/core/academy";

const NOW = Date.UTC(2026, 8, 26, 12);
const DAY = 86_400_000;

function answer(progress: AcademyProgress, correct: boolean, at = NOW, day = "2026-09-26") {
  return recordAnswer(progress, "FR", "flag", correct, at, day);
}

describe("leitner scheduling", () => {
  it("moves up one box per correct answer and caps at 5", () => {
    let progress = emptyProgress();
    const boxes: number[] = [];
    for (let step = 0; step < 7; step += 1) {
      progress = answer(progress, true);
      boxes.push(getCard(progress, "FR", "flag").box);
    }
    expect(boxes).toEqual([1, 2, 3, 4, 5, 5, 5]);
    expect(getCard(progress, "FR", "flag")).toMatchObject({ correct: 7, wrong: 0, lastSeenAt: NOW, dueAt: NOW + BOX_INTERVALS_MS[5] });
  });

  it("drops to box 1 on a miss and schedules by box", () => {
    let progress = answer(answer(answer(emptyProgress(), true), true), true);
    expect(getCard(progress, "FR", "flag").dueAt).toBe(NOW + 3 * DAY);
    progress = answer(progress, false);
    expect(getCard(progress, "FR", "flag")).toMatchObject({ box: 1, wrong: 1, dueAt: NOW + 10 * 60_000 });
    expect(BOX_INTERVALS_MS).toMatchObject({ 1: 600_000, 2: DAY, 3: 3 * DAY, 4: 7 * DAY, 5: 21 * DAY });
  });

  it("is immutable and tracks activity and updatedAt", () => {
    const start = emptyProgress();
    const next = answer(answer(start, true), false, NOW + 5);
    expect(start.cards).toEqual({});
    expect(next.activity).toEqual({ "2026-09-26": 2 });
    expect(next.updatedAt).toBe(NOW + 5);
    expect(cardKey("fr", "flag")).toBe("FR:flag");
  });

  it("prunes activity older than 60 days", () => {
    let progress = answer(emptyProgress(), true, NOW, "2026-06-01");
    progress = answer(progress, true, NOW, "2026-09-26");
    expect(Object.keys(progress.activity)).toEqual(["2026-09-26"]);
  });

  it("lists due cards most overdue first", () => {
    let progress = recordAnswer(emptyProgress(), "FR", "flag", true, NOW, "2026-09-26");
    progress = recordAnswer(progress, "DE", "flag", true, NOW - 60_000, "2026-09-26");
    progress = recordAnswer(recordAnswer(progress, "IT", "map", true, NOW, "2026-09-26"), "IT", "map", true, NOW, "2026-09-26");
    expect(dueCards(progress, NOW)).toEqual([]);
    expect(dueCards(progress, NOW + 11 * 60_000).map((card) => card.key)).toEqual(["DE:flag", "FR:flag"]);
    expect(dueCards(progress, NOW + 2 * DAY)).toHaveLength(3);
  });
});

describe("mergeProgress", () => {
  it("keeps the newest card, max activity, earliest placement and latest update", () => {
    const local: AcademyProgress = {
      version: 1,
      cards: {
        "FR:flag": { box: 4, correct: 4, wrong: 0, lastSeenAt: 200, dueAt: 900 },
        "DE:map": { box: 2, correct: 2, wrong: 0, lastSeenAt: 100, dueAt: 500 },
      },
      placementCompletedAt: 50,
      activity: { "2026-09-25": 3, "2026-09-26": 1 },
      updatedAt: 200,
    };
    const remote: AcademyProgress = {
      version: 1,
      cards: {
        "FR:flag": { box: 1, correct: 4, wrong: 1, lastSeenAt: 300, dueAt: 400 },
        "DE:map": { box: 5, correct: 5, wrong: 0, lastSeenAt: 90, dueAt: 999 },
        "IT:capital": { box: 1, correct: 1, wrong: 0, lastSeenAt: 10, dueAt: 20 },
      },
      placementCompletedAt: null,
      activity: { "2026-09-26": 4 },
      updatedAt: 300,
    };
    const merged = mergeProgress(local, remote);
    expect(merged.cards["FR:flag"]?.box).toBe(1);
    expect(merged.cards["DE:map"]?.box).toBe(2);
    expect(merged.cards["IT:capital"]).toBeDefined();
    expect(merged.activity).toEqual({ "2026-09-25": 3, "2026-09-26": 4 });
    expect(merged.placementCompletedAt).toBe(50);
    expect(merged.updatedAt).toBe(300);
    expect(mergeProgress(remote, local)).toEqual(merged);
  });
});
