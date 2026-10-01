import { describe, expect, it } from "vitest";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import type { PasswordHasher, UserStore } from "../server/auth/types";
import { checkSeedSafety, findSeedUsers, SEED_BOARDS, SEED_SCORE_BOARDS, seedDevData, TEST_USER } from "../server/dev/seed";
import { leaderboardConfig } from "../src/core/leaderboards";
import { GAME_MODE_IDS } from "../server/leaderboard/validation";
import { DAILY_MAX_SCORE } from "../src/core/dailyChallenge";

const fakeHasher: PasswordHasher = {
  hash: async (password) => `hashed:${password}`,
  verify: async (password, hash) => hash === `hashed:${password}`,
};

// Mid-afternoon local time so every seeded "today" moment is safely in the past.
const NOW = new Date(2026, 8, 27, 15, 30).getTime();

function localDay(daysAgo: number): string {
  const date = new Date(2026, 8, 27 - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function boardSizes(store: UserStore): number[] {
  return [
    ...SEED_BOARDS.map((board) => store.getLeaderboard({ gameMode: board.gameMode, variant: board.variant, limit: 100, offset: 0 }).length),
    ...SEED_SCORE_BOARDS.map((board) => store.getScoreLeaderboard({ gameMode: board.gameMode, variant: board.variant, limit: 100, offset: 0 }).length),
  ];
}

describe("dev seed", () => {
  it("creates a test user who can log in, with friends, dailies, stats and Academy progress", async () => {
    const store = createMemoryUserStore();
    const service = new AuthService(store, fakeHasher, { sessionTtlMs: 60_000, clock: () => NOW });
    const summary = await seedDevData({ store, hasher: fakeHasher, now: NOW });

    const login = await service.login({ email: TEST_USER.email, password: TEST_USER.password });
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    const testerId = login.user.id;
    expect(login.user.displayName).toBe("tester");

    expect(summary.createdUsers).toBe(41);
    expect(store.getStats(testerId).totalGames).toBeGreaterThan(20);
    expect(store.listFriends(testerId)).toHaveLength(5);
    const requests = store.listFriendRequests(testerId);
    expect(requests.incoming).toHaveLength(1);
    expect(requests.outgoing).toHaveLength(1);

    const daily = service.getDailySummary(testerId, localDay(0));
    expect(daily.history).toHaveLength(10);
    expect(daily.streak).toBe(7);
    expect(daily.friendsToday.length).toBeGreaterThanOrEqual(4);

    const academy = service.getAcademyProgress(testerId);
    expect(academy).not.toBeNull();
    const cards = Object.values(academy!.cards);
    expect(cards.filter((card) => card.box >= 4).length).toBeGreaterThan(20);
    expect(cards.filter((card) => card.box > 0 && card.dueAt <= NOW).length).toBeGreaterThanOrEqual(3);

    expect(summary.tester?.ranks.some((rank) => rank.rank <= 5)).toBe(true);
    // Top 3 on one score board, and on the board (mid-table) for the other score modes.
    const testerScoreRanks = SEED_SCORE_BOARDS.map((board) => summary.tester?.ranks.find((rank) => rank.board === board.gameMode));
    expect(testerScoreRanks.every((rank) => rank !== undefined)).toBe(true);
    expect(testerScoreRanks.find((rank) => rank?.board === "geoguessr")!.rank).toBeLessThanOrEqual(3);
    expect(summary.tester?.ranks.find((rank) => rank.board === "flag-colors")).toBeDefined();
    expect(summary.bestScores).toBeGreaterThan(30);
    expect(summary.achievementsSnippet).toContain("locato.achievements.v1");
    expect(store.listEvents({ level: null, action: null, ip: null, userId: null, before: null, limit: 500 }).length).toBeGreaterThan(20);
  });

  it("populates every leaderboard mode and variant with plausible entries", async () => {
    const store = createMemoryUserStore();
    await seedDevData({ store, hasher: fakeHasher, now: NOW });

    expect(new Set([...SEED_BOARDS, ...SEED_SCORE_BOARDS].map((board) => board.gameMode))).toEqual(new Set(GAME_MODE_IDS));
    for (const board of SEED_BOARDS) expect(leaderboardConfig(board.gameMode)?.metric).toBe("time");
    for (const size of boardSizes(store)) expect(size).toBeGreaterThanOrEqual(8);

    // Score boards: every total within 0..maxScore, a spread of values, highest first.
    for (const board of SEED_SCORE_BOARDS) {
      const maxScore = leaderboardConfig(board.gameMode)!.maxScore!;
      const entries = store.getScoreLeaderboard({ gameMode: board.gameMode, variant: board.variant, limit: 100, offset: 0 });
      for (const entry of entries) {
        expect(Number.isInteger(entry.score)).toBe(true);
        expect(entry.score).toBeGreaterThanOrEqual(0);
        expect(entry.score).toBeLessThanOrEqual(maxScore);
      }
      expect(entries.map((entry) => entry.score)).toEqual([...entries.map((entry) => entry.score)].sort((a, b) => b - a));
      expect(new Set(entries.map((entry) => entry.score)).size).toBeGreaterThan(3);
    }

    const dailyToday = store.listDailyResultsForDate(localDay(0));
    expect(dailyToday.length).toBeGreaterThan(10);
    for (const { result } of dailyToday) {
      expect(result.score).toBeLessThanOrEqual(DAILY_MAX_SCORE);
      expect(result.completedAt).toBeLessThanOrEqual(NOW);
    }
    // The admin overview reads 30 days of activity.
    const activity = store.listActivitySince(NOW - 30 * 86_400_000);
    expect(new Set(activity.games.map((game) => new Date(game.at).toDateString())).size).toBeGreaterThan(20);
  });

  it("is deterministic and idempotent: re-running refreshes instead of duplicating", async () => {
    const store = createMemoryUserStore();
    const first = await seedDevData({ store, hasher: fakeHasher, now: NOW });
    const testerId = store.findUserByEmail(TEST_USER.email)!.id;
    const sizes = boardSizes(store);
    const totals = store.getAdminTotals(NOW);

    const second = await seedDevData({ store, hasher: fakeHasher, now: NOW });
    expect(second.createdUsers).toBe(0);
    expect(second.refreshedUsers).toBe(41);
    expect(second.eventsSkipped).toBe(true);
    expect(store.findUserByEmail(TEST_USER.email)!.id).toBe(testerId);
    expect(boardSizes(store)).toEqual(sizes);
    expect(store.getAdminTotals(NOW)).toEqual(totals);
    expect(second.tester?.ranks).toEqual(first.tester?.ranks);

    const other = createMemoryUserStore();
    const fresh = await seedDevData({ store: other, hasher: fakeHasher, now: NOW });
    expect(fresh.boards).toEqual(first.boards);
    const different = await seedDevData({ store: createMemoryUserStore(), hasher: fakeHasher, now: NOW, seed: 42 });
    expect(different.boards).not.toEqual(first.boards);
  });

  it("reset and clean only remove seed accounts", async () => {
    const store = createMemoryUserStore();
    const service = new AuthService(store, fakeHasher, { sessionTtlMs: 60_000, clock: () => NOW });
    const real = await service.register({ email: "real@example.com", password: "a-real-password", displayName: "RealPerson" });
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    store.submitBestTime(real.user.id, { gameMode: "flags", variant: "", timeMs: 200_000, achievedAt: NOW });

    await seedDevData({ store, hasher: fakeHasher, now: NOW });
    const oldTesterId = store.findUserByEmail(TEST_USER.email)!.id;
    // A real account befriending a seed player keeps that friendship across a refresh.
    store.sendFriendRequest(real.user.id, store.findUserByUsername("atlas_amy")!.id, NOW);
    await seedDevData({ store, hasher: fakeHasher, now: NOW });
    expect(store.listFriendRequests(real.user.id).outgoing).toHaveLength(1);

    const reset = await seedDevData({ store, hasher: fakeHasher, now: NOW, reset: true });
    expect(reset.removedUsers).toBe(41);
    expect(reset.createdUsers).toBe(41);
    expect(store.findUserByEmail(TEST_USER.email)!.id).not.toBe(oldTesterId);

    const clean = await seedDevData({ store, hasher: fakeHasher, now: NOW, cleanOnly: true });
    expect(clean.removedUsers).toBe(41);
    expect(findSeedUsers(store)).toHaveLength(0);
    expect(store.listUsers({ query: null, limit: 100, offset: 0 }).total).toBe(1);
    expect(store.findUserById(real.user.id)).not.toBeNull();
    expect(store.getUserRank(real.user.id, "flags", "")).toEqual({ rank: 1, timeMs: 200_000 });
  });

  it("skips a seed player whose username a real account already owns", async () => {
    const store = createMemoryUserStore();
    const service = new AuthService(store, fakeHasher, { sessionTtlMs: 60_000, clock: () => NOW });
    await service.register({ email: "amy@example.com", password: "a-real-password", displayName: "atlas_amy" });
    const summary = await seedDevData({ store, hasher: fakeHasher, now: NOW });
    expect(summary.skippedUsernames).toEqual(["atlas_amy"]);
    const amy = store.findUserByEmail("amy@example.com")!;
    expect(store.getStats(amy.id).totalGames).toBe(0);
    expect(store.listUserBestTimes(amy.id)).toHaveLength(0);
    expect(store.listUserBestScores(amy.id)).toHaveLength(0);
  });

  it("refuses production-looking environments and non-local paths", () => {
    const localRoots = ["/Users/dev/locato", "/tmp"];
    const ok = checkSeedSafety({ env: {}, databasePath: "/Users/dev/locato/.data/locato.db", localRoots });
    expect(ok).toEqual({ ok: true, path: "/Users/dev/locato/.data/locato.db" });

    expect(checkSeedSafety({ env: { NODE_ENV: "production" }, databasePath: "/tmp/dev.db", localRoots }).ok).toBe(false);
    expect(checkSeedSafety({ env: { FLY_APP_NAME: "locato" }, databasePath: "/tmp/dev.db", localRoots }).ok).toBe(false);
    expect(checkSeedSafety({ env: {}, databasePath: "/data/locato.db", localRoots: [...localRoots, "/"] }).ok).toBe(false);
    expect(checkSeedSafety({ env: {}, databasePath: "/data", localRoots: [...localRoots, "/"] }).ok).toBe(false);
    expect(checkSeedSafety({ env: {}, databasePath: "/srv/locato.db", localRoots }).ok).toBe(false);
    // "/database" is not the Fly volume just because it starts with "/data".
    expect(checkSeedSafety({ env: {}, databasePath: "/database/dev.db", localRoots: ["/database"] }).ok).toBe(true);
  });
});
