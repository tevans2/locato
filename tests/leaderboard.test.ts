import { describe, expect, it } from "vitest";
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
    if ("error" in board) throw new Error(board.error);
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
});
