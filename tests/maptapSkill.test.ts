import { describe, expect, it } from "vitest";
import { defaultMapTapSkill, difficultyForSkill, recordMapTapResult, type MapTapSkill } from "../src/core/maptap/skill";

describe("MapTap adaptive skill", () => {
  it("stays rookie while results are weak", () => {
    let skill: MapTapSkill = defaultMapTapSkill;
    for (const score of [0.1, 0.2, 0.15]) skill = recordMapTapResult(skill, score);
    expect(skill.level).toBe("rookie");
  });

  it("promotes to explorer after two solid rounds", () => {
    let skill = recordMapTapResult(defaultMapTapSkill, 0.7);
    skill = recordMapTapResult(skill, 0.6);
    expect(skill.level).toBe("explorer");
    expect(difficultyForSkill("explorer", 0)).toBe("easy");
    expect(difficultyForSkill("explorer", 1)).toBe("medium");
  });

  it("reaches expert quickly on consistently strong scores", () => {
    let skill = defaultMapTapSkill;
    for (const score of [0.9, 0.8]) skill = recordMapTapResult(skill, score);
    expect(skill.level).toBe("explorer");
    skill = recordMapTapResult(skill, 0.75);
    expect(skill.level).toBe("expert");
    expect(["medium", "hard"]).toContain(difficultyForSkill("expert", 3));
  });

  it("demotes experts who keep missing", () => {
    let skill: MapTapSkill = { level: "expert", recentScores: [] };
    for (const score of [0.1, 0.05, 0.2]) skill = recordMapTapResult(skill, score);
    expect(skill.level).toBe("explorer");
  });

  it("caps the recent-score history", () => {
    let skill = defaultMapTapSkill;
    for (let index = 0; index < 20; index += 1) skill = recordMapTapResult(skill, 0.5);
    expect(skill.recentScores.length).toBeLessThanOrEqual(6);
  });
});
