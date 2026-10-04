import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../server/auth/cookies";
import type { PasswordHasher } from "../server/auth/types";

const fakeHasher: PasswordHasher = {
  hash: async (password) => `hashed:${password}`,
  verify: async (password, hash) => hash === `hashed:${password}`,
};

const COOKIE_OPTS = { secure: false };
const BASE_URL = "http://localhost:3000";

function createService(initialNow = 1000) {
  const clock = { value: initialNow };
  const store = createMemoryUserStore();
  const service = new AuthService(store, fakeHasher, { sessionTtlMs: 60 * 60 * 1000, clock: () => clock.value });
  // Trusted completed-game fixture for route formatting tests. rankedSecurity.test.ts uses real games.
  vi.spyOn(service.ranked, "consume").mockImplementation((_user, _run, mode, variant, value) => ({ mode, variant, value: value as number }));
  return { store, service, clock };
}

function tokenFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected a Set-Cookie header.");
  const token = parseCookieHeader(setCookie)[SESSION_COOKIE_NAME];
  if (!token) throw new Error("Expected a session token in the cookie.");
  return token;
}

function jsonRequest(path: string, method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.cookie = `${SESSION_COOKIE_NAME}=${token}`;
  return new Request(`http://localhost${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

function route(service: AuthService, request: Request): Promise<Response | null> {
  return handleAuthRequest(request, new URL(request.url), service, COOKIE_OPTS, BASE_URL);
}

describe("leaderboard", () => {
  it("accepts a best time and ranks users by fastest completion", async () => {
    const { service } = createService();
    const alice = await service.register({ email: "alice@b.com", password: "supersecret", displayName: "Alice" });
    const bob = await service.register({ email: "bob@b.com", password: "supersecret", displayName: "Bob" });
    if (!alice.ok || !bob.ok) throw new Error("registration failed");

    expect(service.submitBestTime(alice.user.id, { gameMode: "name-all", variant: "", timeMs: 120_000 })).toEqual({
      accepted: true,
      isPersonalBest: true,
    });
    expect(service.submitBestTime(bob.user.id, { gameMode: "name-all", variant: "", timeMs: 90_000 })).toEqual({
      accepted: true,
      isPersonalBest: true,
    });
    expect(service.submitBestTime(alice.user.id, { gameMode: "name-all", variant: "", timeMs: 100_000 })).toEqual({
      accepted: true,
      isPersonalBest: true,
    });
    expect(service.submitBestTime(alice.user.id, { gameMode: "name-all", variant: "", timeMs: 110_000 })).toEqual({
      accepted: false,
      isPersonalBest: false,
    });

    const board = service.getLeaderboard({ gameMode: "name-all", variant: "" });
    if ("error" in board || board.metric !== "time") throw new Error("expected a time board");
    expect(board.entries.map((entry) => entry.displayName)).toEqual(["Bob", "Alice"]);
    expect(board.entries[0]?.timeMs).toBe(90_000);
    expect(service.getUserLeaderboardRank(alice.user.id, "name-all", "")).toEqual({ rank: 2, timeMs: 100_000 });
  });

  it("requires a continent variant for puzzle mode", async () => {
    const { service } = createService();
    const registered = await service.register({ email: "a@b.com", password: "supersecret", displayName: "ace" });
    if (!registered.ok) throw new Error("registration failed");

    expect(service.submitBestTime(registered.user.id, { gameMode: "puzzle", variant: "", timeMs: 60_000 })).toEqual({
      error: "Invalid leaderboard variant.",
    });
    expect(service.submitBestTime(registered.user.id, { gameMode: "puzzle", variant: "Africa", timeMs: 60_000 })).toEqual({
      accepted: true,
      isPersonalBest: true,
    });
  });

  it("keeps country, territory, and combined flag timer boards separate", async () => {
    const { service } = createService();
    const registered = await service.register({ email: "flags@b.com", password: "supersecret", displayName: "flagster" });
    if (!registered.ok) throw new Error("registration failed");

    expect(service.submitBestTime(registered.user.id, { gameMode: "flags", variant: "territories", timeMs: 55_000 })).toEqual({
      accepted: true,
      isPersonalBest: true,
    });
    expect(service.submitBestTime(registered.user.id, { gameMode: "flags", variant: "both", timeMs: 75_000 })).toEqual({
      accepted: true,
      isPersonalBest: true,
    });
    expect(service.submitBestTime(registered.user.id, { gameMode: "flags", variant: "countries", timeMs: 50_000 })).toEqual({
      error: "Invalid leaderboard variant.",
    });

    const territories = service.getLeaderboard({ gameMode: "flags", variant: "territories" });
    const combined = service.getLeaderboard({ gameMode: "flags", variant: "both" });
    if ("error" in territories || "error" in combined || territories.metric !== "time" || combined.metric !== "time") throw new Error("flag leaderboard failed");
    expect(territories.entries[0]?.timeMs).toBe(55_000);
    expect(combined.entries[0]?.timeMs).toBe(75_000);
  });

  it("serves leaderboard data over HTTP", async () => {
    const { service } = createService();
    const register = await route(service, jsonRequest("/auth/register", "POST", { email: "a@b.com", password: "supersecret", displayName: "ace" }));
    const token = tokenFrom(register!);

    const submit = await route(
      service,
      jsonRequest("/api/leaderboard", "POST", { gameMode: "flags", variant: "", timeMs: 45_000 }, token),
    );
    expect(submit?.status).toBe(200);

    const board = await route(service, jsonRequest("/api/leaderboard?mode=flags&variant=", "GET", undefined, token));
    expect(board?.status).toBe(200);
    const data = (await board!.json()) as { entries: Array<{ displayName: string }>; currentUser: { rank: number } };
    expect(data.entries[0]?.displayName).toBe("ace");
    expect(data.currentUser.rank).toBe(1);
  });
  it("returns the player's rank with a submission and places any time on a board", async () => {
    const { service } = createService();
    const first = await route(service, jsonRequest("/auth/register", "POST", { email: "a@b.com", password: "supersecret", displayName: "ace" }));
    const second = await route(service, jsonRequest("/auth/register", "POST", { email: "b@b.com", password: "supersecret", displayName: "bee" }));
    const aceToken = tokenFrom(first!);
    const beeToken = tokenFrom(second!);

    await route(service, jsonRequest("/api/leaderboard", "POST", { gameMode: "puzzle", variant: "Europe", timeMs: 40_000 }, aceToken));
    const submit = await route(service, jsonRequest("/api/leaderboard", "POST", { gameMode: "puzzle", variant: "Europe", timeMs: 60_000 }, beeToken));
    expect(await submit!.json()).toEqual({ accepted: true, isPersonalBest: true, rank: 2, bestTimeMs: 60_000 });

    // A slower run is not accepted, but the response still reports the standing of the best.
    const slower = await route(service, jsonRequest("/api/leaderboard", "POST", { gameMode: "puzzle", variant: "Europe", timeMs: 90_000 }, beeToken));
    expect(await slower!.json()).toEqual({ accepted: false, isPersonalBest: false, rank: 2, bestTimeMs: 60_000 });

    const placement = async (query: string) => {
      const response = await route(service, jsonRequest(`/api/leaderboard/rank?${query}`, "GET"));
      return { status: response!.status, body: (await response!.json()) as unknown };
    };
    expect(await placement("mode=puzzle&variant=Europe&timeMs=30000")).toEqual({ status: 200, body: { rank: 1, total: 2 } });
    expect(await placement("mode=puzzle&variant=Europe&timeMs=50000")).toEqual({ status: 200, body: { rank: 2, total: 2 } });
    expect(await placement("mode=puzzle&variant=Europe&timeMs=60000")).toEqual({ status: 200, body: { rank: 2, total: 2 } });
    expect(await placement("mode=puzzle&variant=Europe&timeMs=99000")).toEqual({ status: 200, body: { rank: 3, total: 2 } });
    expect(await placement("mode=flags&variant=&timeMs=99000")).toEqual({ status: 200, body: { rank: 1, total: 0 } });

    expect((await placement("mode=puzzle&variant=Atlantis&timeMs=50000")).status).toBe(400);
    expect((await placement("mode=nope&variant=&timeMs=50000")).status).toBe(400);
    expect((await placement("mode=flag-colors&variant=&timeMs=50000")).status).toBe(200);
    expect((await placement("mode=puzzle&variant=Europe&timeMs=12.5")).status).toBe(400);
    expect((await placement("mode=puzzle&variant=Europe&timeMs=-4")).status).toBe(400);
    expect((await placement("mode=puzzle&variant=Europe")).status).toBe(400);
    expect((await placement("mode=puzzle&variant=Europe&timeMs=100")).status).toBe(400);
  });

  it("ranks score boards highest first, keeps only each player's best, and breaks ties by who got there first", async () => {
    const { service, clock } = createService();
    const names = ["ann", "ben", "cat"];
    const ids: string[] = [];
    for (const name of names) {
      const registered = await service.register({ email: `${name}@b.com`, password: "supersecret", displayName: name });
      if (!registered.ok) throw new Error("registration failed");
      ids.push(registered.user.id);
    }
    const [ann, ben, cat] = ids as [string, string, string];

    clock.value = 1_000;
    expect(service.submitBestTime(ann, { gameMode: "geoguessr", variant: "", score: 18_000 })).toEqual({ accepted: true, isPersonalBest: true });
    clock.value = 2_000;
    expect(service.submitBestTime(ben, { gameMode: "geoguessr", score: 21_000 })).toEqual({ accepted: true, isPersonalBest: true });
    clock.value = 3_000;
    // Same score as ann, later: ann keeps the higher place.
    expect(service.submitBestTime(cat, { gameMode: "geoguessr", score: 18_000 })).toEqual({ accepted: true, isPersonalBest: true });
    // Lower and equal scores never replace a best (and don't refresh achievedAt).
    clock.value = 4_000;
    expect(service.submitBestTime(ann, { gameMode: "geoguessr", score: 12_000 })).toEqual({ accepted: false, isPersonalBest: false });
    expect(service.submitBestTime(ann, { gameMode: "geoguessr", score: 18_000 })).toEqual({ accepted: false, isPersonalBest: false });

    const board = service.getLeaderboard({ gameMode: "geoguessr", variant: "" });
    if ("error" in board || board.metric !== "score") throw new Error("expected a score board");
    expect(board.entries.map((entry) => [entry.rank, entry.displayName, entry.score, entry.achievedAt])).toEqual([
      [1, "ben", 21_000, 2_000],
      [2, "ann", 18_000, 1_000],
      [3, "cat", 18_000, 3_000],
    ]);
    expect(service.getUserLeaderboardRank(cat, "geoguessr", "")).toEqual({ rank: 3, score: 18_000 });

    // A better score replaces the best and moves up.
    clock.value = 5_000;
    expect(service.submitBestTime(cat, { gameMode: "geoguessr", score: 25_000 })).toEqual({ accepted: true, isPersonalBest: true });
    expect(service.getUserLeaderboardRank(cat, "geoguessr", "")).toEqual({ rank: 1, score: 25_000 });
    // Boards are independent.
    expect(service.getLeaderboard({ gameMode: "map-tap", variant: "" })).toEqual({ metric: "score", entries: [] });
  });

  it("validates scores against the board's metric and maxScore", async () => {
    const { service, clock } = createService();
    const registered = await service.register({ email: "s@b.com", password: "supersecret", displayName: "scorer" });
    if (!registered.ok) throw new Error("registration failed");
    const id = registered.user.id;
    // Step past the per-player submission rate limit between attempts.
    const submit = (input: Record<string, unknown>) => {
      clock.value += 60_001;
      return service.submitBestTime(id, input);
    };

    expect(submit({ gameMode: "streetview-country", score: 15 })).toEqual({ accepted: true, isPersonalBest: true });
    expect(submit({ gameMode: "streetview-country", score: 16 })).toEqual({ error: "Invalid score." });
    expect(submit({ gameMode: "worldsplit", score: 501 })).toEqual({ error: "Invalid score." });
    expect(submit({ gameMode: "worldsplit", score: -1 })).toEqual({ error: "Invalid score." });
    expect(submit({ gameMode: "worldsplit", score: 12.5 })).toEqual({ error: "Invalid score." });
    expect(submit({ gameMode: "worldsplit", score: "300" })).toEqual({ error: "Invalid score." });
    expect(submit({ gameMode: "worldsplit" })).toEqual({ error: "Invalid score." });
    expect(submit({ gameMode: "worldsplit", score: 0 })).toEqual({ accepted: true, isPersonalBest: true });
    expect(submit({ gameMode: "map-tap", score: 50_000 })).toEqual({ accepted: true, isPersonalBest: true });
    expect(submit({ gameMode: "map-tap", variant: "Europe", score: 100 })).toEqual({ error: "Invalid leaderboard variant." });
    // Wrong metric for the board.
    expect(submit({ gameMode: "map-tap", timeMs: 60_000 })).toEqual({ error: "This leaderboard ranks scores, not times." });
    expect(submit({ gameMode: "flags", score: 100 })).toEqual({ error: "This leaderboard ranks times, not scores." });
    // Flag colours is a time board now.
    expect(submit({ gameMode: "flag-colors", timeMs: 60_000 })).toEqual({ accepted: true, isPersonalBest: true });
  });

  it("serves score boards over HTTP: board, submission standing and placement", async () => {
    const { service } = createService();
    const first = await route(service, jsonRequest("/auth/register", "POST", { email: "a@b.com", password: "supersecret", displayName: "ace" }));
    const second = await route(service, jsonRequest("/auth/register", "POST", { email: "b@b.com", password: "supersecret", displayName: "bee" }));
    const aceToken = tokenFrom(first!);
    const beeToken = tokenFrom(second!);

    const post = async (body: unknown, token: string) => {
      const response = await route(service, jsonRequest("/api/leaderboard", "POST", body, token));
      return { status: response!.status, body: (await response!.json()) as unknown };
    };
    expect(await post({ gameMode: "map-tap", variant: "", score: 40_000 }, aceToken)).toEqual({ status: 200, body: { accepted: true, isPersonalBest: true, rank: 1, bestScore: 40_000 } });
    expect(await post({ gameMode: "map-tap", variant: "", score: 30_000 }, beeToken)).toEqual({ status: 200, body: { accepted: true, isPersonalBest: true, rank: 2, bestScore: 30_000 } });
    expect(await post({ gameMode: "map-tap", variant: "", score: 20_000 }, beeToken)).toEqual({ status: 200, body: { accepted: false, isPersonalBest: false, rank: 2, bestScore: 30_000 } });
    expect((await post({ gameMode: "map-tap", variant: "", timeMs: 60_000 }, beeToken)).status).toBe(400);
    expect((await post({ gameMode: "map-tap", variant: "", score: 50_001 }, beeToken)).status).toBe(400);
    expect((await post({ gameMode: "flags", variant: "", score: 10 }, beeToken)).status).toBe(400);

    const board = await route(service, jsonRequest("/api/leaderboard?mode=map-tap&variant=", "GET", undefined, beeToken));
    expect(await board!.json()).toEqual({
      metric: "score",
      entries: [
        { rank: 1, userId: expect.any(String), displayName: "ace", avatarEmoji: null, score: 40_000, achievedAt: 1000 },
        { rank: 2, userId: expect.any(String), displayName: "bee", avatarEmoji: null, score: 30_000, achievedAt: 1000 },
      ],
      currentUser: { rank: 2, score: 30_000 },
    });
    const timeBoard = await route(service, jsonRequest("/api/leaderboard?mode=flags&variant=", "GET"));
    expect(await timeBoard!.json()).toEqual({ metric: "time", entries: [], currentUser: null });

    const placement = async (query: string) => {
      const response = await route(service, jsonRequest(`/api/leaderboard/rank?${query}`, "GET"));
      return { status: response!.status, body: (await response!.json()) as unknown };
    };
    expect(await placement("mode=map-tap&variant=&score=45000")).toEqual({ status: 200, body: { rank: 1, total: 2 } });
    expect(await placement("mode=map-tap&variant=&score=40000")).toEqual({ status: 200, body: { rank: 1, total: 2 } });
    expect(await placement("mode=map-tap&variant=&score=35000")).toEqual({ status: 200, body: { rank: 2, total: 2 } });
    expect(await placement("mode=map-tap&variant=&score=0")).toEqual({ status: 200, body: { rank: 3, total: 2 } });
    expect((await placement("mode=map-tap&variant=&score=50001")).status).toBe(400);
    expect((await placement("mode=map-tap&variant=&score=1.5")).status).toBe(400);
    expect((await placement("mode=map-tap&variant=")).status).toBe(400);
    expect((await placement("mode=map-tap&variant=&timeMs=60000")).status).toBe(400);
    expect((await placement("mode=flags&variant=&score=10")).status).toBe(400);
  });

  it("removes a deleted user's best scores", async () => {
    const { service, store } = createService();
    const registered = await service.register({ email: "gone@b.com", password: "supersecret", displayName: "gone" });
    if (!registered.ok) throw new Error("registration failed");
    service.submitBestTime(registered.user.id, { gameMode: "worldsplit", score: 400 });
    expect(store.listUserBestScores(registered.user.id)).toHaveLength(1);
    expect(store.deleteUser(registered.user.id)).toBe(true);
    expect(store.getScoreLeaderboard({ gameMode: "worldsplit", variant: "", limit: 10, offset: 0 })).toEqual([]);
    expect(store.getAdminTotals(0).bestScores).toBe(0);
  });
});
