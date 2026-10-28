import { describe, expect, it } from "vitest";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../server/auth/cookies";
import { AdminService } from "../server/admin/AdminService";
import type { PasswordHasher } from "../server/auth/types";

const DATE = "2026-10-28";
const NOW = Date.parse(`${DATE}T09:00:00Z`);
const fakeHasher: PasswordHasher = { hash: async (p) => `hashed:${p}`, verify: async (p, h) => h === `hashed:${p}` };

// The guest limiter is per address and shared across tests, so each harness gets its own.
let nextIp = 1;

function harness() {
  const clock = { value: NOW };
  const store = createMemoryUserStore();
  const service = new AuthService(store, fakeHasher, { sessionTtlMs: 3_600_000, clock: () => clock.value });
  const ip = `41.1.0.${nextIp++}`;
  const request = (path: string, method: string, body?: unknown, token?: string, from = ip) => {
    const headers: Record<string, string> = { "fly-client-ip": from };
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
  const result = (score: number, timeMs: number, startTicket?: string) => ({
    date: DATE, seed: `daily:${DATE}`, score, timeMs, hintsUsed: 0, marks: Array(10).fill("correct"), shareText: "", completedAt: clock.value,
    ...(startTicket ? { startTicket } : {}),
  });
  const postGuest = (name: string, score: number, timeMs: number, startTicket?: string) => request("/api/daily/guest", "POST", { ...result(score, timeMs, startTicket), name });
  const submit = (token: string, score: number, timeMs: number, startTicket?: string) => request("/api/daily", "POST", result(score, timeMs, startTicket), token);
  const board = async () => ((await (await request(`/api/daily/leaderboard?date=${DATE}`, "GET"))!.json()) as { entries: { rank: number; guest?: true; user: { id: string; username: string }; result: { score: number } }[] }).entries;
  return { clock, store, service, request, register, start, postGuest, submit, board };
}

describe("posting the daily with just a name", () => {
  it("puts a checked guest result on the board, marked as a guest", async () => {
    const h = harness();
    const ana = await h.register("ana");
    const anaTicket = await h.start();
    const guestTicket = await h.start();
    h.clock.value += 140_000;
    await h.submit(ana, 80, 130_000, anaTicket);
    const response = await h.postGuest("Sam", 90, 120_000, guestTicket);
    expect(response!.status).toBe(200);
    const { entry } = (await response!.json()) as { entry: { id: string; name: string } };
    expect(entry.name).toBe("Sam");
    const board = await h.board();
    expect(board.map((row) => [row.rank, row.user.username, row.guest ?? false])).toEqual([[1, "Sam", true], [2, "ana", false]]);
    expect(board[0]!.user.id).toBe(`guest:${entry.id}`);
  });

  it("needs a start ticket, a valid name and today's date", async () => {
    const h = harness();
    await h.register("ana");
    const ticket = await h.start();
    h.clock.value += 140_000;
    expect((await h.postGuest("Sam", 90, 120_000))!.status).toBe(400);
    expect((await h.postGuest("x", 90, 120_000, ticket))!.status).toBe(400);
    expect((await h.postGuest("no spaces", 90, 120_000, ticket))!.status).toBe(400);
    // An account's name can't be borrowed.
    expect((await h.postGuest("ANA", 90, 120_000, ticket))!.status).toBe(409);
    h.clock.value += 3 * 86_400_000;
    expect((await h.postGuest("Sam", 90, 120_000, ticket))!.status).toBe(400);
    expect(await h.board()).toEqual([]);
  });

  it("posts an attempt once, and shadow-hides one that fails the checks", async () => {
    const h = harness();
    const ticket = await h.start();
    h.clock.value += 140_000;
    const first = (await (await h.postGuest("Sam", 90, 120_000, ticket))!.json()) as { entry: { id: string } };
    const again = (await (await h.postGuest("Sammy", 90, 120_000, ticket))!.json()) as { entry: { id: string; name: string } };
    expect(again.entry).toEqual({ id: first.entry.id, name: "Sam" });

    const fast = await h.start();
    h.clock.value += 140_000;
    // Claims more play than has passed since Start: accepted, but nobody else sees it.
    expect((await h.postGuest("Speedy", 100, 600_000, fast))!.status).toBe(200);
    expect((await h.board()).map((row) => row.user.username)).toEqual(["Sam"]);
  });

  it("moves to the account when the guest signs in", async () => {
    const h = harness();
    const ticket = await h.start();
    h.clock.value += 140_000;
    await h.postGuest("Sam", 90, 120_000, ticket);
    const sam = await h.register("sam_r");
    // The client uploads the guest's local result, ticket and all, on sign-in.
    h.clock.value += 60_000;
    expect((await h.submit(sam, 90, 120_000, ticket))!.status).toBe(200);
    expect((await h.board()).map((row) => [row.user.username, row.guest ?? false])).toEqual([["sam_r", false]]);
  });

  it("caps guest posts per address", async () => {
    const h = harness();
    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) statuses.push((await h.postGuest("Sam", 90, 120_000))!.status);
    expect(statuses.slice(0, 12).every((status) => status === 400)).toBe(true);
    expect(statuses[12]).toBe(429);
  });

  it("lets an admin see, hide and remove guest results", async () => {
    const h = harness();
    const ticket = await h.start();
    h.clock.value += 140_000;
    const { entry } = (await (await h.postGuest("Sam", 90, 120_000, ticket))!.json()) as { entry: { id: string } };
    const admin = new AdminService(h.store, { clock: () => h.clock.value });
    const [row] = admin.daily(DATE);
    expect(row).toMatchObject({ guest: true, user: { id: `guest:${entry.id}`, displayName: "Sam" }, hidden: null });
    expect(admin.setDailyHidden(`guest:${entry.id}`, DATE, true)).toBe(true);
    expect(await h.board()).toEqual([]);
    expect(admin.setDailyHidden(`guest:${entry.id}`, DATE, false)).toBe(true);
    expect(await h.board()).toHaveLength(1);
    expect(admin.deleteDailyResult(`guest:${entry.id}`, DATE)).toBe(true);
    expect(await h.board()).toEqual([]);
    expect(admin.deleteDailyResult(`guest:${entry.id}`, DATE)).toBe(false);
  });
});
