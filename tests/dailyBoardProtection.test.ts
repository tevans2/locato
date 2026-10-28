import { describe, expect, it } from "vitest";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../server/auth/cookies";
import { AdminService } from "../server/admin/AdminService";
import { assessDailyResult, createStartTicket, DAILY_MIN_PLAY_MS, readStartTicket } from "../server/daily/startTickets";
import type { PasswordHasher } from "../server/auth/types";

const DATE = "2026-10-28";
const NOW = Date.parse(`${DATE}T09:00:00Z`);
const fakeHasher: PasswordHasher = { hash: async (p) => `hashed:${p}`, verify: async (p, h) => h === `hashed:${p}` };

function harness() {
  const clock = { value: NOW };
  const store = createMemoryUserStore();
  const service = new AuthService(store, fakeHasher, { sessionTtlMs: 3_600_000, clock: () => clock.value });
  const request = (path: string, method: string, body?: unknown, token?: string) => {
    const headers: Record<string, string> = { "fly-client-ip": "41.0.0.1" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.cookie = `${SESSION_COOKIE_NAME}=${token}`;
    const req = new Request(`http://localhost${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return handleAuthRequest(req, new URL(req.url), service, { secure: false }, "http://localhost:3000");
  };
  const register = async (name: string) => {
    const response = await request("/auth/register", "POST", { email: `${name}@locato.test`, password: "supersecret", displayName: name });
    return parseCookieHeader(response!.headers.get("set-cookie")!)[SESSION_COOKIE_NAME]!;
  };
  const start = async () => ((await (await request("/api/daily/start", "POST", { date: DATE }))!.json()) as { ticket: string }).ticket;
  const submit = (token: string, result: { score: number; timeMs: number }, startTicket?: string) => request("/api/daily", "POST", {
    date: DATE, seed: `daily:${DATE}`, score: result.score, timeMs: result.timeMs, hintsUsed: 0,
    marks: Array(10).fill("correct"), shareText: "", completedAt: clock.value, ...(startTicket ? { startTicket } : {}),
  }, token);
  const board = async (token?: string) => ((await (await request(`/api/daily/leaderboard?date=${DATE}`, "GET", undefined, token))!.json()) as { entries: { rank: number; user: { username: string }; result: { score: number } }[] }).entries;
  return { clock, store, service, request, register, start, submit, board };
}

describe("daily start tickets", () => {
  it("round-trips and rejects tampering", () => {
    const ticket = createStartTicket("secret", DATE, NOW);
    expect(readStartTicket("secret", ticket)).toMatchObject({ date: DATE, startedAt: NOW });
    expect(readStartTicket("other-secret", ticket)).toBeNull();
    const parts = ticket.split(".");
    expect(readStartTicket("secret", [parts[0], parts[1], String(NOW - 600_000), parts[3], parts[4]].join("."))).toBeNull();
    expect(readStartTicket("secret", "nonsense")).toBeNull();
    expect(readStartTicket("secret", 42)).toBeNull();
  });

  it("judges a result against the time since Start", () => {
    const ticket = { date: DATE, startedAt: NOW, nonce: "abcdefghijkl" };
    const at = (ms: number) => NOW + ms;
    expect(assessDailyResult({ date: DATE, timeMs: 95_000 }, ticket, at(120_000), false)).toBeNull();
    // Breaks don't count as play, so claiming less than has passed is fine.
    expect(assessDailyResult({ date: DATE, timeMs: 95_000 }, ticket, at(6 * 3_600_000), false)).toBeNull();
    expect(assessDailyResult({ date: DATE, timeMs: 67 }, ticket, at(120_000), false)).toBe("too-fast");
    expect(assessDailyResult({ date: DATE, timeMs: 95_000 }, ticket, at(DAILY_MIN_PLAY_MS - 1), false)).toBe("too-fast");
    expect(assessDailyResult({ date: DATE, timeMs: 300_000 }, ticket, at(120_000), false)).toBe("time-mismatch");
    expect(assessDailyResult({ date: DATE, timeMs: 95_000 }, null, at(120_000), false)).toBe("no-start");
    expect(assessDailyResult({ date: "2026-10-27", timeMs: 95_000 }, ticket, at(120_000), false)).toBe("no-start");
    expect(assessDailyResult({ date: DATE, timeMs: 95_000 }, ticket, at(120_000), true)).toBe("start-reused");
  });
});

describe("daily leaderboard protection", () => {
  it("shows a real attempt to everyone", async () => {
    const h = harness();
    const ana = await h.register("ana");
    const ticket = await h.start();
    h.clock.value += 140_000;
    expect((await h.submit(ana, { score: 90, timeMs: 130_000 }, ticket))!.status).toBe(200);
    expect((await h.board()).map((entry) => entry.user.username)).toEqual(["ana"]);
  });

  it("keeps a scripted result off other boards but shows it to its player in place", async () => {
    const h = harness();
    const ana = await h.register("ana");
    const bot = await h.register("bot");
    const ticket = await h.start();
    h.clock.value += 140_000;
    await h.submit(ana, { score: 90, timeMs: 130_000 }, ticket);
    // No ticket at all, and a perfect score in 67 ms.
    expect((await h.submit(bot, { score: 100, timeMs: 67 }))!.status).toBe(200);
    expect((await h.board()).map((entry) => entry.user.username)).toEqual(["ana"]);
    expect((await h.board(ana)).map((entry) => entry.user.username)).toEqual(["ana"]);
    // The cheater sees nothing wrong: first place, as they'd expect.
    expect((await h.board(bot)).map((entry) => [entry.rank, entry.user.username])).toEqual([[1, "bot"], [2, "ana"]]);
  });

  it("hides results that claim more play than has passed, or reuse another account's ticket", async () => {
    const h = harness();
    const [ana, liar, copy] = [await h.register("ana"), await h.register("liar"), await h.register("copycat")];
    const shared = await h.start();
    const liarTicket = await h.start();
    h.clock.value += 60_000;
    await h.submit(ana, { score: 80, timeMs: 55_000 }, shared);
    await h.submit(liar, { score: 95, timeMs: 400_000 }, liarTicket);
    await h.submit(copy, { score: 100, timeMs: 58_000 }, shared);
    expect((await h.board()).map((entry) => entry.user.username)).toEqual(["ana"]);
  });

  it("leaves hidden results out of friends' summaries", async () => {
    const h = harness();
    const ana = await h.register("ana");
    const pal = await h.register("pal");
    await h.request("/api/friends/requests", "POST", { username: "pal" }, ana);
    const anaId = h.service.authenticate(ana)!.id;
    await h.request(`/api/friends/requests/${anaId}/accept`, "POST", undefined, pal);
    await h.submit(pal, { score: 100, timeMs: 5_000 });
    const summary = await (await h.request(`/api/daily/summary?date=${DATE}`, "GET", undefined, ana))!.json();
    expect(summary.summary.friendsToday).toEqual([]);
  });

  it("lets an admin show a hidden result, or hide one", async () => {
    const h = harness();
    const ana = await h.register("ana");
    const id = h.service.authenticate(ana)!.id;
    await h.submit(ana, { score: 70, timeMs: 140_000 });
    const admin = new AdminService(h.store, { clock: () => h.clock.value });
    expect(admin.daily(DATE)[0]!.hidden).toBe("no-start");
    expect(admin.setDailyHidden(id, DATE, false)).toBe(true);
    expect((await h.board()).length).toBe(1);
    expect(admin.setDailyHidden(id, DATE, true)).toBe(true);
    expect(admin.daily(DATE)[0]!.hidden).toBe("admin");
    expect((await h.board()).length).toBe(0);
    expect(admin.setDailyHidden("nobody", DATE, false)).toBe(false);
  });

  it("only issues tickets for today's daily and keeps the same key across restarts", async () => {
    const h = harness();
    expect((await h.request("/api/daily/start", "POST", { date: "2026-10-20" }))!.status).toBe(400);
    expect((await h.request("/api/daily/start", "POST", { date: "nope" }))!.status).toBe(400);
    const ticket = await h.start();
    // A new service on the same store (a deploy mid-game) still accepts the ticket.
    const restarted = new AuthService(h.store, fakeHasher, { sessionTtlMs: 3_600_000, clock: () => h.clock.value + 120_000 });
    const user = h.store.createUser({ id: "u-restart", email: "r@locato.test", displayName: "restart", passwordHash: null, avatarUrl: null, createdAt: NOW });
    restarted.saveDailyResult(user.id, { date: DATE, seed: `daily:${DATE}`, score: 60, timeMs: 100_000, hintsUsed: 0, marks: Array(10).fill("correct"), shareText: "", completedAt: NOW }, ticket);
    expect(h.store.listDailyReviews(DATE).get(user.id)?.hiddenReason).toBeNull();
  });
});
