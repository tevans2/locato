// First-party product analytics: anonymous visitors (a random id in localStorage), the days
// they were active, and a short list of events. Enough for retention, acquisition sources and
// per-game engagement without a third-party tracker. No IP addresses are stored here.

export const ANALYTICS_EVENT_NAMES = ["visit", "view", "game_complete", "share", "sign_in"] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export type AnalyticsDevice = "mobile" | "tablet" | "desktop";

/** Where a visit came from, as the client saw it on the first page of a session. */
export interface AnalyticsTouch {
  /** utm_source, else the `ref` parameter (e.g. "share"). */
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  /** Referring host only (e.g. "www.reddit.com"), never the full URL. */
  readonly referrer: string | null;
  /** The screen the visit opened on (a route type such as "daily-challenge"). */
  readonly landing: string | null;
  readonly device: AnalyticsDevice | null;
  /** ISO country: Cloudflare's header when present, else the browser language's region. */
  readonly country: string | null;
}

export interface AnalyticsEventRow {
  readonly time: number;
  /** UTC calendar day, YYYY-MM-DD. */
  readonly day: string;
  readonly visitorId: string;
  readonly sessionId: string | null;
  readonly userId: string | null;
  readonly name: AnalyticsEventName;
  /** The route type the event happened on. */
  readonly screen: string | null;
  /** The game it belongs to ("daily", "flags", "overland"…), when there is one. */
  readonly game: string | null;
  /** "daily", "practice", "timed" or "multiplayer". */
  readonly mode: string | null;
  /** A short extra, e.g. how a share went ("shared" / "copied"). */
  readonly detail: string | null;
}

export interface AnalyticsVisitor extends AnalyticsTouch {
  readonly visitorId: string;
  readonly firstSeenAt: number;
  readonly firstDay: string;
  readonly lastSeenAt: number;
  readonly userId: string | null;
  /** Set when the linked account was created after this visitor first arrived. */
  readonly signedUpAt: number | null;
}

export interface AnalyticsVisitorDay {
  readonly visitorId: string;
  readonly day: string;
}

export interface AnalyticsBatch {
  readonly visitorId: string;
  readonly now: number;
  /** Only the first touch a visitor arrives with is kept. */
  readonly touch: AnalyticsTouch | null;
  readonly user: { readonly id: string; readonly createdAt: number } | null;
  readonly events: readonly AnalyticsEventRow[];
}

export interface AnalyticsStore {
  /** Creates the visitor on first sight, links a signed-in account and marks each event's day active. */
  record(batch: AnalyticsBatch): void;
  /** True once a device has been seen signed in to an excluded account. */
  isExcluded(visitorId: string): boolean;
  /** Marks a device as excluded and deletes everything it recorded. */
  exclude(visitorId: string, now: number): void;
  /** Visitors whose last activity is at or after `since`, excluded devices left out. */
  visitorsSeenSince(since: number): readonly AnalyticsVisitor[];
  /** Every device linked to these accounts, however long ago it was last seen (excluded ones left out). */
  visitorsOfUsers(userIds: readonly string[]): readonly AnalyticsVisitor[];
  /** Active visitor-days on or after `day`. */
  activeDaysSince(day: string): readonly AnalyticsVisitorDay[];
  eventsSince(since: number): readonly AnalyticsEventRow[];
  /** Drops raw events before `before`. Visitors and active days are kept (they're small). */
  pruneEvents(before: number): number;
}
