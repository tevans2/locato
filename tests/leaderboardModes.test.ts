import { describe, expect, it } from "vitest";
import { GAME_MODE_IDS } from "../server/leaderboard/validation";
import { GAME_MODE_GROUPS, isLeaderboardMode, LEADERBOARD_GAME_MODE_IDS } from "../src/core/gameModes";

describe("leaderboard modes", () => {
  it("match the server's boards", () => {
    expect([...LEADERBOARD_GAME_MODE_IDS].sort()).toEqual([...GAME_MODE_IDS].sort());
  });

  it("leave out modes without a board, so the picker never asks for one", () => {
    expect(isLeaderboardMode("flag-colors")).toBe(false);
    const withBoards = GAME_MODE_GROUPS.flatMap((group) => group.modes).filter((mode) => mode.leaderboard).map((mode) => mode.id);
    expect(withBoards).not.toContain("flag-colors");
    expect(withBoards).toHaveLength(GAME_MODE_IDS.length);
  });
});
