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

const COOKIE = { secure: false };

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
  return handleAuthRequest(request, new URL(request.url), service, COOKIE);
}

describe("auth service", () => {
  it("registers a user, issues a session, and authenticates it", async () => {
    const { service } = createService();
    const result = await service.register({ email: "Ada@Example.com ", password: "supersecret", displayName: "Ada" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.email).toBe("ada@example.com");
    expect(result.user.displayName).toBe("Ada");
    expect(service.authenticate(result.session.id)?.id).toBe(result.user.id);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    const { service } = createService();
    await service.register({ email: "a@b.com", password: "supersecret", displayName: "A" });

    expect(await service.register({ email: "a@b.com", password: "supersecret" })).toMatchObject({ ok: false, status: 409 });
    expect(await service.register({ email: "c@d.com", password: "short" })).toMatchObject({ ok: false, status: 400 });
    expect(await service.register({ email: "not-an-email", password: "supersecret" })).toMatchObject({ ok: false, status: 400 });
  });

  it("logs in only with the correct password", async () => {
    const { service } = createService();
    await service.register({ email: "a@b.com", password: "supersecret" });

    expect(await service.login({ email: "a@b.com", password: "supersecret" })).toMatchObject({ ok: true });
    expect(await service.login({ email: "a@b.com", password: "wrong-password" })).toMatchObject({ ok: false, status: 401 });
    expect(await service.login({ email: "ghost@b.com", password: "supersecret" })).toMatchObject({ ok: false, status: 401 });
  });

  it("expires sessions and clears them on logout", async () => {
    const { service, clock } = createService(1000);
    const registered = await service.register({ email: "a@b.com", password: "supersecret" });
    if (!registered.ok) throw new Error("registration failed");

    clock.value = 1000 + 60 * 60 * 1000 + 1; // just past TTL
    expect(service.authenticate(registered.session.id)).toBeNull();

    clock.value = 1000;
    const again = await service.login({ email: "a@b.com", password: "supersecret" });
    if (!again.ok) throw new Error("login failed");
    service.logout(again.session.id);
    expect(service.authenticate(again.session.id)).toBeNull();
  });

  it("accumulates stats per game and keeps the best streak", async () => {
    const { service } = createService();
    const registered = await service.register({ email: "a@b.com", password: "supersecret" });
    if (!registered.ok) throw new Error("registration failed");

    service.recordGame(registered.user.id, { correctAnswers: 10, wrongAnswers: 2, bestStreak: 5 });
    const stats = service.recordGame(registered.user.id, { correctAnswers: 3, wrongAnswers: 1, bestStreak: 3 });

    expect(stats).toEqual({ games: 2, correctAnswers: 13, wrongAnswers: 3, bestStreak: 5 });
  });
});

describe("auth routes", () => {
  it("registers via HTTP, sets a session cookie, and serves /auth/me", async () => {
    const { service } = createService();
    const register = await route(service, jsonRequest("/auth/register", "POST", { email: "a@b.com", password: "supersecret", displayName: "A" }));
    if (!register) throw new Error("route not handled");

    expect(register.status).toBe(201);
    const token = tokenFrom(register);

    const me = await route(service, jsonRequest("/auth/me", "GET", undefined, token));
    expect(me?.status).toBe(200);
    expect((await me!.json()).user.email).toBe("a@b.com");

    const anon = await route(service, jsonRequest("/auth/me", "GET"));
    expect(anon?.status).toBe(401);
  });

  it("guards /api/games behind authentication", async () => {
    const { service } = createService();
    const anon = await route(service, jsonRequest("/api/games", "POST", { correctAnswers: 1, wrongAnswers: 0, bestStreak: 1 }));
    expect(anon?.status).toBe(401);

    const register = await route(service, jsonRequest("/auth/register", "POST", { email: "a@b.com", password: "supersecret" }));
    const token = tokenFrom(register!);
    const recorded = await route(service, jsonRequest("/api/games", "POST", { correctAnswers: 4, wrongAnswers: 1, bestStreak: 4 }, token));
    expect(recorded?.status).toBe(200);
    expect((await recorded!.json()).stats).toMatchObject({ games: 1, correctAnswers: 4, bestStreak: 4 });
  });

  it("falls through (null) for non-auth routes", async () => {
    const { service } = createService();
    expect(await route(service, jsonRequest("/index.html", "GET"))).toBeNull();
  });
});
