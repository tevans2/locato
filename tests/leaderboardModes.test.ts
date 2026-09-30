import { describe, expect, it } from "vitest";
import { GAME_MODE_IDS, SCORE_GAME_MODE_IDS, TIME_GAME_MODE_IDS } from "../server/leaderboard/validation";
import { GAME_MODE_GROUPS, gameModeOptions, isLeaderboardMode, LEADERBOARD_GAME_MODE_IDS } from "../src/core/gameModes";
import { LEADERBOARD_MODES, leaderboardConfig } from "../src/core/leaderboards";

describe("leaderboard modes", () => {
  it("match the server's boards", () => {
    expect([...LEADERBOARD_GAME_MODE_IDS].sort()).toEqual([...GAME_MODE_IDS].sort());
  });

  it("give every one of the 15 modes a board", () => {
    expect(LEADERBOARD_GAME_MODE_IDS).toHaveLength(15);
    expect(new Set(LEADERBOARD_GAME_MODE_IDS)).toEqual(new Set(gameModeOptions.map((option) => option.id)));
    for (const option of gameModeOptions) expect(isLeaderboardMode(option.id)).toBe(true);
    const withBoards = GAME_MODE_GROUPS.flatMap((group) => group.modes).filter((mode) => mode.leaderboard).map((mode) => mode.id);
    expect(withBoards).toHaveLength(15);
    expect(isLeaderboardMode("nope")).toBe(false);
  });

  it("split into time boards (fastest first) and score boards (highest first)", () => {
    expect([...SCORE_GAME_MODE_IDS].sort()).toEqual(["flyover", "geoguessr", "map-tap", "streetview-country", "worldsplit"]);
    expect([...TIME_GAME_MODE_IDS].sort()).toEqual(["capital-recall", "capitals", "click-country", "codes", "flag-colors", "flags", "name-all", "puzzle", "shapes", "spot-country"]);
    for (const config of LEADERBOARD_MODES) {
      if (config.metric === "score") expect(config.maxScore).toBeGreaterThan(0);
      else expect(config.maxScore).toBeUndefined();
    }
    expect(leaderboardConfig("map-tap")?.maxScore).toBe(50_000);
    expect(leaderboardConfig("streetview-country")?.maxScore).toBe(15);
  });
});
