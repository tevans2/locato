import { describe, expect, it } from "vitest";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../server/auth/cookies";
import type { PasswordHasher } from "../server/auth/types";

// Flyover intentionally trusts client totals again. This isolated test documents that
// tradeoff while preserving authentication, score bounds and all other ranked modes.
const hasher: PasswordHasher = {
  hash: async (password) => `test:${password}`,
  verify: async (password, hash) => hash === `test:${password}`,
};

async function harness() {
  const store = createMemoryUserStore();
  const service = new AuthService(store, hasher, {
    sessionTtlMs: 3_600_000,
    clock: () => 1_000, // No flight time elapses during any request.
    enforceRunAudit: true, // Existing audit enforcement does not protect Flyover.
  });
  async function request(path: string, method: string, body?: unknown, cookie?: string) {
    const req = new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const response = await handleAuthRequest(req, new URL(req.url), service, { secure: false }, "http://localhost");
    if (!response) throw new Error("Route not handled");
    return response;
  }
  const registered = await request("/auth/register", "POST", {
    email: "flyover-repro@example.test",
    password: "local-repro-password",
    displayName: "flyover_repro",
  });
  expect(registered.status).toBe(201);
  const { user } = await registered.json();
  const token = parseCookieHeader(registered.headers.get("set-cookie"))[SESSION_COOKIE_NAME];
  if (!token) throw new Error("Missing test session");
  return { store, request, userId: user.id as string, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

describe("Flyover score forgery — isolated vulnerability reproduction", () => {
  it.each([93, 159])("accepts a client-reported score of %i without starting or playing a flight", async (score) => {
    const { store, request, userId, cookie } = await harness();
    const posted = await request("/api/leaderboard", "POST", { gameMode: "flyover", variant: "", score }, cookie);
    expect(posted.status).toBe(200);
    const board = await request("/api/leaderboard?mode=flyover&variant=", "GET", undefined, cookie);
    expect(await board.json()).toMatchObject({
      metric: "score",
      entries: [{ score }],
      currentUser: { score },
    });
    expect(store.listUserRuns(userId, 30)).toEqual([]);
  });

  it.each([168, 196, 197, -1, 1.5])("rejects out-of-range/invalid score %i and unauthenticated submissions", async (score) => {
    const { request, cookie } = await harness();
    const tooHigh = await request("/api/leaderboard", "POST", { gameMode: "flyover", variant: "", score }, cookie);
    expect(tooHigh.status).toBe(400);
    expect(await tooHigh.json()).toEqual({ error: "Invalid ranked result." });
    const anonymous = await request("/api/leaderboard", "POST", { gameMode: "flyover", variant: "", score: 196 });
    expect(anonymous.status).toBe(401);
  });
});
