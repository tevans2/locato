import { describe, expect, it } from "vitest";
import {
  ACADEMY_SKILLS,
  academyLevel,
  continentSummary,
  countryMastery,
  emptyProgress,
  findGroup,
  groupCompletion,
  LEARNING_GROUPS,
  levelForMastered,
  resumeGroup,
  seedCard,
  studyStreak,
  suggestNextGroup,
  type AcademyProgress,
  type LeitnerBox,
} from "../src/core/academy";

function withBoxes(progress: AcademyProgress, code: string, boxes: readonly LeitnerBox[]): AcademyProgress {
  return ACADEMY_SKILLS.reduce((next, skill, position) => seedCard(next, code, skill, boxes[position]!, 1000), progress);
}

describe("country mastery", () => {
  it("rolls skills up into levels", () => {
    const empty = emptyProgress();
    expect(countryMastery(empty, "FR")).toBe("new");
    expect(countryMastery(withBoxes(empty, "FR", [1, 0, 0, 0]), "FR")).toBe("learning");
    expect(countryMastery(withBoxes(empty, "FR", [2, 2, 2, 1]), "FR")).toBe("learning");
    expect(countryMastery(withBoxes(empty, "FR", [2, 2, 2, 2]), "FR")).toBe("familiar");
    expect(countryMastery(withBoxes(empty, "FR", [5, 5, 1, 1]), "FR")).toBe("familiar");
    expect(countryMastery(withBoxes(empty, "FR", [5, 5, 2, 0]), "FR")).toBe("learning");
    expect(countryMastery(withBoxes(empty, "FR", [4, 5, 4, 3]), "FR")).toBe("familiar");
    expect(countryMastery(withBoxes(empty, "FR", [4, 5, 4, 4]), "FR")).toBe("mastered");
  });
});

describe("group completion", () => {
  it("counts levels, percent and completion", () => {
    const group = findGroup("europe-big-names")!;
    let progress = emptyProgress();
    expect(groupCompletion(progress, group)).toMatchObject({ started: false, completed: false, percent: 0, new: 7, total: 7 });

    progress = withBoxes(progress, "FR", [4, 4, 4, 4]);
    progress = withBoxes(progress, "DE", [2, 2, 2, 2]);
    progress = withBoxes(progress, "IT", [1, 0, 0, 0]);
    const summary = groupCompletion(progress, group);
    expect(summary).toMatchObject({ mastered: 1, familiar: 1, learning: 1, new: 4, started: true, completed: false });
    expect(summary.percent).toBe(Math.round((16 + 8 + 1) / (7 * 16) * 100));

    for (const code of group.countryCodes) progress = withBoxes(progress, code, [2, 2, 2, 2]);
    expect(groupCompletion(progress, group).completed).toBe(true);
    expect(suggestNextGroup(progress)?.id).toBe(LEARNING_GROUPS[1]!.id);
    expect(continentSummary(progress, "Europe")).toMatchObject({ continent: "Europe", completedGroups: 1, groupCount: 8, total: 44 });
  });

  it("suggests the first group for a fresh player", () => {
    expect(suggestNextGroup(emptyProgress())?.id).toBe("europe-big-names");
  });

  it("resumes the unfinished group last practised after placement, ignoring placement pre-fills", () => {
    const placed: AcademyProgress = { ...seedCard(emptyProgress(), "JP", "flag", 3, 1000), placementCompletedAt: 1000 };
    expect(resumeGroup(placed)).toBeNull();
    const practised = seedCard(seedCard(placed, "KZ", "flag", 1, 5000), "FR", "flag", 1, 3000);
    expect(resumeGroup(practised)?.id).toBe("the-stans");
  });
});

describe("levels and streaks", () => {
  it("maps mastered counts to ranks", () => {
    expect(academyLevel(emptyProgress())).toMatchObject({ level: { title: "Tourist" }, next: { title: "Backpacker" }, progressToNext: 0 });
    expect(levelForMastered(12)).toMatchObject({ level: { title: "Backpacker" }, progressToNext: 7 / 15 });
    expect(levelForMastered(196)).toMatchObject({ level: { title: "Atlas" }, next: null, progressToNext: 1 });
    let progress = emptyProgress();
    for (const code of ["FR", "DE", "IT", "ES", "PT"]) progress = withBoxes(progress, code, [4, 4, 4, 4]);
    expect(academyLevel(progress).level.title).toBe("Backpacker");
  });

  it("counts consecutive study days, tolerating an unstudied today", () => {
    const activity = { "2026-09-26": 4, "2026-09-25": 1, "2026-09-24": 7, "2026-09-22": 3, "2026-09-30": 0 };
    expect(studyStreak(activity, "2026-09-26")).toBe(3);
    expect(studyStreak(activity, "2026-09-27")).toBe(3);
    expect(studyStreak(activity, "2026-09-28")).toBe(0);
    expect(studyStreak({ "2026-03-01": 1, "2026-02-28": 1 }, "2026-03-01")).toBe(2);
  });
});
