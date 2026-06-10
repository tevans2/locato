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

function route(service: AuthService, request: Request, adminToken: string | null = null): Promise<Response | null> {
  return handleAuthRequest(request, new URL(request.url), service, COOKIE_OPTS, BASE_URL, adminToken);
}

// Builds a request carrying the admin bearer token.
function adminRequest(path: string, method: string, token: string, body?: unknown): Request {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

describe("auth service", () => {
  it("registers a user, issues a session, and authenticates it", async () => {
    const { service } = createService();
    const result = await service.register({ email: "Ada@Example.com", password: "supersecret", displayName: "Ada" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.email).toBe("ada@example.com");
    expect(result.user.displayName).toBe("Ada");
    expect(service.authenticate(result.session.id)?.id).toBe(result.user.id);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    const { service } = createService();
    await service.register({ email: "a@b.com", password: "supersecret", displayName: "A" });

    expect(await service.register({ email: "a@b.com", password: "supersecret", displayName: "A" })).toMatchObject({ ok: false, status: 409 });
    expect(await service.register({ email: "c@d.com", password: "short", displayName: "C" })).toMatchObject({ ok: false, status: 400 });
    expect(await service.register({ email: "not-an-email", password: "supersecret", displayName: "A" })).toMatchObject({ ok: false, status: 400 });
  });

  it("logs in only with the correct password", async () => {
    const { service } = createService();
    await service.register({ email: "a@b.com", password: "supersecret", displayName: "A" });

    expect(await service.login({ email: "a@b.com", password: "supersecret" })).toMatchObject({ ok: true });
    expect(await service.login({ email: "a@b.com", password: "wrong" })).toMatchObject({ ok: false, status: 401 });
    expect(await service.login({ email: "ghost@b.com", password: "supersecret" })).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects password login for OAuth-only accounts", async () => {
    const { service } = createService();
    service.upsertOAuthUser("github", "gh_1", { email: "a@b.com", displayName: "Ada" });

    const result = await service.login({ email: "a@b.com", password: "supersecret" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("upserts an OAuth user and links accounts by email", async () => {
    const { service } = createService();
    const user1 = service.upsertOAuthUser("github", "gh_1", { email: "a@b.com", displayName: "Ada" });
    const user2 = service.upsertOAuthUser("github", "gh_1", { email: "a@b.com", displayName: "Ada" });
    expect(user1.id).toBe(user2.id);

    await service.register({ email: "b@b.com", password: "supersecret", displayName: "Bob" });
    const linkedUser = service.upsertOAuthUser("google", "gg_1", { email: "b@b.com", displayName: "Bob via Google" });
    const pwUser = await service.login({ email: "b@b.com", password: "supersecret" });
    expect(pwUser.ok).toBe(true);
    if (pwUser.ok) expect(linkedUser.id).toBe(pwUser.user.id);
  });

  it("expires sessions and clears them on logout", async () => {
    const { service, clock } = createService(1000);
    const registered = await service.register({ email: "a@b.com", password: "supersecret", displayName: "A" });
    if (!registered.ok) throw new Error("registration failed");

    clock.value = 1000 + 60 * 60 * 1000 + 1;
    expect(service.authenticate(registered.session.id)).toBeNull();

    clock.value = 1000;
    const again = await service.login({ email: "a@b.com", password: "supersecret" });
    if (!again.ok) throw new Error("login failed");
    service.logout(again.session.id);
    expect(service.authenticate(again.session.id)).toBeNull();
  });

  it("accumulates stats and keeps the best streak", async () => {
    const { service } = createService();
    const registered = await service.register({ email: "a@b.com", password: "supersecret", displayName: "A" });
    if (!registered.ok) throw new Error("registration failed");

    service.recordGame(registered.user.id, { mode: "solo", categoryIds: ["flags"], correctAnswers: 10, wrongAnswers: 2, score: 500, bestStreak: 5 });
    const stats = service.recordGame(registered.user.id, { mode: "solo", categoryIds: ["flags"], correctAnswers: 3, wrongAnswers: 1, score: 200, bestStreak: 3 });
    expect(stats).toMatchObject({ totalGames: 2, totalCorrect: 13, totalWrong: 3, bestStreak: 5, soloGames: 2 });
  });

  it("tracks world-map best time and best countries without polluting accuracy", async () => {
    const { service } = createService();
    const reg = await service.register({ email: "w@b.com", password: "supersecret", displayName: "W" });
    if (!reg.ok) throw new Error("registration failed");
    const uid = reg.user.id;
    const world = (extra: Record<string, unknown>) => ({ mode: "world-map" as const, categoryIds: ["world-map:name-all"], correctAnswers: 0, wrongAnswers: 0, score: 0, bestStreak: 0, ...extra });

    service.recordGame(uid, world({ completed: false, countriesFound: 50, countriesTotal: 196, playMode: "name-all" }));
    service.recordGame(uid, world({ completed: true, durationMs: 120_000, countriesFound: 196, countriesTotal: 196, playMode: "name-all" }));
    const fast = service.recordGame(uid, world({ completed: true, durationMs: 90_000, countriesFound: 196, countriesTotal: 196, playMode: "name-all" }));
    expect(fast.worldBestTimeMs).toBe(90_000); // MIN over completed runs

    // A slower completion must not worsen the best time.
    const slow = service.recordGame(uid, world({ completed: true, durationMs: 200_000, countriesFound: 196, countriesTotal: 196, playMode: "name-all" }));
    expect(slow.worldBestTimeMs).toBe(90_000);
    expect(slow.worldMapGames).toBe(4);
    expect(slow.worldMapCompletions).toBe(3);
    expect(slow.worldBestCountries).toBe(196);
    // World-map never feeds solo/multiplayer/overall accuracy aggregates.
    expect(slow.totalCorrect).toBe(0);
    expect(slow.totalWrong).toBe(0);
    expect(slow.soloGames).toBe(0);
    expect(slow.multiplayerGames).toBe(0);
  });

  it("excludes puzzle continents from world best time and best countries", async () => {
    const { service } = createService();
    const reg = await service.register({ email: "p@b.com", password: "supersecret", displayName: "P" });
    if (!reg.ok) throw new Error("registration failed");
    const stats = service.recordGame(reg.user.id, { mode: "world-map", categoryIds: ["world-map:puzzle"], correctAnswers: 0, wrongAnswers: 0, score: 0, bestStreak: 0, completed: true, durationMs: 30_000, countriesFound: 54, countriesTotal: 54, playMode: "puzzle" });
    expect(stats.worldMapGames).toBe(1);
    expect(stats.worldMapCompletions).toBe(1);
    expect(stats.worldBestTimeMs).toBe(0);   // puzzle time is not a full-world best
    expect(stats.worldBestCountries).toBe(0); // puzzle continents excluded
  });
});

describe("auth routes", () => {
  it("registers via HTTP, sets cookie, and serves /auth/me", async () => {
    const { service } = createService();
    const register = await route(service, jsonRequest("/auth/register", "POST", { email: "a@b.com", password: "supersecret", displayName: "A" }));
    if (!register) throw new Error("route not handled");
    expect(register.status).toBe(201);
    const token = tokenFrom(register);

    const me = await route(service, jsonRequest("/auth/me", "GET", undefined, token));
    expect(me?.status).toBe(200);
    expect((await me!.json()).user.email).toBe("a@b.com");

    expect((await route(service, jsonRequest("/auth/me", "GET")))?.status).toBe(401);
  });

  it("records a game and updates stats", async () => {
    const { service } = createService();
    const r = await route(service, jsonRequest("/auth/register", "POST", { email: "a@b.com", password: "supersecret", displayName: "A" }));
    const token = tokenFrom(r!);

    const resp = await route(service, jsonRequest("/api/games", "POST", { mode: "solo", categoryIds: ["flags"], correctAnswers: 7, wrongAnswers: 1, score: 300, bestStreak: 4 }, token));
    expect(resp?.status).toBe(200);
    expect((await resp!.json()).stats).toMatchObject({ totalGames: 1, totalCorrect: 7, soloGames: 1 });
  });

  it("falls through for unrelated routes", async () => {
    const { service } = createService();
    expect(await route(service, jsonRequest("/index.html", "GET"))).toBeNull();
    expect(await route(service, jsonRequest("/assets/flags/jp.svg", "GET"))).toBeNull();
  });
});

describe("admin account controls", () => {
  const ADMIN = "secret-admin-token";

  async function seedUser(service: AuthService, email: string): Promise<{ id: string; token: string }> {
    const r = await route(service, jsonRequest("/auth/register", "POST", { email, password: "supersecret", displayName: email.split("@")[0] }));
    const token = tokenFrom(r!);
    const me = await route(service, jsonRequest("/auth/me", "GET", undefined, token));
    return { id: (await me!.json()).user.id, token };
  }

  it("is hidden when no admin token is configured", async () => {
    const { service } = createService();
    // adminToken defaults to null → routes fall through to static handling.
    expect(await route(service, jsonRequest("/api/admin/users", "GET"))).toBeNull();
  });

  it("rejects missing or wrong admin credentials", async () => {
    const { service } = createService();
    expect((await route(service, jsonRequest("/api/admin/users", "GET"), ADMIN))?.status).toBe(403);
    expect((await route(service, adminRequest("/api/admin/users", "GET", "wrong"), ADMIN))?.status).toBe(403);
  });

  it("lists and searches users", async () => {
    const { service } = createService();
    await seedUser(service, "alice@b.com");
    await seedUser(service, "bob@b.com");

    const all = await route(service, adminRequest("/api/admin/users", "GET", ADMIN), ADMIN);
    const allBody = await all!.json();
    expect(allBody.total).toBe(2);
    expect(allBody.users).toHaveLength(2);
    expect(allBody.users[0]).not.toHaveProperty("passwordHash");
    expect(allBody.users[0].hasPassword).toBe(true);

    const filtered = await route(service, adminRequest("/api/admin/users?q=alice", "GET", ADMIN), ADMIN);
    const filteredBody = await filtered!.json();
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.users[0].email).toBe("alice@b.com");
  });

  it("returns user detail with stats", async () => {
    const { service } = createService();
    const { id } = await seedUser(service, "carol@b.com");
    service.recordGame(id, { mode: "solo", categoryIds: ["flags"], correctAnswers: 3, wrongAnswers: 1, score: 0, bestStreak: 2 });

    const resp = await route(service, adminRequest(`/api/admin/users/${id}`, "GET", ADMIN), ADMIN);
    expect(resp?.status).toBe(200);
    const body = await resp!.json();
    expect(body.user.email).toBe("carol@b.com");
    expect(body.user).not.toHaveProperty("passwordHash");
    expect(body.stats).toMatchObject({ totalGames: 1, totalCorrect: 3 });

    const missing = await route(service, adminRequest("/api/admin/users/nope", "GET", ADMIN), ADMIN);
    expect(missing?.status).toBe(404);
  });

  it("deletes a user and cascades their data", async () => {
    const { service } = createService();
    const { id, token } = await seedUser(service, "dave@b.com");
    service.recordGame(id, { mode: "solo", categoryIds: ["flags"], correctAnswers: 5, wrongAnswers: 0, score: 0, bestStreak: 5 });
    expect((await route(service, jsonRequest("/auth/me", "GET", undefined, token)))?.status).toBe(200);

    const del = await route(service, adminRequest(`/api/admin/users/${id}`, "DELETE", ADMIN), ADMIN);
    expect(del?.status).toBe(200);
    expect((await del!.json()).deleted).toBe(id);

    // Session no longer authenticates; detail is gone.
    expect((await route(service, jsonRequest("/auth/me", "GET", undefined, token)))?.status).toBe(401);
    expect((await route(service, adminRequest(`/api/admin/users/${id}`, "GET", ADMIN), ADMIN))?.status).toBe(404);

    // Deleting again reports not found.
    expect((await route(service, adminRequest(`/api/admin/users/${id}`, "DELETE", ADMIN), ADMIN))?.status).toBe(404);
  });

  it("revokes a user's sessions without deleting the account", async () => {
    const { service } = createService();
    const { id, token } = await seedUser(service, "erin@b.com");

    const resp = await route(service, adminRequest(`/api/admin/users/${id}/sessions`, "DELETE", ADMIN), ADMIN);
    expect(resp?.status).toBe(200);
    expect((await resp!.json()).revoked).toBe(1);

    // The old session is dead, but the account still exists.
    expect((await route(service, jsonRequest("/auth/me", "GET", undefined, token)))?.status).toBe(401);
    expect((await route(service, adminRequest(`/api/admin/users/${id}`, "GET", ADMIN), ADMIN))?.status).toBe(200);
  });
});
