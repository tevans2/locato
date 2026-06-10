import type { AuthService } from "./AuthService";
import { readSessionToken, serializeClearCookie, serializeSessionCookie, type CookieOptions } from "./cookies";
import { buildAuthUrl, consumeOAuthState, exchangeOAuthCode, saveOAuthState } from "./oauth";
import { createOAuthState } from "./tokens";
import type { GameResult } from "./types";

const MAX_STAT_VALUE = 1_000_000;

function ip(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function log(level: "info" | "warn", action: string, details: Record<string, unknown>): void {
  const entry = { time: new Date().toISOString(), level, action, ...details };
  // eslint-disable-next-line no-console
  console[level](JSON.stringify(entry));
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_STAT_VALUE;
}

// Durations can exceed the small per-game stat cap (a long world-map run is many minutes).
function isDurationMs(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 86_400_000;
}

function parseGameResult(body: Record<string, unknown>): GameResult | null {
  const { mode, categoryIds, correctAnswers, wrongAnswers, score, bestStreak, rank, totalPlayers, durationMs, completed, countriesFound, countriesTotal, playMode } = body;
  if (mode !== "solo" && mode !== "multiplayer" && mode !== "world-map") return null;
  if (!Array.isArray(categoryIds) || categoryIds.length === 0) return null;
  if (![correctAnswers, wrongAnswers, score, bestStreak].every(isNonNegInt)) return null;
  const result: Record<string, unknown> = { mode, categoryIds: categoryIds.map(String), correctAnswers: correctAnswers as number, wrongAnswers: wrongAnswers as number, score: score as number, bestStreak: bestStreak as number };
  if (isNonNegInt(rank)) result.rank = rank;
  if (isNonNegInt(totalPlayers)) result.totalPlayers = totalPlayers;
  if (mode === "world-map") {
    if (isDurationMs(durationMs)) result.durationMs = durationMs;
    if (typeof completed === "boolean") result.completed = completed;
    if (isNonNegInt(countriesFound)) result.countriesFound = countriesFound;
    if (isNonNegInt(countriesTotal)) result.countriesTotal = countriesTotal;
    if (typeof playMode === "string") result.playMode = playMode;
  }
  return result as unknown as GameResult;
}

// Returns a Response for any /auth/* or /api/* route it owns, or null so the caller falls
// through to static file serving. Cookies are HttpOnly so the session token is never exposed to JS.
export async function handleAuthRequest(request: Request, url: URL, service: AuthService, cookieOptions: CookieOptions, baseUrl: string): Promise<Response | null> {
  const { pathname } = url;
  const { method } = request;

  if (pathname === "/auth/register" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = await service.register(body);
    if (!result.ok) {
      log("warn", "register.failed", { ip: ip(request), reason: result.error, status: result.status });
      return json({ error: result.error }, result.status);
    }
    log("info", "register.ok", { ip: ip(request), userId: result.user.id, email: result.user.email });
    return json({ user: result.user }, 201, { "set-cookie": serializeSessionCookie(result.session.id, service.sessionMaxAgeSeconds, cookieOptions) });
  }

  if (pathname === "/auth/login" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = await service.login(body);
    if (!result.ok) {
      log("warn", "login.failed", { ip: ip(request), email: typeof body?.email === "string" ? body.email : null, reason: result.error });
      return json({ error: result.error }, result.status);
    }
    log("info", "login.ok", { ip: ip(request), userId: result.user.id, email: result.user.email });
    return json({ user: result.user }, 200, { "set-cookie": serializeSessionCookie(result.session.id, service.sessionMaxAgeSeconds, cookieOptions) });
  }

  if (pathname === "/auth/logout" && method === "POST") {
    const token = readSessionToken(request);
    const user = service.authenticate(token);
    service.logout(token);
    log("info", "logout", { ip: ip(request), userId: user?.id ?? null });
    return json({ ok: true }, 200, { "set-cookie": serializeClearCookie(cookieOptions) });
  }

  if (pathname === "/auth/avatar" && method === "PATCH") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readJsonBody(request);
    const emoji = typeof body?.emoji === "string" && body.emoji.length > 0 ? body.emoji : null;
    service.updateAvatarEmoji(user.id, emoji);
    log("info", "avatar.update", { ip: ip(request), userId: user.id });
    return json({ ok: true });
  }

  if (pathname === "/auth/me" && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    return json({ user, stats: service.getStats(user.id) });
  }

  if (pathname === "/api/games" && method === "POST") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = parseGameResult(body);
    if (!result) return json({ error: "Invalid game result." }, 400);
    log("info", "game.recorded", { ip: ip(request), userId: user.id, mode: result.mode, correct: result.correctAnswers });
    return json({ stats: service.recordGame(user.id, result) });
  }

  if (pathname === "/api/stats" && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    return json(service.getFullStats(user.id));
  }

  if (pathname === "/auth/github" && method === "GET") {
    log("info", "oauth.start", { ip: ip(request), provider: "github" });
    const state = createOAuthState();
    saveOAuthState(state, "github", Date.now());
    return redirect(buildAuthUrl("github", state, baseUrl));
  }

  if (pathname === "/auth/github/callback" && method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const provider = state ? consumeOAuthState(state, Date.now()) : null;
    if (!provider || !code) {
      log("warn", "oauth.callback.invalid", { ip: ip(request), provider: "github" });
      return redirect("/?error=auth");
    }
    try {
      const profile = await exchangeOAuthCode("github", code, baseUrl);
      const authUser = service.upsertOAuthUser("github", profile.id, profile);
      const session = service.createSessionFor(authUser.id);
      log("info", "oauth.ok", { ip: ip(request), provider: "github", userId: authUser.id, email: authUser.email });
      return new Response(null, { status: 302, headers: { Location: "/", "set-cookie": serializeSessionCookie(session.id, service.sessionMaxAgeSeconds, cookieOptions) } });
    } catch (error) {
      log("warn", "oauth.error", { ip: ip(request), provider: "github", error: String(error) });
      return redirect("/?error=auth");
    }
  }

  if (pathname === "/auth/google" && method === "GET") {
    log("info", "oauth.start", { ip: ip(request), provider: "google" });
    const state = createOAuthState();
    saveOAuthState(state, "google", Date.now());
    return redirect(buildAuthUrl("google", state, baseUrl));
  }

  if (pathname === "/auth/google/callback" && method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const provider = state ? consumeOAuthState(state, Date.now()) : null;
    if (!provider || !code) {
      log("warn", "oauth.callback.invalid", { ip: ip(request), provider: "google" });
      return redirect("/?error=auth");
    }
    try {
      const profile = await exchangeOAuthCode("google", code, baseUrl);
      const authUser = service.upsertOAuthUser("google", profile.id, profile);
      const session = service.createSessionFor(authUser.id);
      log("info", "oauth.ok", { ip: ip(request), provider: "google", userId: authUser.id, email: authUser.email });
      return new Response(null, { status: 302, headers: { Location: "/", "set-cookie": serializeSessionCookie(session.id, service.sessionMaxAgeSeconds, cookieOptions) } });
    } catch (error) {
      log("warn", "oauth.error", { ip: ip(request), provider: "google", error: String(error) });
      return redirect("/?error=auth");
    }
  }

  return null;
}
