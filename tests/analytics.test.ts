import { describe, expect, it } from "vitest";
import { AnalyticsService, sourceLabel } from "../server/analytics/AnalyticsService";
import { createMemoryAnalyticsStore } from "../server/analytics/memoryStore";
import { pageMetaFor, renderPageMeta } from "../server/pageMeta";
import { readTouch, routeGame } from "../src/app/analytics";
import { shareLink } from "../src/core/shareLink";

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 1, 12, 0, 0);
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

function harness() {
  const clock = { value: START };
  const service = new AnalyticsService(createMemoryAnalyticsStore(), { clock: () => clock.value });
  let ip = 0;
  const send = (body: Record<string, unknown>, options: { user?: { id: string; createdAt: number } | null; userAgent?: string; country?: string | null } = {}) =>
    service.ingest(body, { user: options.user ?? null, ip: `10.0.0.${(ip += 1) % 250}`, userAgent: options.userAgent ?? BROWSER, country: options.country ?? null });
  /** One session for `visitor` at the current clock: a visit plus the given events. */
  const session = (visitor: string, events: Record<string, unknown>[] = [], touch: Record<string, unknown> | null = { landing: "landing", device: "mobile" }, options: Parameters<typeof send>[1] = {}) =>
    send({ visitorId: visitor, sessionId: `${visitor}-s-${clock.value}`, ...(touch ? { touch } : {}), events: [{ name: "visit", time: clock.value }, ...events.map((event) => ({ time: clock.value, ...event }))] }, options);
  return { clock, service, send, session };
}

describe("analytics ingest", () => {
  it("rejects malformed batches and drops unknown events", () => {
    const { send } = harness();
    expect(send({ visitorId: "x", events: [{ name: "visit" }] })).toMatchObject({ ok: false, status: 400 });
    expect(send({ visitorId: "visitor-0001", events: [] })).toMatchObject({ ok: false, status: 400 });
    expect(send({ visitorId: "visitor-0001", events: [{ name: "visit" }, { name: "drop_table" }, { name: "view", game: "<script>" }] })).toEqual({ ok: true, accepted: 2 });
  });

  it("ignores scripted browsers and rate-limits a flood", () => {
    const { send } = harness();
    expect(send({ visitorId: "visitor-0001", events: [{ name: "visit" }] }, { userAgent: "Mozilla/5.0 HeadlessChrome/120" })).toEqual({ ok: true, accepted: 0 });
    const batch = { visitorId: "visitor-flood", events: Array.from({ length: 50 }, () => ({ name: "view" })) };
    for (let i = 0; i < 12; i += 1) expect(send(batch).ok).toBe(true);
    expect(send(batch)).toMatchObject({ ok: false, status: 429 });
  });

  it("drops events dated more than two days back", () => {
    const { send, service } = harness();
    expect(send({ visitorId: "visitor-0001", events: [{ name: "visit", time: START - 3 * DAY }] })).toEqual({ ok: true, accepted: 0 });
    expect(service.report(7).summary.activeInWindow).toBe(0);
  });
});

describe("growth report", () => {
  it("measures exact-day retention only once the day is over", () => {
    const { clock, service, session } = harness();
    session("visitor-aaaa");
    session("visitor-bbbb");
    session("visitor-cccc");
    clock.value += DAY;
    session("visitor-aaaa");
    // Day 1 is still in progress, so nobody is counted yet.
    expect(service.report(30).retention.d1).toEqual({ rate: null, eligible: 0 });
    clock.value += DAY;
    const report = service.report(30);
    expect(report.retention.d1.eligible).toBe(3);
    expect(report.retention.d1.rate).toBeCloseTo(1 / 3);
    expect(report.summary.newInWindow).toBe(3);
    expect(report.funnel.cameBack).toBe(1);
    expect(report.series.at(-3)).toMatchObject({ active: 3, newVisitors: 3, returning: 0 });
    expect(report.series.at(-2)).toMatchObject({ active: 1, newVisitors: 0, returning: 1 });
  });

  it("keeps a visitor's first touch and labels sources", () => {
    const { clock, service, session } = harness();
    session("visitor-reddit", [], { landing: "daily-challenge", referrer: "www.reddit.com", device: "desktop" });
    session("visitor-tagged", [], { landing: "daily-challenge", source: "TikTok", campaign: "outline-quiz-1" });
    session("visitor-shared", [], { landing: "daily-challenge", source: "share" });
    session("visitor-direct", [], { landing: "landing" });
    clock.value += DAY;
    // A later visit from somewhere else doesn't rewrite where they first came from.
    session("visitor-direct", [], { landing: "landing", referrer: "www.google.com" });
    const report = service.report(30);
    expect(Object.fromEntries(report.sources.map((row) => [row.source, row.visitors]))).toEqual({ reddit: 1, tiktok: 1, share: 1, direct: 1 });
    expect(report.summary.shareArrivals).toBe(1);
    expect(report.campaigns).toEqual([{ key: "tiktok · outline-quiz-1", visitors: 1 }]);
    expect(report.landings[0]).toEqual({ key: "daily-challenge", visitors: 3 });
  });

  it("ranks games by players and tracks completion, repeats and shares", () => {
    const { clock, service, session } = harness();
    session("visitor-aaaa", [{ name: "view", game: "daily", mode: "daily" }, { name: "game_complete", game: "daily", mode: "daily" }, { name: "share", game: "daily", detail: "copied" }]);
    session("visitor-bbbb", [{ name: "view", game: "daily", mode: "daily" }, { name: "view", game: "flags", mode: "practice" }]);
    clock.value += DAY;
    session("visitor-aaaa", [{ name: "view", game: "daily" }, { name: "game_complete", game: "daily", mode: "daily" }]);
    const daily = service.report(30).games.find((row) => row.game === "daily")!;
    expect(daily).toMatchObject({ openers: 2, players: 1, completions: 2, completionRate: 0.5, repeatRate: 1, shares: 1 });
    const funnel = service.report(30).funnel;
    expect(funnel).toMatchObject({ visited: 2, openedGame: 2, finishedGame: 1, shared: 1 });
  });

  it("counts an account as a signup only when it was created after the first visit", () => {
    const { clock, service, session, send } = harness();
    session("visitor-newbie");
    session("visitor-oldhand");
    clock.value += 60_000;
    send({ visitorId: "visitor-newbie", events: [{ name: "view" }] }, { user: { id: "u-new", createdAt: clock.value } });
    send({ visitorId: "visitor-oldhand", events: [{ name: "view" }] }, { user: { id: "u-old", createdAt: START - 90 * DAY } });
    expect(service.report(30).summary.signupsInWindow).toBe(1);
  });

  it("forgets a device once it's signed in to an excluded account, even signed out", () => {
    const { service, session, send } = harness();
    session("visitor-tate", [{ name: "game_complete", game: "daily", mode: "daily" }]);
    session("visitor-guest", [{ name: "game_complete", game: "daily", mode: "daily" }]);
    expect(service.report(30).summary.newInWindow).toBe(2);
    service.ingest({ visitorId: "visitor-tate", events: [{ name: "view" }] }, { user: { id: "u-tate", createdAt: START }, excludedUser: true, ip: "10.1.1.1", userAgent: BROWSER, country: null });
    expect(session("visitor-tate", [{ name: "game_complete", game: "daily" }])).toEqual({ ok: true, accepted: 0 });
    expect(send({ visitorId: "visitor-tate", events: [{ name: "share" }] })).toEqual({ ok: true, accepted: 0 });
    const report = service.report(30);
    expect(report.summary.newInWindow).toBe(1);
    expect(report.games.find((row) => row.game === "daily")?.players).toBe(1);
  });

  it("counts a signed-in player's devices as one person", () => {
    const { clock, service, session } = harness();
    const kylian = { id: "u-kylian", createdAt: START - 90 * DAY };
    session("visitor-phone", [{ name: "game_complete", game: "daily", mode: "daily" }], { landing: "daily-challenge", source: "reddit" }, { user: kylian });
    clock.value += DAY;
    // Next day on a laptop: a returning player, not a new visitor who never came back.
    session("visitor-laptop", [{ name: "game_complete", game: "daily", mode: "daily" }], { landing: "landing" }, { user: kylian });
    clock.value += DAY;
    const report = service.report(30);
    expect(report.summary.newInWindow).toBe(1);
    expect(report.retention.d1).toEqual({ rate: 1, eligible: 1 });
    expect(report.sources).toEqual([expect.objectContaining({ source: "reddit", visitors: 1 })]);
    expect(report.games.find((row) => row.game === "daily")).toMatchObject({ players: 1, completions: 2, repeatRate: 1 });
  });

  it("doesn't count a long-time player on a new device as new", () => {
    const { clock, service, session } = harness();
    const player = { id: "u-old", createdAt: START - DAY };
    session("visitor-first", [], { landing: "landing" }, { user: player });
    clock.value += 45 * DAY;
    session("visitor-new-phone", [], { landing: "landing" }, { user: player });
    const report = service.report(30);
    expect(report.summary.newInWindow).toBe(0);
    expect(report.summary.activeToday).toBe(1);
  });

  it("links a device to the account on a sign-in event alone", () => {
    const { service, session, send } = harness();
    session("visitor-guest1");
    expect(send({ visitorId: "visitor-guest1", events: [{ name: "sign_in" }] }, { user: { id: "u-new", createdAt: START } })).toEqual({ ok: true, accepted: 1 });
    expect(service.report(30).summary.signupsInWindow).toBe(1);
  });

  it("clamps the window", () => {
    const { service } = harness();
    expect(service.report(1).days).toBe(7);
    expect(service.report(365).days).toBe(90);
    expect(service.report(Number.NaN).days).toBe(30);
  });
});

describe("source labels", () => {
  it("groups well-known referrers and falls back to the host", () => {
    expect(sourceLabel({ source: null, referrer: "l.facebook.com" })).toBe("facebook");
    expect(sourceLabel({ source: null, referrer: "t.co" })).toBe("x");
    expect(sourceLabel({ source: null, referrer: "www.thedles.com" })).toBe("thedles.com");
    expect(sourceLabel({ source: "reddit", referrer: "www.google.com" })).toBe("reddit");
    expect(sourceLabel({ source: null, referrer: null })).toBe("direct");
  });
});

describe("client analytics helpers", () => {
  it("maps routes to games", () => {
    expect(routeGame({ type: "daily-challenge" })).toEqual({ game: "daily", mode: "daily" });
    expect(routeGame({ type: "solo-game", categoryIds: ["capitals"], run: "timed" })).toEqual({ game: "capitals", mode: "timed" });
    expect(routeGame({ type: "overland", daily: true })).toEqual({ game: "overland", mode: "daily" });
    expect(routeGame({ type: "atlas" })).toBeNull();
  });

  it("reads UTM tags, ref and the referring host, ignoring its own site", () => {
    const touch = readTouch({ search: "?view=daily-challenge&utm_source=reddit&utm_campaign=outlines", host: "locato.quest" }, "https://www.reddit.com/r/geography/", { language: "en-ZA" }, { width: 390, height: 844 }, "daily-challenge");
    expect(touch).toEqual({ source: "reddit", medium: null, campaign: "outlines", referrer: "www.reddit.com", landing: "daily-challenge", device: "mobile", country: "ZA" });
    expect(readTouch({ search: "?ref=share", host: "locato.quest" }, "https://locato.quest/?view=stats", { language: "en" }, { width: 1440, height: 900 }, "landing"))
      .toMatchObject({ source: "share", referrer: null, device: "desktop", country: null });
  });

  it("builds share links that reopen the game and tag the visit", () => {
    const link = shareLink({ view: "daily-challenge" });
    expect(link).toMatch(/^https?:\/\/[^/]+\/\?view=daily-challenge&ref=share$/);
  });
});

describe("link previews", () => {
  const html = `<title>Locato — Geography games</title><meta property="og:title" content="x"><meta property="og:description" content="x"><meta property="og:url" content="x"><meta property="og:image" content="x"><meta name="twitter:title" content="x"><meta name="twitter:description" content="x"><meta name="twitter:image" content="x">`;

  it("titles shared dailies and room invites", () => {
    expect(pageMetaFor(new URL("https://locato.quest/?view=daily-challenge&ref=share")).title).toBe("Locato Daily — today's geography challenge");
    expect(pageMetaFor(new URL("https://locato.quest/?game=overland&daily=1")).title).toContain("today's route");
    expect(pageMetaFor(new URL("https://locato.quest/?room=ab12")).description).toContain("AB12");
    expect(pageMetaFor(new URL("https://locato.quest/?room=<b>")).title).toBe("Locato — Geography games");
  });

  it("rewrites the tags with the public origin and drops ref", () => {
    const out = renderPageMeta(html, new URL("http://internal:3000/?view=daily-challenge&ref=share"), "https://locato.quest");
    expect(out).toContain(`<title>Locato Daily — today's geography challenge</title>`);
    expect(out).toContain(`<meta property="og:url" content="https://locato.quest/?view=daily-challenge">`);
    expect(out).toContain(`<meta property="og:image" content="https://locato.quest/og-image.png">`);
    expect(out).toContain(`<meta name="twitter:title" content="Locato Daily — today&#39;s geography challenge">`.replace("&#39;", "'"));
  });
});
