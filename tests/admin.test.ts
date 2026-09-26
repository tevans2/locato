import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest, resetAdminLockouts } from "../server/auth/routes";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../server/auth/cookies";
import { AdminService, type AdminRoomsBridge } from "../server/admin/AdminService";
import { setEventSink } from "../server/admin/events";
import { RoomManager, type MultiplayerConnection } from "../server/rooms/RoomManager";
import { indexCountries, type RawCountry } from "../src/core/countries";
import type { DailyChallengeResult, PasswordHasher, UserStore } from "../server/auth/types";
import type { ServerMessage } from "../src/core/multiplayer";

const ADMIN = "secret-admin-token";
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const COOKIE_OPTS = { secure: false };
const BASE_URL = "http://localhost:3000";

const fakeHasher: PasswordHasher = {
  hash: async (password) => `hashed:${password}`,
  verify: async (password, hash) => hash === `hashed:${password}`,
};

interface Harness {
  readonly store: UserStore;
  readonly service: AuthService;
  readonly admin: AdminService;
  readonly clock: { value: number };
  route(request: Request, adminToken?: string | null): Promise<Response | null>;
}

function createHarness(options: { rooms?: AdminRoomsBridge; online?: string[] } = {}): Harness {
  const clock = { value: NOW };
  const store = createMemoryUserStore();
  const service = new AuthService(store, fakeHasher, { sessionTtlMs: 60 * 60 * 1000, clock: () => clock.value });
  const admin = new AdminService(store, {
    clock: () => clock.value,
    ...(options.rooms ? { rooms: options.rooms } : {}),
    presence: { onlineUserIds: () => options.online ?? [] },
  });
  setEventSink((event) => store.recordEvent(event));
  return {
    store,
    service,
    admin,
    clock,
    route: (request, adminToken = ADMIN) =>
      handleAuthRequest(request, new URL(request.url), service, COOKIE_OPTS, BASE_URL, adminToken, undefined, { service: admin, system: () => ({ uptimeSeconds: 42 }) }),
  };
}

function jsonRequest(path: string, method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.cookie = `${SESSION_COOKIE_NAME}=${token}`;
  return new Request(`http://localhost${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

function adminRequest(path: string, method = "GET", body?: unknown, token = ADMIN, ip = "10.0.0.1"): Request {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "x-forwarded-for": ip };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function seedUser(h: Harness, email: string): Promise<{ id: string; token: string }> {
  const response = await h.route(jsonRequest("/auth/register", "POST", { email, password: "supersecret", displayName: email.split("@")[0] }));
  const token = parseCookieHeader(response!.headers.get("set-cookie"))[SESSION_COOKIE_NAME]!;
  const me = await h.route(jsonRequest("/auth/me", "GET", undefined, token));
  return { id: (await me!.json()).user.id, token };
}

function daily(date: string, overrides: Partial<DailyChallengeResult> = {}): DailyChallengeResult {
  return {
    date,
    seed: `daily:${date}`,
    score: 80,
    timeMs: 120_000,
    hintsUsed: 0,
    marks: Array.from({ length: 10 }, () => "correct" as const),
    shareText: "",
    completedAt: Date.parse(`${date}T10:00:00.000Z`),
    ...overrides,
  };
}

async function body(response: Response | null): Promise<any> {
  expect(response).not.toBeNull();
  return response!.json();
}

beforeEach(() => resetAdminLockouts());
afterEach(() => setEventSink(null));

describe("admin gate", () => {
  it("is hidden when no admin token is configured", async () => {
    const h = createHarness();
    expect(await h.route(jsonRequest("/api/admin/users", "GET"), null)).toBeNull();
  });

  it("rejects missing or wrong credentials and records the attempt", async () => {
    const h = createHarness();
    expect((await h.route(jsonRequest("/api/admin/users", "GET")))?.status).toBe(403);
    expect((await h.route(adminRequest("/api/admin/users", "GET", undefined, "wrong")))?.status).toBe(403);
    expect(h.store.listEvents({ level: "warn", action: "admin.unauthorized", ip: null, userId: null, before: null, limit: 10 })).toHaveLength(2);
  });

  it("locks an IP out after repeated wrong tokens, even if it then guesses right", async () => {
    const h = createHarness();
    for (let i = 0; i < 10; i += 1) await h.route(adminRequest("/api/admin/session", "GET", undefined, "wrong", "6.6.6.6"));
    expect((await h.route(adminRequest("/api/admin/session", "GET", undefined, ADMIN, "6.6.6.6")))?.status).toBe(429);
    // Other callers are unaffected.
    expect((await h.route(adminRequest("/api/admin/session", "GET", undefined, ADMIN, "7.7.7.7")))?.status).toBe(200);
  });

  it("marks admin responses as uncacheable", async () => {
    const h = createHarness();
    const response = await h.route(adminRequest("/api/admin/session"));
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });
});

describe("admin users", () => {
  it("lists users with auth, activity, and daily counts", async () => {
    const h = createHarness();
    const alice = await seedUser(h, "alice@b.com");
    await seedUser(h, "bob@b.com");
    h.service.recordGame(alice.id, { mode: "solo", categoryIds: ["flags"], correctAnswers: 3, wrongAnswers: 1, score: 3, bestStreak: 2 });
    h.store.saveDailyResult(alice.id, daily("2026-09-25"));

    const all = await body(await h.route(adminRequest("/api/admin/users")));
    expect(all.total).toBe(2);
    const row = all.users.find((u: { email: string }) => u.email === "alice@b.com");
    expect(row).not.toHaveProperty("passwordHash");
    expect(row).toMatchObject({ hasPassword: true, providers: [], games: 1, dailies: 1 });
    expect(row.lastActiveAt).toBeGreaterThan(0);

    const filtered = await body(await h.route(adminRequest("/api/admin/users?q=bob")));
    expect(filtered.users.map((u: { email: string }) => u.email)).toEqual(["bob@b.com"]);
  });

  it("returns a full user dossier without session tokens", async () => {
    const h = createHarness({ online: [] });
    const carol = await seedUser(h, "carol@b.com");
    h.service.recordGame(carol.id, { mode: "solo", categoryIds: ["flags"], correctAnswers: 3, wrongAnswers: 1, score: 3, bestStreak: 2 });
    h.store.submitBestTime(carol.id, { gameMode: "flags", variant: "", timeMs: 9_000, achievedAt: NOW });

    const detail = await body(await h.route(adminRequest(`/api/admin/users/${carol.id}`)));
    expect(detail.user).toMatchObject({ email: "carol@b.com", hasPassword: true });
    expect(detail.user).not.toHaveProperty("passwordHash");
    expect(detail.stats).toMatchObject({ totalGames: 1, totalCorrect: 3 });
    expect(detail.recentGames).toHaveLength(1);
    expect(detail.bestTimes).toEqual([{ gameMode: "flags", variant: "", timeMs: 9_000, achievedAt: NOW, suspicious: true }]);
    expect(detail.sessions).toHaveLength(1);
    expect(Object.keys(detail.sessions[0]).sort()).toEqual(["createdAt", "expiresAt"]);
    expect(JSON.stringify(detail)).not.toContain(carol.token);
    expect(detail.events.map((e: { action: string }) => e.action)).toContain("register.ok");

    expect((await h.route(adminRequest("/api/admin/users/nope")))?.status).toBe(404);
  });

  it("renames a user, enforcing username rules and uniqueness", async () => {
    const h = createHarness();
    const dave = await seedUser(h, "dave@b.com");
    await seedUser(h, "erin@b.com");

    expect((await h.route(adminRequest(`/api/admin/users/${dave.id}`, "PATCH", { displayName: "no spaces" })))?.status).toBe(400);
    expect((await h.route(adminRequest(`/api/admin/users/${dave.id}`, "PATCH", { displayName: "ERIN" })))?.status).toBe(409);

    const renamed = await body(await h.route(adminRequest(`/api/admin/users/${dave.id}`, "PATCH", { displayName: "renamed_player" })));
    expect(renamed.user.displayName).toBe("renamed_player");
    expect(h.store.findUserById(dave.id)?.displayName).toBe("renamed_player");
    expect(h.store.listEvents({ level: null, action: "admin.user.update", ip: null, userId: null, before: null, limit: 5 })).toHaveLength(1);
  });

  it("clears an avatar emoji", async () => {
    const h = createHarness();
    const user = await seedUser(h, "frank@b.com");
    h.store.updateAvatarEmoji(user.id, "🔥");
    await h.route(adminRequest(`/api/admin/users/${user.id}`, "PATCH", { clearAvatar: true }));
    expect(h.store.findUserById(user.id)?.avatarEmoji).toBeNull();
  });

  it("deletes a user and cascades their data", async () => {
    const h = createHarness();
    const { id, token } = await seedUser(h, "gina@b.com");
    h.store.saveDailyResult(id, daily("2026-09-25"));

    const del = await h.route(adminRequest(`/api/admin/users/${id}`, "DELETE"));
    expect((await body(del)).deleted).toBe(id);
    expect((await h.route(jsonRequest("/auth/me", "GET", undefined, token)))?.status).toBe(401);
    expect(h.store.listDailyResultsForDate("2026-09-25")).toEqual([]);
    expect((await h.route(adminRequest(`/api/admin/users/${id}`, "DELETE")))?.status).toBe(404);
  });

  it("revokes sessions without deleting the account", async () => {
    const h = createHarness();
    const { id, token } = await seedUser(h, "hank@b.com");
    expect((await body(await h.route(adminRequest(`/api/admin/users/${id}/sessions`, "DELETE")))).revoked).toBe(1);
    expect((await h.route(jsonRequest("/auth/me", "GET", undefined, token)))?.status).toBe(401);
    expect((await h.route(adminRequest(`/api/admin/users/${id}`)))?.status).toBe(200);
  });

  it("resets game stats but keeps leaderboards and dailies", async () => {
    const h = createHarness();
    const { id } = await seedUser(h, "ivy@b.com");
    h.service.recordGame(id, { mode: "solo", categoryIds: ["flags"], correctAnswers: 900, wrongAnswers: 0, score: 900, bestStreak: 900 });
    h.store.saveDailyResult(id, daily("2026-09-25"));

    expect((await h.route(adminRequest(`/api/admin/users/${id}/stats`, "DELETE")))?.status).toBe(200);
    expect(h.store.getStats(id).totalGames).toBe(0);
    expect(h.store.getFullStats(id).recentGames).toEqual([]);
    expect(h.store.getDailyResult(id, "2026-09-25")).not.toBeNull();
  });
});

describe("admin moderation", () => {
  it("flags and removes suspicious best times", async () => {
    const h = createHarness();
    const fast = await seedUser(h, "fast@b.com");
    const real = await seedUser(h, "real@b.com");
    h.store.submitBestTime(fast.id, { gameMode: "flags", variant: "", timeMs: 9_000, achievedAt: NOW });
    h.store.submitBestTime(real.id, { gameMode: "flags", variant: "", timeMs: 240_000, achievedAt: NOW });

    const board = await body(await h.route(adminRequest("/api/admin/leaderboards?mode=flags&variant=")));
    expect(board.entries.map((e: { userId: string; suspicious: boolean }) => [e.userId, e.suspicious])).toEqual([[fast.id, true], [real.id, false]]);
    expect((await h.route(adminRequest("/api/admin/leaderboards?mode=nope")))?.status).toBe(400);

    expect((await h.route(adminRequest(`/api/admin/leaderboards/${fast.id}?mode=flags&variant=`, "DELETE")))?.status).toBe(200);
    expect(h.store.getLeaderboard({ gameMode: "flags", variant: "", limit: 10, offset: 0 }).map((e) => e.userId)).toEqual([real.id]);
    expect((await h.route(adminRequest(`/api/admin/leaderboards/${fast.id}?mode=flags&variant=`, "DELETE")))?.status).toBe(404);
  });

  it("lists leaderboard modes and variants", async () => {
    const h = createHarness();
    const meta = await body(await h.route(adminRequest("/api/admin/leaderboards/meta")));
    const flags = meta.modes.find((m: { id: string }) => m.id === "flags");
    expect(flags.variants).toContain("");
    expect(flags.variants).not.toContain("countries");
    expect(meta.modes.find((m: { id: string }) => m.id === "puzzle").variants).toContain("Europe");
  });

  it("flags too-fast and backdated daily results and removes them", async () => {
    const h = createHarness();
    const bot = await seedUser(h, "bot@b.com");
    const late = await seedUser(h, "late@b.com");
    const human = await seedUser(h, "human@b.com");
    h.store.saveDailyResult(bot.id, daily("2026-09-24", { score: 100, timeMs: 67 }));
    h.store.saveDailyResult(late.id, daily("2026-09-24", { completedAt: Date.parse("2026-09-27T10:00:00.000Z") }));
    h.store.saveDailyResult(human.id, daily("2026-09-24", { score: 91 }));

    const board = await body(await h.route(adminRequest("/api/admin/daily?date=2026-09-24")));
    expect(board.entries.map((e: { user: { id: string }; flags: string[] }) => [e.user.id, e.flags])).toEqual([
      [bot.id, ["too-fast"]],
      [human.id, []],
      [late.id, ["backdated"]],
    ]);
    expect((await h.route(adminRequest("/api/admin/daily?date=bad")))?.status).toBe(400);

    expect((await h.route(adminRequest(`/api/admin/daily/${bot.id}/2026-09-24`, "DELETE")))?.status).toBe(200);
    expect(h.store.getDailyResult(bot.id, "2026-09-24")).toBeNull();
    expect((await h.route(adminRequest(`/api/admin/daily/${bot.id}/2026-09-24`, "DELETE")))?.status).toBe(404);
  });
});

describe("admin overview", () => {
  it("aggregates activity windows, a 30-day series, modes, and top players", async () => {
    const h = createHarness({ online: ["someone"] });
    h.clock.value = NOW - 40 * DAY;
    const old = await seedUser(h, "old@b.com");
    h.clock.value = NOW - 2 * DAY;
    const recent = await seedUser(h, "recent@b.com");
    h.clock.value = NOW;
    h.service.recordGame(recent.id, { mode: "solo", categoryIds: ["flags"], correctAnswers: 1, wrongAnswers: 0, score: 1, bestStreak: 1 });
    h.service.recordGame(recent.id, { mode: "multiplayer", categoryIds: ["flags"], correctAnswers: 1, wrongAnswers: 0, score: 1, bestStreak: 1, rank: 1, totalPlayers: 2 });
    h.store.saveDailyResult(old.id, daily("2026-09-25", { completedAt: NOW - 1000 }));

    const overview = await body(await h.route(adminRequest("/api/admin/overview")));
    expect(overview.totals).toMatchObject({ users: 2, games: 2, dailies: 1 });
    expect(overview.live.onlineUsers).toBe(1);
    expect(overview.windows.month).toMatchObject({ signups: 1, games: 2, dailies: 1, activeUsers: 2 });
    expect(overview.windows.previousMonth.signups).toBe(1);
    expect(overview.series).toHaveLength(30);
    expect(overview.series.at(-1)).toMatchObject({ date: "2026-09-25", games: 2, dailies: 1 });
    expect(overview.modes.map((m: { mode: string }) => m.mode).sort()).toEqual(["multiplayer", "solo"]);
    expect(overview.topPlayers[0].user.id).toBe(recent.id);
  });

  it("returns the system snapshot from the host", async () => {
    const h = createHarness();
    expect(await body(await h.route(adminRequest("/api/admin/system")))).toEqual({ uptimeSeconds: 42 });
  });
});

describe("admin events", () => {
  it("records structured log events and filters them", async () => {
    const h = createHarness();
    await seedUser(h, "jay@b.com");
    await h.route(jsonRequest("/auth/login", "POST", { email: "jay@b.com", password: "wrong-password" }));

    const all = await body(await h.route(adminRequest("/api/admin/events")));
    expect(all.events[0].action).toBe("login.failed");
    const warns = await body(await h.route(adminRequest("/api/admin/events?level=warn")));
    expect(warns.events.every((e: { level: string }) => e.level === "warn")).toBe(true);
    const registers = await body(await h.route(adminRequest("/api/admin/events?action=register")));
    expect(registers.events.map((e: { action: string }) => e.action)).toEqual(["register.ok"]);
    expect(registers.events[0].details.email).toBe("jay@b.com");
  });

  it("pages backwards with the before cursor", async () => {
    const h = createHarness();
    for (const email of ["amy1@b.com", "amy2@b.com", "amy3@b.com"]) await seedUser(h, email);
    const first = await body(await h.route(adminRequest("/api/admin/events?action=register&limit=2")));
    expect(first.events).toHaveLength(2);
    const next = await body(await h.route(adminRequest(`/api/admin/events?action=register&limit=2&before=${first.events[1].id}`)));
    expect(next.events.map((e: { details: { email: string } }) => e.details.email)).toEqual(["amy1@b.com"]);
  });
});

class TestConnection implements MultiplayerConnection {
  readonly messages: ServerMessage[] = [];
  readonly authenticatedName = null;
  send(message: string): void {
    this.messages.push(JSON.parse(message) as ServerMessage);
  }
}

describe("admin rooms", () => {
  const countries = [
    { name: "Japan", code: "JP", aliases: [], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
    { name: "Brazil", code: "BR", aliases: [], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: [] },
  ] as const satisfies readonly RawCountry[];

  it("lists live rooms and closes one, telling its players", async () => {
    const manager = new RoomManager({ countryIndex: indexCountries(countries) });
    const host = new TestConnection();
    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, NOW);
    const h = createHarness({ rooms: manager });

    const listed = await body(await h.route(adminRequest("/api/admin/rooms")));
    expect(listed.rooms).toHaveLength(1);
    const room = listed.rooms[0];
    expect(room).toMatchObject({ kind: "quiz", status: "lobby", players: [{ name: "Host", connected: true, isHost: true }] });
    expect(JSON.stringify(room)).not.toMatch(/sessionToken|chat/i);

    expect((await h.route(adminRequest(`/api/admin/rooms/${room.code}`, "DELETE")))?.status).toBe(200);
    expect(manager.listRooms()).toEqual([]);
    expect(host.messages.at(-1)).toMatchObject({ type: "ERROR", code: "room-not-found" });
    expect((await h.route(adminRequest(`/api/admin/rooms/${room.code}`, "DELETE")))?.status).toBe(404);
  });
});
