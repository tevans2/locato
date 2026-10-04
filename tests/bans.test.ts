import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest, ipBanResponse } from "../server/auth/routes";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../server/auth/cookies";
import { AdminService } from "../server/admin/AdminService";
import { setEventSink } from "../server/admin/events";
import { openDatabase, SqliteUserStore } from "../server/db/database";
import type { PasswordHasher, UserStore } from "../server/auth/types";

// The console's admin: an ADMIN_EMAILS account signed in with this session token.
const ADMIN = "admin-session-token";
const ADMIN_ID = "admin-root";
const ADMIN_IP = "10.0.0.1";
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const DAY = 86_400_000;
const BASE_URL = "http://localhost:3000";

const fakeHasher: PasswordHasher = {
  hash: async (password) => `hashed:${password}`,
  verify: async (password, hash) => hash === `hashed:${password}`,
};

function createHarness(store: UserStore = createMemoryUserStore()) {
  const clock = { value: NOW };
  const service = new AuthService(store, fakeHasher, { sessionTtlMs: 30 * DAY, clock: () => clock.value });
  const admin = new AdminService(store, { clock: () => clock.value, adminEmails: ["root@locato.test"] });
  store.createUser({ id: ADMIN_ID, email: "root@locato.test", displayName: "root", passwordHash: null, avatarUrl: null, createdAt: NOW - 365 * DAY });
  store.createSession({ id: ADMIN, userId: ADMIN_ID, expiresAt: NOW + 30 * DAY, createdAt: NOW - 365 * DAY });
  setEventSink((event) => store.recordEvent(event));
  const route = (request: Request) => handleAuthRequest(request, new URL(request.url), service, { secure: false }, BASE_URL, undefined, { service: admin, system: () => ({}) });
  return { clock, store, service, admin, route };
}
type Harness = ReturnType<typeof createHarness>;

function request(path: string, method = "GET", options: { body?: unknown; token?: string; ip?: string; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { "x-forwarded-for": options.ip ?? "203.0.113.5", ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.cookie = `${SESSION_COOKIE_NAME}=${options.token}`;
  return new Request(`http://localhost${path}`, { method, headers, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
}

const asAdmin = (path: string, method = "GET", body?: unknown) => request(path, method, { token: ADMIN, ip: ADMIN_IP, ...(body !== undefined ? { body } : {}) });

async function register(h: Harness, name: string, ip = "203.0.113.5"): Promise<{ id: string; token: string }> {
  const response = await h.route(request("/auth/register", "POST", { ip, body: { email: `${name}@b.com`, password: "supersecret", displayName: name } }));
  const token = parseCookieHeader(response!.headers.get("set-cookie"))[SESSION_COOKIE_NAME]!;
  return { id: h.service.authenticate(token)!.id, token };
}

const login = (h: Harness, name: string, ip = "203.0.113.5") => h.route(request("/auth/login", "POST", { ip, body: { email: `${name}@b.com`, password: "supersecret" } }));

afterEach(() => setEventSink(null));

describe("account bans", () => {
  it("signs a banned player out, keeps them out, hides their results, and unbanning restores it all", async () => {
    const h = createHarness();
    const cheat = await register(h, "cheat");
    const honest = await register(h, "honest");
    h.store.submitBestScore(cheat.id, { gameMode: "flyover", variant: "", score: 196, achievedAt: NOW });
    h.store.submitBestScore(honest.id, { gameMode: "flyover", variant: "", score: 40, achievedAt: NOW });
    const board = () => h.store.getScoreLeaderboard({ gameMode: "flyover", variant: "", limit: 10, offset: 0 }).map((entry) => entry.displayName);
    expect(board()).toEqual(["cheat", "honest"]);

    const banned = await h.route(asAdmin(`/api/admin/users/${cheat.id}/ban`, "PUT", { reason: "Posted 196 by hand" }));
    expect((await banned!.json()).ban).toMatchObject({ reason: "Posted 196 by hand", bannedBy: ADMIN_ID });
    expect(h.service.authenticate(cheat.token)).toBeNull();
    expect(h.store.listUserSessions(cheat.id, NOW)).toHaveLength(0);
    const refused = await login(h, "cheat");
    expect(refused?.status).toBe(403);
    expect((await refused!.json()).error).toBe("This account has been banned.");
    expect(board()).toEqual(["honest"]);
    expect(h.store.getUserScoreRank(honest.id, "flyover", "")?.rank).toBe(1);
    const listed = await (await h.route(asAdmin("/api/admin/users?q=cheat")))!.json();
    expect(listed.users[0].banned).toBe(true);

    expect((await h.route(asAdmin(`/api/admin/users/${cheat.id}/ban`, "DELETE")))?.status).toBe(200);
    expect((await login(h, "cheat"))?.status).toBe(200);
    expect(board()).toEqual(["cheat", "honest"]);
    const events = h.store.listEvents({ level: null, action: "admin.user.", ip: null, userId: null, before: null, limit: 10 }).map((event) => event.action);
    expect(events).toEqual(expect.arrayContaining(["admin.user.ban", "admin.user.unban"]));
  });

  it("won't ban yourself or another admin, and says so", async () => {
    const h = createHarness();
    const mod = await register(h, "mod");
    await h.route(asAdmin(`/api/admin/users/${mod.id}/admin`, "PUT", { admin: true }));
    expect((await h.route(asAdmin(`/api/admin/users/${ADMIN_ID}/ban`, "PUT", {})))?.status).toBe(409);
    expect((await h.route(asAdmin(`/api/admin/users/${mod.id}/ban`, "PUT", {})))?.status).toBe(409);
    expect((await h.route(asAdmin(`/api/admin/users/${mod.id}/ban`, "DELETE")))?.status).toBe(409);
    expect((await h.route(asAdmin("/api/admin/users/nobody/ban", "PUT", {})))?.status).toBe(404);
  });

  it("hides banned players from boards, ranks, placements and the daily on SQLite too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locato-bans-"));
    try {
      const store = new SqliteUserStore(openDatabase(join(dir, "locato.db")));
      const h = createHarness(store);
      const cheat = await register(h, "cheat");
      const honest = await register(h, "honest");
      store.submitBestTime(cheat.id, { gameMode: "flags", variant: "", timeMs: 10_000, achievedAt: NOW });
      store.submitBestTime(honest.id, { gameMode: "flags", variant: "", timeMs: 60_000, achievedAt: NOW });
      store.submitBestScore(cheat.id, { gameMode: "flyover", variant: "", score: 196, achievedAt: NOW });
      store.submitBestScore(honest.id, { gameMode: "flyover", variant: "", score: 40, achievedAt: NOW });
      const daily = { date: "2026-10-04", seed: "d", score: 90, timeMs: 60_000, hintsUsed: 0, marks: [], shareText: "", completedAt: NOW };
      store.saveDailyResult(cheat.id, daily);
      store.saveDailyResult(honest.id, daily);

      h.admin.banUser(ADMIN_ID, cheat.id, "test");
      expect(store.getLeaderboard({ gameMode: "flags", variant: "", limit: 10, offset: 0 }).map((entry) => entry.userId)).toEqual([honest.id]);
      expect(store.getUserRank(honest.id, "flags", "")?.rank).toBe(1);
      expect(store.getTimePlacement("flags", "", 30_000)).toEqual({ rank: 1, total: 1 });
      expect(store.getScoreLeaderboard({ gameMode: "flyover", variant: "", limit: 10, offset: 0 }).map((entry) => entry.userId)).toEqual([honest.id]);
      expect(store.getUserScoreRank(honest.id, "flyover", "")?.rank).toBe(1);
      expect(store.getScorePlacement("flyover", "", 100)).toEqual({ rank: 1, total: 1 });
      expect(store.listDailyResultsForDate("2026-10-04").map((row) => row.userId)).toEqual([honest.id]);
      expect(store.listBannedUsers()).toMatchObject([{ id: cheat.id, reason: "test" }]);

      h.admin.unbanUser(cheat.id);
      expect(store.getLeaderboard({ gameMode: "flags", variant: "", limit: 10, offset: 0 })).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("IP bans", () => {
  it("blocks sign-in, sign-up, the API and sockets from a banned address only", async () => {
    const h = createHarness();
    const player = await register(h, "player", "198.51.100.7");
    const added = await h.route(asAdmin("/api/admin/bans/ips", "POST", { ip: "198.51.100.7", reason: "alt farm", days: 3 }));
    expect((await added!.json()).ban).toMatchObject({ ip: "198.51.100.7", expiresAt: NOW + 3 * DAY });

    expect((await login(h, "player", "198.51.100.7"))?.status).toBe(403);
    expect((await h.route(request("/auth/register", "POST", { ip: "198.51.100.7", body: { email: "alt@b.com", password: "supersecret", displayName: "alt" } })))?.status).toBe(403);
    expect((await h.route(request("/api/leaderboard?gameMode=flags", "GET", { ip: "198.51.100.7", token: player.token })))?.status).toBe(403);
    expect(ipBanResponse(request("/ws", "GET", { ip: "198.51.100.7" }), new URL("http://localhost/ws"), h.service)?.status).toBe(403);
    expect(ipBanResponse(request("/", "GET", { ip: "198.51.100.7" }), new URL("http://localhost/"), h.service)).toBeNull();
    // Someone else is unaffected, and so is the same player from another network.
    expect((await login(h, "player", "192.0.2.44"))?.status).toBe(200);

    h.clock.value = NOW + 3 * DAY + 1; // expired
    expect((await login(h, "player", "198.51.100.7"))?.status).toBe(200);
  });

  it("trusts Fly-Client-IP over a spoofed X-Forwarded-For", async () => {
    const h = createHarness();
    await register(h, "player");
    h.admin.banIp(ADMIN_ID, ADMIN_IP, { ip: "198.51.100.7" });
    const spoofed = request("/auth/login", "POST", { ip: "192.0.2.1", headers: { "fly-client-ip": "198.51.100.7" }, body: { email: "player@b.com", password: "supersecret" } });
    expect((await h.route(spoofed))?.status).toBe(403);
  });

  it("lists, lifts and validates IP bans, and won't ban the admin's own address", async () => {
    const h = createHarness();
    expect((await h.route(asAdmin("/api/admin/bans/ips", "POST", { ip: ADMIN_IP })))?.status).toBe(409);
    expect((await h.route(asAdmin("/api/admin/bans/ips", "POST", { ip: "not-an-ip" })))?.status).toBe(400);
    expect((await h.route(asAdmin("/api/admin/bans/ips", "POST", { ip: "2001:db8::1", days: 0 })))?.status).toBe(400);
    expect((await h.route(asAdmin("/api/admin/bans/ips", "POST", { ip: "2001:db8::1" })))?.status).toBe(200);
    const bans = await (await h.route(asAdmin("/api/admin/bans")))!.json();
    expect(bans.ips).toMatchObject([{ ip: "2001:db8::1", expiresAt: null }]);
    expect((await h.route(asAdmin(`/api/admin/bans/ips/${encodeURIComponent("2001:db8::1")}`, "DELETE")))?.status).toBe(200);
    expect((await h.route(asAdmin(`/api/admin/bans/ips/${encodeURIComponent("2001:db8::1")}`, "DELETE")))?.status).toBe(404);
  });

  it("shows the addresses a player has used in their admin details", async () => {
    const h = createHarness();
    const player = await register(h, "player", "198.51.100.7");
    await login(h, "player", "192.0.2.44");
    h.admin.banIp(ADMIN_ID, ADMIN_IP, { ip: "198.51.100.7" });
    const detail = await (await h.route(asAdmin(`/api/admin/users/${player.id}`)))!.json();
    expect(detail.ips.map((row: { ip: string; banned: boolean }) => [row.ip, row.banned])).toEqual(expect.arrayContaining([["198.51.100.7", true], ["192.0.2.44", false]]));
    expect(detail.ban).toBeNull();
  });
});
