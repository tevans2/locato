import { describe, expect, it } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { createSeededRandom, shuffle } from "../src/core/game/random";
import {
  auditRun,
  gapVariation,
  maxInWindow,
  orderCorrelation,
  parseRunTimeline,
  runVerdict,
  type RunAuditInput,
  type RunEntry,
  type RunTimeline,
} from "../src/core/runAudit";
import { AuthService } from "../server/auth/AuthService";
import { AdminService } from "../server/admin/AdminService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../server/auth/cookies";
import type { PasswordHasher } from "../server/auth/types";

const countries = indexCountries(rawCountries).countries;
const codes = countries.map((country) => country.code);
const names = new Map(countries.map((country) => [country.code, country.name]));

/** How a person plays: a continent at a time in their own order, uneven gaps, stalls on hard ones. */
function honestTimeline(seed = "honest"): RunTimeline {
  const random = createSeededRandom(seed);
  const byContinent = new Map<string, string[]>();
  for (const country of countries) byContinent.set(country.continent, [...(byContinent.get(country.continent) ?? []), country.code]);
  const order = shuffle([...byContinent.values()], random).flatMap((group) => shuffle(group, random));
  let t = 0;
  const entries: RunEntry[] = order.map((code, index) => {
    if (index > 0) t += random() < 0.08 ? 4_000 + random() * 9_000 : 350 + random() * 1_400;
    return [code, Math.round(t), 3 + Math.floor(random() * 5), 0];
  });
  return { entries, signals: { pastes: 0, hiddenMs: 0 } };
}

/** How a lazy script plays: the list in order, a fixed delay, letters set from the page. */
function scriptedTimeline(gapMs = 110): RunTimeline {
  return { entries: codes.map((code, index) => [code, index * gapMs, 0, 4] as RunEntry), signals: { pastes: 0, hiddenMs: 0 } };
}

function input(overrides: Partial<RunAuditInput>): RunAuditInput {
  return {
    mode: "name-all",
    timed: true,
    outcome: "complete",
    timeline: null,
    claimedMs: null,
    serverElapsedMs: null,
    countryCodes: codes,
    countryNames: names,
    previousBestMs: null,
    overlapsPreviousRun: false,
    ...overrides,
  };
}

const codesOf = (flags: ReturnType<typeof auditRun>) => flags.map((item) => item.code);

describe("run audit statistics", () => {
  it("finds the busiest minute, how even the gaps are, and how listy the order is", () => {
    expect(maxInWindow([0, 10_000, 20_000, 70_000, 75_000], 60_000)).toBe(3);
    expect(gapVariation([0, 100, 200, 300, 400])).toBe(0);
    expect(gapVariation([0, 100, 5_000, 5_200, 12_000])).toBeGreaterThan(0.8);
    expect(orderCorrelation(["a", "b", "c", "d"], ["a", "b", "c", "d"])).toBeCloseTo(1);
    expect(orderCorrelation(["d", "c", "b", "a"], ["a", "b", "c", "d"])).toBeCloseTo(-1);
  });

  it("only accepts a well-formed timeline", () => {
    expect(parseRunTimeline({ entries: [["FR", 1200, 4, 0]], signals: { pastes: 0, hiddenMs: 0 } })).toEqual({ entries: [["FR", 1200, 4, 0]], signals: { pastes: 0, hiddenMs: 0 } });
    expect(parseRunTimeline({ entries: [["FR", -1, 4, 0]], signals: { pastes: 0, hiddenMs: 0 } })).toBeNull();
    expect(parseRunTimeline({ entries: [["FR", 1, 4.5, 0]], signals: { pastes: 0, hiddenMs: 0 } })).toBeNull();
    expect(parseRunTimeline({ entries: Array.from({ length: 401 }, () => ["FR", 1, 1, 0]), signals: { pastes: 0, hiddenMs: 0 } })).toBeNull();
    expect(parseRunTimeline({ entries: [] })).toBeNull();
    expect(parseRunTimeline("nope")).toBeNull();
  });
});

describe("run audit checks", () => {
  it("passes an honest timed run", () => {
    const timeline = honestTimeline();
    const claimedMs = timeline.entries.at(-1)![1];
    expect(claimedMs).toBeGreaterThan(180_000);
    const flags = auditRun(input({ timeline, claimedMs, serverElapsedMs: claimedMs + 400, previousBestMs: claimedMs + 20_000 }));
    expect(flags).toEqual([]);
    expect(runVerdict(flags)).toBe("ok");
  });

  it("passes honest runs across many seeds (no false alarms)", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const timeline = honestTimeline(`seed-${seed}`);
      const claimedMs = timeline.entries.at(-1)![1];
      expect(codesOf(auditRun(input({ timeline, claimedMs, serverElapsedMs: claimedMs + 300 })))).toEqual([]);
    }
  });

  it("refuses a time posted from the console: no ticket, no timeline, under the floor", () => {
    const flags = auditRun(input({ claimedMs: 61_234 }));
    expect(codesOf(flags)).toEqual(["no-ticket", "below-floor", "bad-countries"]);
    expect(runVerdict(flags)).toBe("reject");
  });

  it("refuses a claimed time longer than the server saw the run last, or that the timeline disagrees with", () => {
    const timeline = honestTimeline();
    const last = timeline.entries.at(-1)![1];
    expect(codesOf(auditRun(input({ timeline, claimedMs: last, serverElapsedMs: last - 60_000 })))).toContain("server-time-short");
    expect(codesOf(auditRun(input({ timeline, claimedMs: last - 30_000, serverElapsedMs: last })))).toContain("time-mismatch");
  });

  it("flags a game clock running slow against the server's (paused or tampered)", () => {
    const timeline = honestTimeline();
    const last = timeline.entries.at(-1)![1];
    const flags = auditRun(input({ timeline, claimedMs: last, serverElapsedMs: last + 120_000 }));
    expect(codesOf(flags)).toEqual(["clock-slow"]);
    expect(runVerdict(flags)).toBe("review");
  });

  it("refuses missing or repeated countries", () => {
    const timeline = honestTimeline();
    const short: RunTimeline = { ...timeline, entries: [...timeline.entries.slice(0, -1), timeline.entries[0]!] };
    const last = short.entries.at(-1)![1];
    expect(codesOf(auditRun(input({ timeline: short, claimedMs: last, serverElapsedMs: last })))).toContain("bad-countries");
  });

  it("catches a script typing the list from the page, even in practice", () => {
    const flags = auditRun(input({ timed: false, timeline: scriptedTimeline() }));
    expect(codesOf(flags)).toEqual(expect.arrayContaining(["no-typing", "synthetic-input", "fast-burst", "even-pace", "list-order"]));
    // Practice never reaches the board: worth a look, nothing to refuse.
    expect(runVerdict(flags)).toBe("review");
  });

  it("refuses a scripted timed run that paces itself to look human but types nothing", () => {
    const timeline = scriptedTimeline(1_300);
    const last = timeline.entries.at(-1)![1];
    const flags = auditRun(input({ timeline, claimedMs: last, serverElapsedMs: last + 200 }));
    expect(codesOf(flags)).toEqual(expect.arrayContaining(["no-typing", "even-pace", "list-order"]));
    expect(codesOf(flags)).not.toContain("fast-burst");
    expect(runVerdict(flags)).toBe("reject");
  });

  it("flags the shape of Damon's practice runs: 195 countries in 22 seconds", () => {
    const timeline: RunTimeline = { entries: codes.slice(0, 195).map((code, index) => [code, index * 110, 3, 0] as RunEntry), signals: { pastes: 0, hiddenMs: 0 } };
    expect(codesOf(auditRun(input({ timed: false, outcome: "abandoned", timeline })))).toContain("fast-burst");
  });

  it("flags a big jump, pasting, a hidden tab and two runs at once", () => {
    const base = honestTimeline();
    const timeline: RunTimeline = { ...base, signals: { pastes: 2, hiddenMs: 45_000 } };
    const last = timeline.entries.at(-1)![1];
    const flags = auditRun(input({ timeline, claimedMs: last, serverElapsedMs: last, previousBestMs: last * 2, overlapsPreviousRun: true }));
    expect(codesOf(flags)).toEqual(["big-improvement", "overlapping-run", "tab-hidden", "paste"]);
    expect(runVerdict(flags)).toBe("review");
  });
});

// --- Server ------------------------------------------------------------------------------------

const fakeHasher: PasswordHasher = { hash: async (password) => `hashed:${password}`, verify: async (password, hash) => hash === `hashed:${password}` };

async function setup(enforceRunAudit = false) {
  const clock = { value: 1_000_000 };
  const store = createMemoryUserStore();
  const service = new AuthService(store, fakeHasher, { sessionTtlMs: 60 * 60 * 1000, clock: () => clock.value, enforceRunAudit });
  const registered = await service.register({ email: "kylian@test.local", password: "correct-horse-1", displayName: "kylian" });
  if (!registered.ok) throw new Error(registered.error);
  return { store, service, clock, userId: registered.user.id, token: registered.session.id };
}

describe("run audit on the server", () => {
  it("records legacy timelines but does not treat them as verified play", async () => {
    const { service, store, clock, userId } = await setup(true);
    const started = service.startRun(userId, { gameMode: "name-all", timed: true });
    if ("error" in started) throw new Error(started.error);
    const timeline = honestTimeline();
    const timeMs = timeline.entries.at(-1)![1];
    clock.value += timeMs + 300;
    const result = service.submitLeaderboardAttempt(userId, { gameMode: "name-all", variant: "", timeMs, runId: started.runId, timeline });
    expect("error" in result).toBe(true);
    expect(result.audit).toMatchObject({ verdict: "ok", refused: true });
    expect(store.findRun(started.runId)).toMatchObject({ posted: true, verdict: "ok", claimedMs: timeMs, countries: 196 });
    expect(service.getUserLeaderboardRank(userId, "name-all", "")).toBeNull();
  });

  it("a console post is refused even when optional telemetry enforcement is off", async () => {
    const { service, store, userId } = await setup(false);
    const result = service.submitLeaderboardAttempt(userId, { gameMode: "name-all", variant: "", timeMs: 61_234 });
    expect("error" in result).toBe(true);
    expect(result.audit?.verdict).toBe("reject");
    const [run] = store.listUserRuns(userId, 5);
    expect(run).toMatchObject({ posted: true, refused: true, verdict: "reject" });
  });

  it("enforcing: refuses it, keeps it in the trail, and leaves the board alone", async () => {
    const { service, store, userId } = await setup(true);
    const result = service.submitLeaderboardAttempt(userId, { gameMode: "name-all", variant: "", timeMs: 61_234 });
    expect("error" in result && result.error).toMatch(/couldn't be verified/);
    expect(store.listUserRuns(userId, 5)[0]).toMatchObject({ refused: true });
    expect(service.getUserLeaderboardRank(userId, "name-all", "")).toBeNull();
  });

  it("a ticket counts once, and only for its owner", async () => {
    const { service, clock, userId } = await setup(true);
    const other = await service.register({ email: "damon@test.local", password: "correct-horse-1", displayName: "damon" });
    if (!other.ok) throw new Error(other.error);
    const started = service.startRun(userId, { gameMode: "name-all", timed: true });
    if ("error" in started) throw new Error(started.error);
    const timeline = honestTimeline();
    const timeMs = timeline.entries.at(-1)![1];
    clock.value += timeMs;
    expect(service.submitLeaderboardAttempt(other.user.id, { gameMode: "name-all", variant: "", timeMs, runId: started.runId, timeline }).audit?.flags.map((f) => f.code)).toContain("no-ticket");
    expect("error" in service.submitLeaderboardAttempt(userId, { gameMode: "name-all", variant: "", timeMs, runId: started.runId, timeline })).toBe(true);
    expect(service.submitLeaderboardAttempt(userId, { gameMode: "name-all", variant: "", timeMs, runId: started.runId, timeline }).audit?.flags.map((f) => f.code)).toContain("no-ticket");
  });

  it("records practice runs that end without a post, and spots two runs at once", async () => {
    const { service, store, clock, userId } = await setup();
    const first = service.startRun(userId, { gameMode: "name-all", timed: false });
    clock.value += 1_000;
    const second = service.startRun(userId, { gameMode: "name-all", timed: false });
    if ("error" in first || "error" in second) throw new Error("no ticket");
    clock.value += 30_000;
    expect(service.finishRun(userId, { runId: first.runId, outcome: "abandoned", timeline: scriptedTimeline() })).toMatchObject({ verdict: "review" });
    const later = service.finishRun(userId, { runId: second.runId, outcome: "given-up", timeline: honestTimeline() });
    expect("flags" in later && later.flags.map((f) => f.code)).toContain("overlapping-run");
    expect(store.findRun(first.runId)).toMatchObject({ outcome: "abandoned", posted: false });
    expect(service.finishRun(userId, { runId: first.runId, outcome: "complete", timeline: honestTimeline() })).toEqual({ error: "This run has already ended." });
  });

  it("requires verified play for other boards too", async () => {
    const { service, store, userId } = await setup(true);
    const result = service.submitLeaderboardAttempt(userId, { gameMode: "flags", variant: "", timeMs: 61_234 });
    expect("error" in result).toBe(true);
    expect(store.listUserRuns(userId, 5)).toEqual([]);
    expect("error" in service.startRun(userId, { gameMode: "flags", timed: true })).toBe(true);
  });

  it("serves runs over the API without telling the player which checks fired", async () => {
    const { service, clock, token } = await setup();
    const call = (path: string, body: unknown) => handleAuthRequest(
      new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE_NAME}=${token}`, "user-agent": "vitest" }, body: JSON.stringify(body) }),
      new URL(`http://localhost${path}`), service, { secure: false }, "http://localhost:3000",
    );
    const started = (await (await call("/api/runs/start", { gameMode: "name-all", timed: false }))!.json()) as { runId: string };
    expect(started.runId).toMatch(/^run_/);
    clock.value += 5_000;
    const finished = await call("/api/runs/finish", { runId: started.runId, outcome: "abandoned", timeline: scriptedTimeline() });
    expect(await finished!.json()).toEqual({ ok: true });
    const posted = await call("/api/leaderboard", { gameMode: "name-all", variant: "", timeMs: 61_234 });
    const body = (await posted!.json()) as Record<string, unknown>;
    expect(posted!.status).toBe(400);
    expect(body).not.toHaveProperty("audit");
    const tooBig = await call("/api/runs/finish", { runId: started.runId, timeline: { entries: "x".repeat(40_000) } });
    expect(tooBig!.status).toBe(413);
  });

  it("shows runs to the admin, per player and flagged across everyone", async () => {
    const { service, store, userId } = await setup();
    service.submitLeaderboardAttempt(userId, { gameMode: "name-all", variant: "", timeMs: 61_234 });
    const admin = new AdminService(store, { clock: () => 2_000_000 });
    const detail = admin.getUserDetail(userId);
    expect(detail?.runs[0]).toMatchObject({ gameMode: "name-all", verdict: "reject", posted: true, displayName: "kylian" });
    expect(admin.flaggedRuns(10).map((run) => run.userId)).toEqual([userId]);
  });
});
