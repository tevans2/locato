import { describe, expect, it } from "vitest";
import { GAME_MODE_IDS } from "../server/leaderboard/validation";
import { isLeaderboardGameModeId, LEADERBOARD_GAME_MODE_IDS, leaderboardGameModeOptions } from "../src/core/gameModes";

describe("leaderboard modes", () => {
  it("match the server's boards", () => {
    expect([...LEADERBOARD_GAME_MODE_IDS].sort()).toEqual([...GAME_MODE_IDS].sort());
  });

  it("leave out modes without a board, so the picker never asks for one", () => {
    expect(isLeaderboardGameModeId("flag-colors")).toBe(false);
    expect(leaderboardGameModeOptions.map((option) => option.id)).not.toContain("flag-colors");
    expect(leaderboardGameModeOptions).toHaveLength(GAME_MODE_IDS.length);
  });
});
