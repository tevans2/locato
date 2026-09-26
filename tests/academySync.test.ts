import { afterEach, describe, expect, it } from "vitest";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../server/auth/cookies";
import { AdminService } from "../server/admin/AdminService";
import { setEventSink } from "../server/admin/events";
import { mergeAcademyProgress, STORED_ACTIVITY_DAYS } from "../server/academy/merge";
import { MAX_ACADEMY_CARDS, MAX_ACADEMY_PAYLOAD_BYTES, MAX_CLOCK_SKEW_MS, validateAcademyProgress } from "../server/academy/validation";
import type { PasswordHasher, UserStore } from "../server/auth/types";
import type { AcademyProgress, CardProgress } from "../src/core/academy/types";

const ADMIN = "secret-admin-token";
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const DAY = 86_400_000;
const COOKIE_OPTS = { secure: false };
const BASE_URL = "http://localhost:3000";

const fakeHasher: PasswordHasher = {
  hash: async (password) => `hashed:${password}`,
  verify: async (password, hash) => hash === `hashed:${password}`,
};

function createHarness() {
  const clock = { value: NOW };
  const store: UserStore = createMemoryUserStore();
  const service = new AuthService(store, fakeHasher, { sessionTtlMs: 60 * 60 * 1000, clock: () => clock.value });
  const admin = new AdminService(store, { clock: () => clock.value });
  setEventSink((event) => store.recordEvent(event));
  const route = (request: Request) =>
    handleAuthRequest(request, new URL(request.url), service, COOKIE_OPTS, BASE_URL, ADMIN, undefined, { service: admin, system: () => ({ uptimeSeconds: 1 }) });
  return { clock, store, service, admin, route };
}

type Harness = ReturnType<typeof createHarness>;

function jsonRequest(path: string, method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.cookie = `${SESSION_COOKIE_NAME}=${token}`;
  return new Request(`http://localhost${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

async function seedUser(h: Harness, email: string): Promise<{ id: string; token: string }> {
  const response = await h.route(jsonRequest("/auth/register", "POST", { email, password: "supersecret", displayName: email.split("@")[0] }));
  const token = parseCookieHeader(response!.headers.get("set-cookie"))[SESSION_COOKIE_NAME]!;
  const me = await h.route(jsonRequest("/auth/me", "GET", undefined, token));
  return { id: (await me!.json()).user.id, token };
}

function card(overrides: Partial<CardProgress> = {}): CardProgress {
  return { box: 1, correct: 1, wrong: 0, lastSeenAt: NOW - DAY, dueAt: NOW + DAY, ...overrides };
}

function progress(overrides: Partial<AcademyProgress> = {}): AcademyProgress {
  return { version: 1, cards: { "FR:flag": card() }, placementCompletedAt: null, activity: { "2026-09-24": 5 }, updatedAt: NOW - DAY, ...overrides };
}

function put(h: Harness, body: unknown, token?: string) {
  return h.route(jsonRequest("/api/academy", "PUT", body, token));
}

afterEach(() => setEventSink(null));

describe("academy routes", () => {
  it("rejects guests with 401", async () => {
    const h = createHarness();
    expect((await h.route(jsonRequest("/api/academy", "GET")))!.status).toBe(401);
    expect((await put(h, { progress: progress() }))!.status).toBe(401);
  });

  it("returns null before any sync, then round-trips the uploaded progress", async () => {
    const h = createHarness();
    const { token } = await seedUser(h, "ada@example.com");
    const empty = await h.route(jsonRequest("/api/academy", "GET", undefined, token));
    expect(await empty!.json()).toEqual({ progress: null });

    const saved = await put(h, { progress: progress() }, token);
    expect(saved!.status).toBe(200);
    expect(await saved!.json()).toEqual({ progress: progress() });

    const fetched = await h.route(jsonRequest("/api/academy", "GET", undefined, token));
    expect(await fetched!.json()).toEqual({ progress: progress() });
  });

  it("merges a second device's upload instead of overwriting", async () => {
    const h = createHarness();
    const { token } = await seedUser(h, "ada@example.com");
    await put(h, { progress: progress({ cards: { "FR:flag": card({ box: 3, lastSeenAt: NOW - 1000 }), "DE:map": card() }, placementCompletedAt: NOW - 5 * DAY }) }, token);
    const second = await put(h, {
      progress: progress({
        cards: { "FR:flag": card({ box: 1, lastSeenAt: NOW - 2000 }), "JP:capital": card({ box: 2 }) },
        placementCompletedAt: NOW - DAY,
        activity: { "2026-09-24": 2, "2026-09-25": 7 },
        updatedAt: NOW,
      }),
    }, token);
    const merged = (await second!.json()).progress as AcademyProgress;
    expect(Object.keys(merged.cards).sort()).toEqual(["DE:map", "FR:flag", "JP:capital"]);
    expect(merged.cards["FR:flag"]!.box).toBe(3);
    expect(merged.placementCompletedAt).toBe(NOW - 5 * DAY);
    expect(merged.activity).toEqual({ "2026-09-24": 5, "2026-09-25": 7 });
    expect(merged.updatedAt).toBe(NOW);
  });

  it("rejects invalid progress with 400 and oversize bodies with 413", async () => {
    const h = createHarness();
    const { token } = await seedUser(h, "ada@example.com");
    expect((await put(h, { progress: { ...progress(), cards: { "XX:flag": card() } } }, token))!.status).toBe(400);
    expect((await put(h, {}, token))!.status).toBe(400);
    const huge = { progress: progress(), padding: "x".repeat(MAX_ACADEMY_PAYLOAD_BYTES) };
    expect((await put(h, huge, token))!.status).toBe(413);
    const fetched = await h.route(jsonRequest("/api/academy", "GET", undefined, token));
    expect(await fetched!.json()).toEqual({ progress: null });
  });

  it("rate-limits sync bursts", async () => {
    const h = createHarness();
    const { token } = await seedUser(h, "ada@example.com");
    const statuses: number[] = [];
    for (let i = 0; i < 31; i += 1) statuses.push((await put(h, { progress: progress() }, token))!.status);
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("logs an academy.sync event without the payload", async () => {
    const h = createHarness();
    const { id, token } = await seedUser(h, "ada@example.com");
    await put(h, { progress: progress() }, token);
    const [event] = h.store.listEvents({ level: null, action: "academy.sync", ip: null, userId: id, before: null, limit: 5 });
    expect(event).toMatchObject({ level: "info", action: "academy.sync", details: { cards: 1 } });
    expect(JSON.stringify(event!.details)).not.toContain("FR:flag");
  });
});

describe("academy admin + deletion", () => {
  it("summarises academy progress in the dossier and keeps it through a stats reset", async () => {
    const h = createHarness();
    const { id, token } = await seedUser(h, "ada@example.com");
    expect(h.admin.getUserDetail(id)!.academy).toBeNull();
    await put(h, { progress: progress({ cards: { "FR:flag": card({ box: 5 }), "DE:map": card({ box: 2 }), "JP:map": card({ box: 0, lastSeenAt: 0, dueAt: 0 }) } }) }, token);
    expect(h.admin.getUserDetail(id)!.academy).toEqual({ cardsSeen: 2, cardsMastered: 1, activeDays: 1, placementCompletedAt: null, updatedAt: NOW - DAY });

    const reset = await h.route(new Request(`http://localhost/api/admin/users/${id}/stats`, { method: "DELETE", headers: { authorization: `Bearer ${ADMIN}` } }));
    expect(reset!.status).toBe(200);
    expect(h.store.getAcademyProgress(id)).not.toBeNull();
  });

  it("deletes academy progress with the user", async () => {
    const h = createHarness();
    const { id, token } = await seedUser(h, "ada@example.com");
    await put(h, { progress: progress() }, token);
    expect(h.store.getAcademyProgress(id)).not.toBeNull();
    expect(h.admin.deleteUser(id)).toBe(true);
    expect(h.store.getAcademyProgress(id)).toBeNull();
  });
});

describe("validateAcademyProgress", () => {
  const validate = (input: unknown) => validateAcademyProgress(input, NOW);

  it("accepts a valid payload and strips unknown fields", () => {
    const result = validate({ ...progress(), extra: "nope", cards: { "FR:flag": { ...card(), hacked: true } } });
    expect(result).toEqual({ ok: true, progress: progress() });
  });

  it("rejects bad versions, keys, and unknown countries", () => {
    expect(validate({ ...progress(), version: 2 }).ok).toBe(false);
    expect(validate({ ...progress(), cards: { "fr:flag": card() } }).ok).toBe(false);
    expect(validate({ ...progress(), cards: { "FR:anthem": card() } }).ok).toBe(false);
    expect(validate({ ...progress(), cards: { "FRA:flag": card() } }).ok).toBe(false);
    expect(validate({ ...progress(), cards: { "ZZ:flag": card() } })).toMatchObject({ ok: false, error: expect.stringContaining("Unknown country") });
    expect(validate(null).ok).toBe(false);
    expect(validate({ ...progress(), cards: [] }).ok).toBe(false);
  });

  it("rejects out-of-range card fields", () => {
    expect(validate({ ...progress(), cards: { "FR:flag": card({ box: 6 as never }) } }).ok).toBe(false);
    expect(validate({ ...progress(), cards: { "FR:flag": card({ box: 1.5 as never }) } }).ok).toBe(false);
    expect(validate({ ...progress(), cards: { "FR:flag": card({ correct: -1 }) } }).ok).toBe(false);
    expect(validate({ ...progress(), cards: { "FR:flag": card({ wrong: 10_000_000 }) } }).ok).toBe(false);
    expect(validate({ ...progress(), cards: { "FR:flag": card({ dueAt: NOW + 10 * 365 * DAY }) } }).ok).toBe(false);
  });

  it("clamps slightly-future timestamps and rejects far-future ones", () => {
    const skewed = validate(progress({ cards: { "FR:flag": card({ lastSeenAt: NOW + 60_000 }) }, updatedAt: NOW + 60_000, placementCompletedAt: NOW + 1 }));
    expect(skewed.ok && skewed.progress.cards["FR:flag"]!.lastSeenAt).toBe(NOW);
    expect(skewed.ok && skewed.progress.updatedAt).toBe(NOW);
    expect(skewed.ok && skewed.progress.placementCompletedAt).toBe(NOW);
    const far = NOW + MAX_CLOCK_SKEW_MS + 1;
    expect(validate(progress({ cards: { "FR:flag": card({ lastSeenAt: far }) } })).ok).toBe(false);
    expect(validate(progress({ updatedAt: far })).ok).toBe(false);
    expect(validate(progress({ placementCompletedAt: far })).ok).toBe(false);
  });

  it("validates activity keys and values", () => {
    expect(validate(progress({ activity: { "2026-9-24": 1 } })).ok).toBe(false);
    expect(validate(progress({ activity: { "2026-02-30": 1 } })).ok).toBe(false);
    expect(validate(progress({ activity: { "2026-09-24": -1 } })).ok).toBe(false);
    expect(validate(progress({ activity: { "2026-09-24": 1_000_000 } })).ok).toBe(false);
  });

  it("accepts a full deck but rejects more cards than exist", () => {
    const codes = ["FR", "DE", "JP", "BR"];
    const full = Object.fromEntries(codes.flatMap((code) => ["flag", "shape", "capital", "map"].map((skill) => [`${code}:${skill}`, card()])));
    expect(validate(progress({ cards: full })).ok).toBe(true);
    const tooMany = Object.fromEntries(Array.from({ length: MAX_ACADEMY_CARDS + 1 }, (_, i) => [`K${i}`, card()]));
    expect(validate({ ...progress(), cards: tooMany })).toMatchObject({ ok: false, error: "Too many cards." });
  });
});

describe("mergeAcademyProgress", () => {
  it("prefers the newer lastSeenAt per card and unions keys", () => {
    const a = progress({ cards: { "FR:flag": card({ box: 4, lastSeenAt: 200 }), "DE:map": card({ lastSeenAt: 50 }) } });
    const b = progress({ cards: { "FR:flag": card({ box: 1, lastSeenAt: 100 }), "JP:shape": card({ lastSeenAt: 10 }) } });
    const merged = mergeAcademyProgress(a, b);
    expect(merged.cards["FR:flag"]!.box).toBe(4);
    expect(Object.keys(merged.cards).sort()).toEqual(["DE:map", "FR:flag", "JP:shape"]);
    expect(mergeAcademyProgress(b, a).cards).toEqual(merged.cards);
  });

  it("breaks lastSeenAt ties by answer count", () => {
    const a = progress({ cards: { "FR:flag": card({ lastSeenAt: 100, correct: 1 }) } });
    const b = progress({ cards: { "FR:flag": card({ lastSeenAt: 100, correct: 9 }) } });
    expect(mergeAcademyProgress(a, b).cards["FR:flag"]!.correct).toBe(9);
    expect(mergeAcademyProgress(b, a).cards["FR:flag"]!.correct).toBe(9);
  });

  it("takes max activity per day, earliest placement, max updatedAt", () => {
    const a = progress({ activity: { "2026-09-20": 3, "2026-09-21": 8 }, placementCompletedAt: null, updatedAt: 500 });
    const b = progress({ activity: { "2026-09-21": 4, "2026-09-22": 1 }, placementCompletedAt: 300, updatedAt: 900 });
    const merged = mergeAcademyProgress(a, b);
    expect(merged.activity).toEqual({ "2026-09-20": 3, "2026-09-21": 8, "2026-09-22": 1 });
    expect(merged.placementCompletedAt).toBe(300);
    expect(merged.updatedAt).toBe(900);
    expect(mergeAcademyProgress(progress({ placementCompletedAt: 700 }), progress({ placementCompletedAt: 300 })).placementCompletedAt).toBe(300);
  });

  it("keeps only the most recent activity days", () => {
    const days = Object.fromEntries(Array.from({ length: STORED_ACTIVITY_DAYS + 10 }, (_, i) => [new Date(NOW - i * DAY).toISOString().slice(0, 10), 1]));
    const merged = mergeAcademyProgress(progress({ activity: days }), progress({ activity: {} }));
    expect(Object.keys(merged.activity)).toHaveLength(STORED_ACTIVITY_DAYS);
    expect(merged.activity["2026-09-25"]).toBe(1);
  });
});
