import type { AuthService } from "./AuthService";
import { readSessionToken, serializeClearCookie, serializeSessionCookie, type CookieOptions } from "./cookies";
import { buildAuthUrl, consumeOAuthState, exchangeOAuthCode, saveOAuthState } from "./oauth";
import { createOAuthState } from "./tokens";
import { NOOP_SOCIAL, type SocialBridge } from "../../src/core/social/socialProtocol";
import type { AuthUser, GameResult } from "./types";

const MAX_STAT_VALUE = 1_000_000;

function publicRef(user: AuthUser) {
  return { id: user.id, username: user.displayName, avatarEmoji: user.avatarEmoji };
}

function ip(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// Constant-time string comparison so the admin token can't be recovered via response timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Admin requests authenticate with the out-of-band ADMIN_TOKEN, not a user session. Accepts
// either `Authorization: Bearer <token>` or `x-admin-token: <token>`.
function isAuthorizedAdmin(request: Request, adminToken: string): boolean {
  const header = request.headers.get("authorization");
  const bearer = header && header.startsWith("Bearer ") ? header.slice(7) : null;
  const provided = bearer ?? request.headers.get("x-admin-token");
  return provided !== null && safeEqual(provided, adminToken);
}

function intParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
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
export async function handleAuthRequest(request: Request, url: URL, service: AuthService, cookieOptions: CookieOptions, baseUrl: string, adminToken: string | null = null, social: SocialBridge = NOOP_SOCIAL): Promise<Response | null> {
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

  if (pathname === "/api/leaderboard" && method === "GET") {
    const gameMode = url.searchParams.get("mode") ?? "";
    const variant = url.searchParams.get("variant") ?? "";
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset"));
    const result = service.getLeaderboard({
      gameMode,
      variant,
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(Number.isFinite(offset) ? { offset } : {}),
    });
    if ("error" in result) return json({ error: result.error }, 400);

    const user = service.authenticate(readSessionToken(request));
    const currentUser =
      user === null
        ? null
        : service.getUserLeaderboardRank(user.id, gameMode, variant === "" ? "" : variant);
    return json({ entries: result.entries, currentUser });
  }

  if (pathname === "/api/leaderboard" && method === "POST") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = service.submitBestTime(user.id, body);
    if ("error" in result) return json({ error: result.error }, 400);
    return json(result);
  }

  // --- Admin account controls (gated by ADMIN_TOKEN; the surface stays hidden when unset) ---
  if (pathname.startsWith("/api/admin/")) {
    if (!adminToken) return null; // not configured → fall through to static (404), surface hidden
    if (!isAuthorizedAdmin(request, adminToken)) {
      log("warn", "admin.unauthorized", { ip: ip(request), path: pathname });
      return json({ error: "Forbidden." }, 403);
    }

    if (pathname === "/api/admin/users" && method === "GET") {
      const result = service.listUsers({ q: url.searchParams.get("q") ?? undefined, limit: intParam(url, "limit"), offset: intParam(url, "offset") });
      return json(result);
    }

    const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch) {
      const id = decodeURIComponent(userMatch[1]!);
      if (method === "GET") {
        const detail = service.getUserDetail(id);
        return detail ? json(detail) : json({ error: "User not found." }, 404);
      }
      if (method === "DELETE") {
        const deleted = service.deleteUser(id);
        log("info", "admin.user.delete", { ip: ip(request), targetUserId: id, deleted });
        return deleted ? json({ ok: true, deleted: id }) : json({ error: "User not found." }, 404);
      }
    }

    const sessionsMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/sessions$/);
    if (sessionsMatch && method === "DELETE") {
      const id = decodeURIComponent(sessionsMatch[1]!);
      const revoked = service.revokeUserSessions(id);
      log("info", "admin.user.logout", { ip: ip(request), targetUserId: id, revoked });
      return json({ ok: true, revoked });
    }

    return json({ error: "Unknown admin route." }, 404);
  }

  // --- Friends ---
  if (pathname === "/api/friends" && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const friends = service.listFriends(user.id).map((u) => ({ user: u, online: social.isOnline(u.id) }));
    const requests = service.listFriendRequests(user.id);
    return json({ friends, incoming: requests.incoming, outgoing: requests.outgoing });
  }

  if (pathname === "/api/users/search" && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    return json({ users: service.searchUsers(user.id, url.searchParams.get("q")) });
  }

  if (pathname === "/api/friends/requests" && method === "POST") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = service.sendFriendRequest(user.id, body.username);
    if (result === "self") return json({ error: "You can't add yourself." }, 400);
    if (result === "not-found") return json({ error: "No user with that username." }, 404);
    if (result === "rate-limited") return json({ error: "Too many requests. Try again shortly." }, 429);
    if (result === "exists") return json({ error: "You're already friends or have a pending request." }, 409);
    const targetId = service.resolveUserId(body.username);
    if (targetId) social.notify(targetId, result === "accepted" ? { type: "FRIEND_ACCEPTED", user: publicRef(user) } : { type: "FRIEND_REQUEST", from: publicRef(user) });
    log("info", "friend.request", { ip: ip(request), userId: user.id, result });
    return json({ status: result });
  }

  const acceptMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)\/accept$/);
  if (acceptMatch && method === "POST") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const requesterId = decodeURIComponent(acceptMatch[1]!);
    const ok = service.acceptFriendRequest(user.id, requesterId);
    if (ok) social.notify(requesterId, { type: "FRIEND_ACCEPTED", user: publicRef(user) });
    return ok ? json({ ok: true }) : json({ error: "No pending request from that user." }, 404);
  }

  const requestMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)$/);
  if (requestMatch && method === "DELETE") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const otherId = decodeURIComponent(requestMatch[1]!);
    const ok = service.removeFriendship(user.id, otherId);
    if (ok) social.notify(otherId, { type: "FRIENDS_CHANGED" });
    return ok ? json({ ok: true }) : json({ error: "No such request." }, 404);
  }

  const friendMatch = pathname.match(/^\/api\/friends\/([^/]+)$/);
  if (friendMatch && method === "DELETE") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const otherId = decodeURIComponent(friendMatch[1]!);
    const ok = service.removeFriendship(user.id, otherId);
    if (ok) social.notify(otherId, { type: "FRIENDS_CHANGED" });
    return ok ? json({ ok: true }) : json({ error: "Not friends." }, 404);
  }

  if (pathname === "/api/friends/invite" && method === "POST") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const targetId = typeof body.userId === "string" ? body.userId : "";
    const roomCode = typeof body.roomCode === "string" ? body.roomCode.trim() : "";
    if (roomCode.length === 0 || roomCode.length > 12) return json({ error: "Invalid room code." }, 400);
    if (!service.areFriends(user.id, targetId)) return json({ error: "You can only invite friends." }, 403);
    if (!social.isOnline(targetId)) return json({ error: "That friend is offline." }, 409);
    social.notify(targetId, { type: "GAME_INVITE", from: publicRef(user), roomCode });
    log("info", "friend.invite", { ip: ip(request), userId: user.id, targetUserId: targetId });
    return json({ ok: true });
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
