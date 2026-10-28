import {
  ANALYTICS_EVENT_NAMES,
  type AnalyticsDevice,
  type AnalyticsEventName,
  type AnalyticsEventRow,
  type AnalyticsStore,
  type AnalyticsTouch,
  type AnalyticsVisitor,
} from "./types";

const DAY_MS = 86_400_000;
const MAX_EVENTS_PER_BATCH = 50;
// Client clocks drift and beacons can be queued offline for a while; older events are dropped.
const MAX_EVENT_AGE_MS = 2 * DAY_MS;
const MAX_CLOCK_SKEW_MS = 10 * 60_000;
const VISITOR_EVENTS_PER_HOUR = 600;
const IP_EVENTS_PER_HOUR = 5_000;
export const MIN_REPORT_DAYS = 7;
export const MAX_REPORT_DAYS = 90;
const DEFAULT_REPORT_DAYS = 30;
const TOP_ROWS = 12;

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const TOKEN_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,39}$/i;
const LABEL_PATTERN = /^[\p{L}\p{N} ._:/+-]{1,60}$/u;
const HOST_PATTERN = /^[a-z0-9.-]{1,100}$/i;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
// Crawlers that run scripts (SEO tools, prerenderers) would otherwise show up as visitors.
const BOT_PATTERN = /bot\b|crawl|spider|slurp|headless|lighthouse|pagespeed|prerender|curl|wget|python|httpclient/i;
const DEVICES: ReadonlySet<string> = new Set<AnalyticsDevice>(["mobile", "tablet", "desktop"]);
const EVENT_NAMES: ReadonlySet<string> = new Set(ANALYTICS_EVENT_NAMES);

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return utcDay(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function token(value: unknown): string | null {
  return typeof value === "string" && TOKEN_PATTERN.test(value) ? value.toLowerCase() : null;
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return LABEL_PATTERN.test(trimmed) ? trimmed : null;
}

function host(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return HOST_PATTERN.test(trimmed) ? trimmed : null;
}

function country(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  // Cloudflare uses XX (unknown) and T1 (Tor).
  return COUNTRY_PATTERN.test(upper) && upper !== "XX" ? upper : null;
}

function readTouch(raw: unknown, headerCountry: string | null): AnalyticsTouch | null {
  if (raw === null || typeof raw !== "object") return null;
  const touch = raw as Record<string, unknown>;
  const device = typeof touch.device === "string" && DEVICES.has(touch.device) ? (touch.device as AnalyticsDevice) : null;
  return {
    source: label(touch.source),
    medium: label(touch.medium),
    campaign: label(touch.campaign),
    referrer: host(touch.referrer),
    landing: token(touch.landing),
    device,
    country: headerCountry ?? country(touch.country),
  };
}

// Fixed one-hour windows per key. Cheap, and generous enough that real play never hits it.
class HourlyLimiter {
  private readonly counts = new Map<string, { readonly window: number; count: number }>();

  constructor(private readonly limit: number) {}

  take(key: string, amount: number, now: number): boolean {
    const window = Math.floor(now / 3_600_000);
    const entry = this.counts.get(key);
    if (!entry || entry.window !== window) {
      if (this.counts.size > 50_000) this.counts.clear();
      this.counts.set(key, { window, count: amount });
      return amount <= this.limit;
    }
    entry.count += amount;
    return entry.count <= this.limit;
  }
}

export interface AnalyticsIngestContext {
  readonly user: { readonly id: string; readonly createdAt: number } | null;
  /** The signed-in account is one of ours (ANALYTICS_EXCLUDE_EMAILS): drop this device's data. */
  readonly excludedUser?: boolean;
  readonly ip: string;
  readonly userAgent: string | null;
  /** Cloudflare's CF-IPCountry, when the site is proxied. */
  readonly country: string | null;
}

export type AnalyticsIngestResult = { readonly ok: true; readonly accepted: number } | { readonly ok: false; readonly status: 400 | 429; readonly error: string };

// --- Report ---

export interface GrowthSummary {
  readonly activeToday: number;
  readonly active7d: number;
  readonly activeInWindow: number;
  readonly newInWindow: number;
  /** Visitors who finished at least one game in the window. */
  readonly playersInWindow: number;
  /** Average daily active visitors over the last 7 days ÷ visitors active in the last 30. */
  readonly stickiness: number | null;
  readonly gamesPerPlayerDay: number | null;
  readonly signupsInWindow: number;
  readonly sharesInWindow: number;
  /** New visitors who arrived through a shared result link. */
  readonly shareArrivals: number;
}

export interface RetentionRate {
  readonly rate: number | null;
  /** Cohort members old enough to be counted. */
  readonly eligible: number;
}

export interface GrowthRetention {
  readonly d1: RetentionRate;
  readonly d7: RetentionRate;
  readonly d30: RetentionRate;
  /** Came back on any day within the first week. Kinder to small samples than exact-day D7. */
  readonly week1: RetentionRate;
  /** The same week-one return rate, counting only visitors who finished a game on day 0. */
  readonly week1Players: RetentionRate;
}

export interface GrowthCohort {
  /** Monday of the cohort's week. */
  readonly week: string;
  readonly visitors: number;
  readonly played: number;
  readonly d1: RetentionRate;
  readonly d7: RetentionRate;
  readonly d30: RetentionRate;
}

export interface GrowthDay {
  readonly date: string;
  readonly active: number;
  readonly newVisitors: number;
  readonly returning: number;
  readonly players: number;
  readonly games: number;
  readonly shares: number;
}

export interface GrowthSourceRow {
  readonly source: string;
  readonly visitors: number;
  readonly played: number;
  readonly signups: number;
  readonly week1: RetentionRate;
}

export interface GrowthGameRow {
  readonly game: string;
  readonly openers: number;
  readonly players: number;
  readonly completions: number;
  /** players ÷ openers: did people who opened it finish a game? */
  readonly completionRate: number | null;
  /** Share of this game's players who finished it on two or more days. */
  readonly repeatRate: number | null;
  readonly shares: number;
  /** Week-one return rate of new visitors whose first finished game was this one. */
  readonly firstGameWeek1: RetentionRate;
}

export interface GrowthFunnel {
  readonly visited: number;
  readonly openedGame: number;
  readonly finishedGame: number;
  readonly shared: number;
  readonly signedUp: number;
  readonly cameBack: number;
}

export interface GrowthBreakdownRow {
  readonly key: string;
  readonly visitors: number;
}

export interface GrowthReport {
  readonly generatedAt: number;
  readonly days: number;
  readonly from: string;
  readonly to: string;
  readonly summary: GrowthSummary;
  readonly retention: GrowthRetention;
  readonly cohorts: readonly GrowthCohort[];
  readonly series: readonly GrowthDay[];
  readonly funnel: GrowthFunnel;
  readonly sources: readonly GrowthSourceRow[];
  readonly campaigns: readonly GrowthBreakdownRow[];
  readonly games: readonly GrowthGameRow[];
  readonly landings: readonly GrowthBreakdownRow[];
  readonly devices: readonly GrowthBreakdownRow[];
  readonly countries: readonly GrowthBreakdownRow[];
}

const REFERRER_LABELS: readonly (readonly [RegExp, string])[] = [
  [/(^|\.)google\./, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)(reddit\.com|redd\.it)$/, "reddit"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "x"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)(discord\.com|discordapp\.com)$/, "discord"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/^news\.ycombinator\.com$/, "hacker news"],
  [/(^|\.)producthunt\.com$/, "product hunt"],
  [/(^|\.)github\.com$/, "github"],
];

/** The acquisition channel for a visitor's first touch: utm_source/ref, else the referrer, else direct. */
export function sourceLabel(touch: Pick<AnalyticsTouch, "source" | "referrer">): string {
  if (touch.source) return touch.source;
  if (touch.referrer) {
    const match = REFERRER_LABELS.find(([pattern]) => pattern.test(touch.referrer!));
    return match ? match[1] : touch.referrer.replace(/^www\./, "");
  }
  return "direct";
}

function rate(hits: number, eligible: number): RetentionRate {
  return { rate: eligible > 0 ? hits / eligible : null, eligible };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

function countBy(values: Iterable<string>): GrowthBreakdownRow[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([key, visitors]) => ({ key, visitors })).sort((a, b) => b.visitors - a.visitors || a.key.localeCompare(b.key)).slice(0, TOP_ROWS);
}

export class AnalyticsService {
  private readonly clock: () => number;
  private readonly visitorLimiter = new HourlyLimiter(VISITOR_EVENTS_PER_HOUR);
  private readonly ipLimiter = new HourlyLimiter(IP_EVENTS_PER_HOUR);

  constructor(private readonly store: AnalyticsStore, options: { readonly clock?: () => number } = {}) {
    this.clock = options.clock ?? Date.now;
  }

  /** Validates a client batch from POST /api/events and stores what passes. */
  ingest(body: unknown, context: AnalyticsIngestContext): AnalyticsIngestResult {
    if (context.userAgent && BOT_PATTERN.test(context.userAgent)) return { ok: true, accepted: 0 };
    if (body === null || typeof body !== "object") return { ok: false, status: 400, error: "Expected a JSON object." };
    const input = body as Record<string, unknown>;
    const visitorId = typeof input.visitorId === "string" && ID_PATTERN.test(input.visitorId) ? input.visitorId : null;
    if (!visitorId) return { ok: false, status: 400, error: "Invalid visitor id." };
    // Our own accounts: forget this device entirely, including what it did signed out.
    if (context.excludedUser) {
      this.store.exclude(visitorId, this.clock());
      return { ok: true, accepted: 0 };
    }
    if (this.store.isExcluded(visitorId)) return { ok: true, accepted: 0 };
    const sessionId = typeof input.sessionId === "string" && ID_PATTERN.test(input.sessionId) ? input.sessionId : null;
    if (!Array.isArray(input.events) || input.events.length === 0 || input.events.length > MAX_EVENTS_PER_BATCH) {
      return { ok: false, status: 400, error: `Send between 1 and ${MAX_EVENTS_PER_BATCH} events.` };
    }

    const now = this.clock();
    if (!this.ipLimiter.take(context.ip, input.events.length, now) || !this.visitorLimiter.take(visitorId, input.events.length, now)) {
      return { ok: false, status: 429, error: "Too many events." };
    }

    const events: AnalyticsEventRow[] = [];
    for (const raw of input.events as unknown[]) {
      if (raw === null || typeof raw !== "object") continue;
      const event = raw as Record<string, unknown>;
      if (typeof event.name !== "string" || !EVENT_NAMES.has(event.name)) continue;
      const sent = typeof event.time === "number" && Number.isFinite(event.time) ? event.time : now;
      if (sent < now - MAX_EVENT_AGE_MS) continue;
      const time = Math.min(sent, now + MAX_CLOCK_SKEW_MS);
      events.push({
        time,
        day: utcDay(time),
        visitorId,
        sessionId,
        userId: context.user?.id ?? null,
        name: event.name as AnalyticsEventName,
        screen: token(event.screen),
        game: token(event.game),
        mode: token(event.mode),
        detail: token(event.detail),
      });
    }
    if (events.length === 0) return { ok: true, accepted: 0 };

    this.store.record({ visitorId, now, touch: readTouch(input.touch, country(context.country)), user: context.user, events });
    return { ok: true, accepted: events.length };
  }

  pruneEvents(before: number): number {
    return this.store.pruneEvents(before);
  }

  /**
   * Devices seen since `since`, merged into people: devices linked to the same account become
   * one visitor (id `user:<id>`) that arrived when its first device did, with that device's touch.
   * Older devices of those accounts are loaded too, so a returning player on a new phone isn't new.
   */
  private people(since: number): { readonly visitors: readonly AnalyticsVisitor[]; readonly personOf: (visitorId: string) => string } {
    const seen = this.store.visitorsSeenSince(since);
    const userIds = [...new Set(seen.flatMap((visitor) => (visitor.userId ? [visitor.userId] : [])))];
    const devices = new Map(seen.map((visitor) => [visitor.visitorId, visitor]));
    if (userIds.length > 0) for (const visitor of this.store.visitorsOfUsers(userIds)) devices.set(visitor.visitorId, visitor);
    const personIds = new Map<string, string>();
    const groups = new Map<string, AnalyticsVisitor[]>();
    for (const device of devices.values()) {
      const person = device.userId ? `user:${device.userId}` : device.visitorId;
      personIds.set(device.visitorId, person);
      const group = groups.get(person);
      if (group) group.push(device);
      else groups.set(person, [device]);
    }
    const visitors = [...groups].map(([person, group]): AnalyticsVisitor => {
      if (group.length === 1) return { ...group[0]!, visitorId: person };
      const first = [...group].sort((a, b) => a.firstSeenAt - b.firstSeenAt)[0]!;
      const signups = group.flatMap((device) => (device.signedUpAt === null ? [] : [device.signedUpAt]));
      return {
        ...first,
        visitorId: person,
        lastSeenAt: Math.max(...group.map((device) => device.lastSeenAt)),
        signedUpAt: signups.length > 0 ? Math.min(...signups) : null,
      };
    });
    return { visitors, personOf: (visitorId) => personIds.get(visitorId) ?? visitorId };
  }

  report(requestedDays: number = DEFAULT_REPORT_DAYS): GrowthReport {
    const days = Math.min(MAX_REPORT_DAYS, Math.max(MIN_REPORT_DAYS, Math.round(Number.isFinite(requestedDays) ? requestedDays : DEFAULT_REPORT_DAYS)));
    const now = this.clock();
    const today = utcDay(now);
    const from = addDays(today, -(days - 1));
    const windowStart = Date.parse(`${from}T00:00:00Z`);
    // Stickiness compares against a 30-day base even when the window is shorter.
    const baseFrom = addDays(today, -(Math.max(days, 30) - 1));

    // From here on a "visitor" is a person: every device of a signed-in account counts as one.
    const { visitors, personOf } = this.people(Math.min(windowStart, Date.parse(`${baseFrom}T00:00:00Z`)));
    const byId = new Map(visitors.map((visitor) => [visitor.visitorId, visitor]));
    const activeDays = new Map<string, Set<string>>();
    for (const row of this.store.activeDaysSince(baseFrom)) {
      const person = personOf(row.visitorId);
      let set = activeDays.get(person);
      if (!set) activeDays.set(person, (set = new Set()));
      set.add(row.day);
    }
    const events = this.store.eventsSince(windowStart).map((event) => ({ ...event, visitorId: personOf(event.visitorId) }));

    const cohort = visitors.filter((visitor) => visitor.firstDay >= from);
    const activeOn = (visitorId: string, day: string) => activeDays.get(visitorId)?.has(day) ?? false;
    const activeWithin = (visitor: AnalyticsVisitor, first: number, last: number) => {
      for (let offset = first; offset <= last; offset += 1) if (activeOn(visitor.visitorId, addDays(visitor.firstDay, offset))) return true;
      return false;
    };
    // A cohort member counts for day N once day N is over.
    const eligible = (visitor: AnalyticsVisitor, offset: number) => dayDiff(visitor.firstDay, today) > offset;
    const exactRetention = (members: readonly AnalyticsVisitor[], offset: number) => {
      const counted = members.filter((visitor) => eligible(visitor, offset));
      return rate(counted.filter((visitor) => activeOn(visitor.visitorId, addDays(visitor.firstDay, offset))).length, counted.length);
    };
    const weekOne = (members: readonly AnalyticsVisitor[]) => {
      const counted = members.filter((visitor) => eligible(visitor, 7));
      return rate(counted.filter((visitor) => activeWithin(visitor, 1, 7)).length, counted.length);
    };

    // Per-visitor facts from the window's events.
    const opened = new Set<string>();
    const played = new Set<string>();
    const sharedBy = new Set<string>();
    const playedOnFirstDay = new Set<string>();
    const firstGame = new Map<string, { readonly time: number; readonly game: string }>();
    interface GameTally { openers: Set<string>; players: Set<string>; completions: number; shares: number; playerDays: Map<string, Set<string>> }
    const games = new Map<string, GameTally>();
    const tally = (game: string) => {
      let entry = games.get(game);
      if (!entry) games.set(game, (entry = { openers: new Set(), players: new Set(), completions: 0, shares: 0, playerDays: new Map() }));
      return entry;
    };
    const dayStats = new Map<string, { players: Set<string>; games: number; shares: number }>();
    const dayEntry = (day: string) => {
      let entry = dayStats.get(day);
      if (!entry) dayStats.set(day, (entry = { players: new Set(), games: 0, shares: 0 }));
      return entry;
    };

    for (const event of events) {
      const visitor = byId.get(event.visitorId);
      if (event.name === "view" && event.game) {
        opened.add(event.visitorId);
        tally(event.game).openers.add(event.visitorId);
      } else if (event.name === "game_complete") {
        played.add(event.visitorId);
        if (visitor && event.day === visitor.firstDay) playedOnFirstDay.add(event.visitorId);
        const day = dayEntry(event.day);
        day.players.add(event.visitorId);
        day.games += 1;
        if (event.game) {
          const entry = tally(event.game);
          entry.players.add(event.visitorId);
          entry.completions += 1;
          let playerDays = entry.playerDays.get(event.visitorId);
          if (!playerDays) entry.playerDays.set(event.visitorId, (playerDays = new Set()));
          playerDays.add(event.day);
          const earliest = firstGame.get(event.visitorId);
          if (!earliest || event.time < earliest.time) firstGame.set(event.visitorId, { time: event.time, game: event.game });
        }
      } else if (event.name === "share") {
        sharedBy.add(event.visitorId);
        dayEntry(event.day).shares += 1;
        if (event.game) tally(event.game).shares += 1;
      }
    }

    const series: GrowthDay[] = [];
    for (let offset = 0; offset < days; offset += 1) {
      const date = addDays(from, offset);
      let active = 0;
      let newVisitors = 0;
      for (const [visitorId, set] of activeDays) {
        if (!set.has(date)) continue;
        active += 1;
        if (byId.get(visitorId)?.firstDay === date) newVisitors += 1;
      }
      const stats = dayStats.get(date);
      series.push({ date, active, newVisitors, returning: active - newVisitors, players: stats?.players.size ?? 0, games: stats?.games ?? 0, shares: stats?.shares ?? 0 });
    }

    const activeSince = (day: string) => [...activeDays.values()].filter((set) => [...set].some((d) => d >= day)).length;
    const last7From = addDays(today, -6);
    const dauLast7 = [...activeDays.values()].reduce((sum, set) => sum + [...set].filter((d) => d >= last7From).length, 0) / 7;
    const mau = activeSince(addDays(today, -29));
    const playerDays = series.reduce((sum, day) => sum + day.players, 0);
    const totalGames = series.reduce((sum, day) => sum + day.games, 0);
    const signedUp = cohort.filter((visitor) => visitor.signedUpAt !== null);

    const summary: GrowthSummary = {
      activeToday: series[series.length - 1]?.active ?? 0,
      active7d: activeSince(last7From),
      activeInWindow: activeSince(from),
      newInWindow: cohort.length,
      playersInWindow: played.size,
      stickiness: ratio(dauLast7, mau),
      gamesPerPlayerDay: ratio(totalGames, playerDays),
      signupsInWindow: signedUp.length,
      sharesInWindow: series.reduce((sum, day) => sum + day.shares, 0),
      shareArrivals: cohort.filter((visitor) => visitor.source === "share").length,
    };

    const retention: GrowthRetention = {
      d1: exactRetention(cohort, 1),
      d7: exactRetention(cohort, 7),
      d30: exactRetention(cohort, 30),
      week1: weekOne(cohort),
      week1Players: weekOne(cohort.filter((visitor) => playedOnFirstDay.has(visitor.visitorId))),
    };

    const cohorts: GrowthCohort[] = [...groupBy(cohort, (visitor) => mondayOf(visitor.firstDay))]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([week, members]) => ({
        week,
        visitors: members.length,
        played: members.filter((visitor) => played.has(visitor.visitorId)).length,
        d1: exactRetention(members, 1),
        d7: exactRetention(members, 7),
        d30: exactRetention(members, 30),
      }));

    const sources: GrowthSourceRow[] = [...groupBy(cohort, sourceLabel)]
      .map(([source, members]) => ({
        source,
        visitors: members.length,
        played: members.filter((visitor) => played.has(visitor.visitorId)).length,
        signups: members.filter((visitor) => visitor.signedUpAt !== null).length,
        week1: weekOne(members),
      }))
      .sort((a, b) => b.visitors - a.visitors || a.source.localeCompare(b.source))
      .slice(0, TOP_ROWS * 2);

    const firstGameMembers = groupBy(cohort.filter((visitor) => firstGame.has(visitor.visitorId)), (visitor) => firstGame.get(visitor.visitorId)!.game);
    const gameRows: GrowthGameRow[] = [...games]
      .map(([game, entry]) => ({
        game,
        openers: entry.openers.size,
        players: entry.players.size,
        completions: entry.completions,
        completionRate: ratio(entry.players.size, Math.max(entry.openers.size, entry.players.size)),
        repeatRate: ratio([...entry.playerDays.values()].filter((set) => set.size >= 2).length, entry.players.size),
        shares: entry.shares,
        firstGameWeek1: weekOne(firstGameMembers.get(game) ?? []),
      }))
      .sort((a, b) => b.players - a.players || b.openers - a.openers || a.game.localeCompare(b.game));

    const funnel: GrowthFunnel = {
      visited: cohort.length,
      openedGame: cohort.filter((visitor) => opened.has(visitor.visitorId) || played.has(visitor.visitorId)).length,
      finishedGame: cohort.filter((visitor) => played.has(visitor.visitorId)).length,
      shared: cohort.filter((visitor) => sharedBy.has(visitor.visitorId)).length,
      signedUp: signedUp.length,
      cameBack: cohort.filter((visitor) => [...(activeDays.get(visitor.visitorId) ?? [])].some((day) => day > visitor.firstDay)).length,
    };

    return {
      generatedAt: now,
      days,
      from,
      to: today,
      summary,
      retention,
      cohorts,
      series,
      funnel,
      sources,
      campaigns: countBy(cohort.filter((visitor) => visitor.campaign).map((visitor) => `${sourceLabel(visitor)} · ${visitor.campaign}`)),
      games: gameRows,
      landings: countBy(cohort.map((visitor) => visitor.landing ?? "unknown")),
      devices: countBy(cohort.map((visitor) => visitor.device ?? "unknown")),
      countries: countBy(cohort.map((visitor) => visitor.country ?? "unknown")),
    };
  }
}
