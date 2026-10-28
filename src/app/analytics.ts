import { routeFromLocation, type AppRoute } from "./router";

// First-party product analytics (server/analytics): an anonymous visitor id in localStorage,
// a 30-minute session, and a handful of events batched to POST /api/events. Nothing here
// identifies a person; a signed-in session cookie only links the visitor to its account.
// Opt out on a device with localStorage["locato.analytics.optout"] = "1".

const VISITOR_KEY = "locato.analytics.visitor";
const SESSION_KEY = "locato.analytics.session";
const OPT_OUT_KEY = "locato.analytics.optout";
const SESSION_IDLE_MS = 30 * 60_000;
const FLUSH_DELAY_MS = 4_000;
const MAX_BATCH = 50;
const ENDPOINT = "/api/events";

type EventName = "visit" | "view" | "game_complete" | "share" | "sign_in";

interface QueuedEvent {
  readonly name: EventName;
  readonly time: number;
  readonly screen?: string;
  readonly game?: string;
  readonly mode?: string;
  readonly detail?: string;
}

export interface AnalyticsTouch {
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly referrer: string | null;
  readonly landing: string | null;
  readonly device: "mobile" | "tablet" | "desktop";
  readonly country: string | null;
}

export interface RouteGame {
  readonly game: string;
  readonly mode: string;
}

/** The game a route plays, for analytics. Null for screens that aren't a game. */
export function routeGame(route: AppRoute): RouteGame | null {
  const timed = "run" in route && route.run === "timed" ? "timed" : "practice";
  switch (route.type) {
    case "solo-game": return { game: route.categoryIds?.[0] ?? "flags", mode: timed };
    case "country-guessing": return { game: route.mode ?? "name-all", mode: timed };
    case "map-tap": return { game: "map-tap", mode: timed };
    case "streetview-country":
    case "geoguessr":
    case "worldsplit":
    case "flyover": return { game: route.type, mode: "solo" };
    case "overland":
    case "mystery": return { game: route.type, mode: route.daily ? "daily" : "solo" };
    case "daily-challenge": return { game: "daily", mode: "daily" };
    case "daily-practice": return { game: "daily", mode: "practice" };
    case "multiplayer": return { game: "multiplayer", mode: "multiplayer" };
    case "academy-lesson":
    case "academy-placement": return { game: "academy", mode: "lesson" };
    default: return null;
  }
}

/** Where this page load came from: UTM tags or `ref`, the referring host, device and region. */
export function readTouch(location: Pick<Location, "search" | "host">, referrer: string, nav: Pick<Navigator, "language"> | undefined, screenSize: { width: number; height: number } | undefined, landing: string | null): AnalyticsTouch {
  const params = new URLSearchParams(location.search);
  let referrerHost: string | null = null;
  try {
    const host = referrer ? new URL(referrer).host : "";
    referrerHost = host && host !== location.host ? host : null;
  } catch {
    referrerHost = null;
  }
  const shortSide = screenSize ? Math.min(screenSize.width, screenSize.height) : 1024;
  const longSide = screenSize ? Math.max(screenSize.width, screenSize.height) : 1280;
  const device = shortSide < 600 ? "mobile" : shortSide < 900 && longSide < 1400 ? "tablet" : "desktop";
  const region = nav?.language?.split("-")[1];
  return {
    source: params.get("utm_source") ?? params.get("ref"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    referrer: referrerHost,
    landing,
    device,
    country: region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : null,
  };
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

interface AnalyticsClient {
  track(event: Omit<QueuedEvent, "time">): void;
  flush(useBeacon: boolean): void;
}

let client: AnalyticsClient | null = null;

/**
 * Starts analytics for this page. Call before the app rewrites the URL: the first touch (UTM
 * tags, `ref`) is read from the address the visitor arrived on.
 */
export function initAnalytics(win: Window = window): void {
  if (client) return;
  const storage = (() => { try { return win.localStorage; } catch { return null; } })();
  if (win.navigator.webdriver || storage?.getItem(OPT_OUT_KEY) === "1") return;

  const read = (key: string) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const write = (key: string, value: string) => { try { storage?.setItem(key, value); } catch { /* private mode */ } };

  let visitorId = read(VISITOR_KEY);
  if (!visitorId || !/^[A-Za-z0-9_-]{8,64}$/.test(visitorId)) {
    visitorId = randomId();
    write(VISITOR_KEY, visitorId);
  }
  const initialRoute = routeFromLocation(win.location) ?? { type: "landing" as const };
  // The arrival's touch belongs to the first session this page starts; later sessions (after
  // half an hour idle in the same tab) are "direct".
  let pendingTouch: AnalyticsTouch | null = readTouch(win.location, win.document.referrer, win.navigator, win.screen, initialRoute.type);
  let touchToSend: AnalyticsTouch | null = null;
  let queue: QueuedEvent[] = [];
  let timer: number | null = null;

  function session(now: number): string {
    let stored: { id?: string; lastActive?: number } = {};
    try { stored = JSON.parse(read(SESSION_KEY) ?? "{}") as typeof stored; } catch { stored = {}; }
    const fresh = !stored.id || typeof stored.lastActive !== "number" || now - stored.lastActive > SESSION_IDLE_MS;
    const id = fresh ? randomId() : stored.id!;
    write(SESSION_KEY, JSON.stringify({ id, lastActive: now }));
    if (fresh) {
      touchToSend = pendingTouch ?? { ...readTouch({ search: "", host: win.location.host }, "", win.navigator, win.screen, routeFromLocation(win.location)?.type ?? "landing") };
      queue.push({ name: "visit", time: now, screen: touchToSend.landing ?? "landing" });
    }
    pendingTouch = null;
    return id;
  }

  let sessionId = "";

  function flush(useBeacon: boolean): void {
    if (timer !== null) { win.clearTimeout(timer); timer = null; }
    if (queue.length === 0) return;
    const events = queue.slice(0, MAX_BATCH);
    queue = queue.slice(MAX_BATCH);
    const body = JSON.stringify({ visitorId, sessionId, events, ...(touchToSend && events.some((event) => event.name === "visit") ? { touch: touchToSend } : {}) });
    try {
      const sent = useBeacon && typeof win.navigator.sendBeacon === "function" && win.navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      if (!sent) void win.fetch(ENDPOINT, { method: "POST", body, headers: { "content-type": "application/json" }, credentials: "same-origin", keepalive: true }).catch(() => undefined);
    } catch {
      // Analytics must never break the game.
    }
    if (queue.length > 0) flush(useBeacon);
  }

  client = {
    track(event) {
      const now = Date.now();
      sessionId = session(now);
      queue.push({ ...event, time: now });
      if (queue.length >= MAX_BATCH) flush(false);
      else if (timer === null) timer = win.setTimeout(() => flush(false), FLUSH_DELAY_MS);
    },
    flush,
  };

  win.addEventListener("pagehide", () => flush(true));
  win.document.addEventListener("visibilitychange", () => {
    if (win.document.visibilityState === "hidden") flush(true);
  });
}

function currentRoute(): AppRoute | null {
  return typeof window === "undefined" ? null : routeFromLocation(window.location) ?? { type: "landing" };
}

/** A screen was opened. Games also count as an "open" for completion rates. */
export function trackRoute(route: AppRoute): void {
  if (!client) return;
  const game = routeGame(route);
  client.track({ name: "view", screen: route.type, ...(game ? { game: game.game, mode: game.mode } : {}) });
}

/** A game was finished. Without `game`, it is read from the current URL. */
export function trackGameComplete(game?: RouteGame & { readonly detail?: string }): void {
  if (!client) return;
  const route = currentRoute();
  const resolved = game ?? (route ? routeGame(route) : null);
  if (!resolved) return;
  client.track({ name: "game_complete", ...(route ? { screen: route.type } : {}), game: resolved.game, mode: resolved.mode, ...(game?.detail ? { detail: game.detail } : {}) });
}

/**
 * Someone signed in on this page. Sent at once, so the server links this device to the account
 * straight away (and forgets it, for our own excluded accounts) even if nothing else follows.
 */
export function trackSignIn(): void {
  if (!client) return;
  client.track({ name: "sign_in" });
  client.flush(false);
}

/** A solo run reached its results card. The daily counts itself once, at its own finish. */
export function trackRunComplete(): void {
  const route = currentRoute();
  if (route?.type === "daily-challenge" || route?.type === "daily-practice") return;
  trackGameComplete();
}

/** A result was shared (or copied); the game is read from the current URL. */
export function trackShare(outcome: "shared" | "copied" | "failed"): void {
  if (!client) return;
  const route = currentRoute();
  const game = route ? routeGame(route) : null;
  client.track({ name: "share", ...(route ? { screen: route.type } : {}), ...(game ? { game: game.game, mode: game.mode } : {}), detail: outcome });
  // Sharing often switches apps; send now rather than on the timer.
  client.flush(true);
}
