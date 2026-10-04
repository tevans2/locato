import type { AuthService, RunAuditResult, RunRequestMeta } from "./AuthService";
import { readSessionToken, serializeClearCookie, serializeSessionCookie, type CookieOptions } from "./cookies";
import { buildAuthUrl, consumeOAuthState, exchangeOAuthCode, saveOAuthState } from "./oauth";
import { createOAuthState } from "./tokens";
import { NOOP_SOCIAL, type SocialBridge } from "../../src/core/social/socialProtocol";
import { logEvent } from "../admin/events";
import { handleAdminRoutes, type AdminRouteContext } from "../admin/routes";
import { MAX_ACADEMY_PAYLOAD_BYTES } from "../academy/validation";
import { leaderboardMetric } from "../leaderboard/validation";
import type { AuthUser, DailyChallengeResult, DailyRoundMark, GameResult } from "./types";
import { parseDailyRoundResults, scoreDailyRound } from "../../src/core/dailyChallenge";
import { isAvatarEmoji } from "../../src/core/auth/avatars";

const MAX_STAT_VALUE = 1_000_000;
const DAILY_COUNTRY_COUNT = 10;
const DAILY_MAX_SCORE = 100;

function publicRef(user: AuthUser) {
  return { id: user.id, username: user.displayName, avatarEmoji: user.avatarEmoji };
}

function ip(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// A run's timeline is one short entry per country found: a few KB for Name all countries.
const MAX_RUN_PAYLOAD_BYTES = 32 * 1024;

function runMeta(request: Request): RunRequestMeta {
  return { ip: ip(request), userAgent: request.headers.get("user-agent") };
}

// Every audited run lands in the event log; flagged ones as warnings so they stand out there.
function logRunAudit(request: Request, userId: string, audit: RunAuditResult, extra: Record<string, unknown> = {}): void {
  log(audit.verdict === "ok" ? "info" : "warn", audit.refused ? "run.refused" : audit.verdict === "ok" ? "run.audited" : "run.flagged", {
    ip: ip(request),
    userId,
    runId: audit.runId,
    verdict: audit.verdict,
    flags: audit.flags.map((item) => item.code),
    ...extra,
  });
}

// Admin requests authenticate like any other request, with the player's session cookie; the
// account must then be an admin (listed in ADMIN_EMAILS or granted from the console).
function isAuthorizedAdmin(user: AuthUser, admin: AdminRouteContext): boolean {
  return admin.service.isAdmin(user);
}

function intParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

const log = logEvent;

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
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

// Like readJsonBody, but refuses bodies over `maxBytes` (by Content-Length and by actual size,
// since the header can be absent or wrong) before parsing them.
async function readLimitedJsonBody(request: Request, maxBytes: number): Promise<Record<string, unknown> | null | "too-large"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return "too-large";
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > maxBytes) return "too-large";
    const body: unknown = JSON.parse(text);
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

function isDailyDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isTimestampMs(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 4_102_444_800_000;
}

function parseDailyMarks(v: unknown): DailyRoundMark[] | null {
  if (!Array.isArray(v) || v.length !== DAILY_COUNTRY_COUNT) return null;
  return v.every((mark) => mark === "correct" || mark === "hint" || mark === "miss") ? (v as DailyRoundMark[]) : null;
}

function formatDailyTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function createDailyShareText(date: string, score: number, timeMs: number, marks: readonly DailyRoundMark[]): string {
  const grid = marks.map((mark) => (mark === "correct" ? "🟩" : mark === "hint" ? "🟨" : "🟥")).join("");
  return `Locato Daily ${date}\nScore: ${score}/${DAILY_MAX_SCORE}\nTime: ${formatDailyTime(timeMs)}\n${grid}`;
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

function parseDailyResult(body: Record<string, unknown>): DailyChallengeResult | null {
  const { date, seed, score, timeMs, hintsUsed, marks, completedAt } = body;
  if (!isDailyDate(date) || seed !== `daily:${date}`) return null;
  if (!Number.isInteger(score) || typeof score !== "number" || score < 0 || score > DAILY_MAX_SCORE) return null;
  if (!isDurationMs(timeMs) || !isNonNegInt(hintsUsed)) return null;
  const parsedMarks = parseDailyMarks(marks);
  if (!parsedMarks) return null;
  const rounds = body.rounds === undefined ? undefined : parseDailyRoundResults(body.rounds);
  if (rounds === null || (body.challengeVersion !== undefined && body.challengeVersion !== 2)) return null;
  if (rounds && (rounds.length !== DAILY_COUNTRY_COUNT || rounds.reduce((sum, round) => sum + round.points, 0) !== score ||
    rounds.reduce((sum, round) => sum + round.hintsUsed, 0) !== hintsUsed ||
    rounds.some((round, i) => {
      const expectedMark = round.missed ? "miss" : round.categoryId === "map-tap" ? round.points === 10 ? "correct" : round.points > 0 ? "hint" : "miss" : round.hintsUsed > 0 || round.wrongGuesses > 0 ? "hint" : "correct";
      return parsedMarks[i] !== expectedMark || (round.categoryId !== "map-tap" && scoreDailyRound(round.hintsUsed, round.missed, round.wrongGuesses) !== round.points);
    }))) return null;
  if (body.challengeVersion === 2 && !rounds) return null;
  return {
    date,
    seed,
    score,
    timeMs,
    hintsUsed,
    marks: parsedMarks,
    shareText: createDailyShareText(date, score, timeMs, parsedMarks),
    completedAt: isTimestampMs(completedAt) ? completedAt : Date.now(),
    ...(body.challengeVersion === 2 ? { challengeVersion: 2 } : {}),
    ...(rounds ? { rounds } : {}),
  };
}

// Returns a Response for any /auth/* or /api/* route it owns, or null so the caller falls
// through to static file serving. Cookies are HttpOnly so the session token is never exposed to JS.
export async function handleAuthRequest(request: Request, url: URL, service: AuthService, cookieOptions: CookieOptions, baseUrl: string, social: SocialBridge = NOOP_SOCIAL, admin: AdminRouteContext | null = null): Promise<Response | null> {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && ![url.origin, new URL(baseUrl).origin].includes(origin))) return json({ error: "Forbidden origin." }, 403);
  }
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
    const requested = body?.emoji;
    if (requested !== null && !isAvatarEmoji(requested)) return json({ error: "Unknown avatar." }, 400);
    const emoji = requested;
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
    if (result.mode === "multiplayer") return json({ error: "Multiplayer results are recorded by the server." }, 400);
    log("info", "game.recorded", { ip: ip(request), userId: user.id, mode: result.mode, correct: result.correctAnswers });
    return json({ stats: service.recordGame(user.id, result) });
  }

  if (pathname === "/api/daily/summary" && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const date = url.searchParams.get("date");
    if (!isDailyDate(date)) return json({ error: "Invalid daily challenge date." }, 400);
    return json({ summary: service.getDailySummary(user.id, date) });
  }

  if (pathname === "/api/daily/leaderboard" && method === "GET") {
    const date = url.searchParams.get("date");
    if (!isDailyDate(date)) return json({ error: "Invalid daily challenge date." }, 400);
    return json({ entries: service.getDailyLeaderboard(date, intParam(url, "limit") ?? 100) });
  }

  const dailyMatch = pathname.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (dailyMatch && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const date = dailyMatch[1]!;
    return json({ result: service.getDailyResult(user.id, date) });
  }

  if (pathname === "/api/daily" && (method === "POST" || method === "PUT")) {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const saved = service.submitVerifiedDaily(user.id, body.runId);
    if ("error" in saved) return json({ error: saved.error }, 400);
    log("info", "daily.recorded", { ip: ip(request), userId: user.id, date: saved.date, score: saved.score });
    return json({ result: saved });
  }

  if (pathname === "/api/stats" && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    return json(service.getFullStats(user.id));
  }

  if (pathname === "/api/leaderboard" && method === "GET") {
    const gameMode = url.searchParams.get("mode") ?? "";
    const variant = url.searchParams.get("variant") ?? "";
    // An absent limit/offset means the default (Number(null) would be 0, i.e. a one-row page).
    const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : Number.NaN;
    const offset = url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : Number.NaN;
    const result = service.getLeaderboard({
      gameMode,
      variant,
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(Number.isFinite(offset) ? { offset } : {}),
    });
    if ("error" in result) return json({ error: result.error }, 400);

    const user = service.authenticate(readSessionToken(request));
    const currentUser = user === null ? null : service.getUserLeaderboardRank(user.id, gameMode, variant);
    return json({ metric: result.metric, entries: result.entries, currentUser });
  }

  if (pathname === "/api/runs/start" && method === "POST") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = service.startRun(user.id, body, runMeta(request));
    if ("error" in result) return json({ error: result.error }, 400);
    return json(result);
  }

  if ((pathname === "/api/ranked/start" || pathname === "/api/ranked/action") && method === "POST") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readLimitedJsonBody(request, 4096);
    if (body === "too-large") return json({ error: "Move is too large." }, 413);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = pathname.endsWith("/start") ? await service.startRankedGame(user.id, body) : await service.ranked.action(user.id, body);
    return json(result, "error" in result ? 400 : 200);
  }
  const rankedAsset = pathname.match(/^\/api\/ranked\/([a-f0-9]{48})\/asset\/([a-f0-9]{48})$/);
  if (rankedAsset && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    try { return await service.ranked.asset(user.id, rankedAsset[1]!, rankedAsset[2]!, url); }
    catch { return json({ error: "Game artwork unavailable." }, 503); }
  }

  if (pathname === "/api/runs/finish" && method === "POST") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readLimitedJsonBody(request, MAX_RUN_PAYLOAD_BYTES);
    if (body === "too-large") return json({ error: "Run is too large." }, 413);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = service.finishRun(user.id, body, runMeta(request));
    if ("error" in result) return json({ error: result.error }, 400);
    logRunAudit(request, user.id, result);
    // The player isn't told which checks a run raised: that would teach a script what to avoid.
    return json({ ok: true });
  }

  if (pathname === "/api/leaderboard" && method === "POST") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readLimitedJsonBody(request, MAX_RUN_PAYLOAD_BYTES);
    if (body === "too-large") return json({ error: "Run is too large." }, 413);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = service.submitLeaderboardAttempt(user.id, body, runMeta(request));
    if (result.audit) logRunAudit(request, user.id, result.audit, { mode: body.gameMode, timeMs: body.timeMs });
    if ("error" in result) return json({ error: result.error }, 400);
    const { audit: _audit, ...posted } = result;
    const gameMode = String(body.gameMode);
    const variant = typeof body.variant === "string" ? body.variant : "";
    log("info", "leaderboard.submitted", { ip: ip(request), userId: user.id, mode: body.gameMode, variant: body.variant, ...(body.score !== undefined ? { score: body.score } : { timeMs: body.timeMs }), accepted: result.accepted, ...(result.audit ? { runId: result.audit.runId, verdict: result.audit.verdict } : {}) });
    // `rank` / `bestTimeMs` (time boards) or `bestScore` (score boards) describe the player's
    // standing after this submission (their best, which may be an earlier attempt).
    const standing = service.getUserLeaderboardRank(user.id, gameMode, variant);
    if (leaderboardMetric(gameMode) === "score") {
      return json({ ...posted, rank: standing?.rank ?? null, bestScore: standing && "score" in standing ? standing.score : null });
    }
    return json({ ...posted, rank: standing?.rank ?? null, bestTimeMs: standing && "timeMs" in standing ? standing.timeMs : null });
  }

  if (pathname === "/api/leaderboard/rank" && method === "GET") {
    const numberParam = (name: string): number | null | undefined => {
      const raw = url.searchParams.get(name);
      if (raw === null) return undefined;
      return /^\d{1,10}$/.test(raw) ? Number(raw) : null;
    };
    const placement = service.getLeaderboardTimePlacement({
      gameMode: url.searchParams.get("mode") ?? "",
      variant: url.searchParams.get("variant") ?? "",
      timeMs: numberParam("timeMs"),
      score: numberParam("score"),
    });
    if ("error" in placement) return json({ error: placement.error }, 400);
    return json(placement);
  }

  if (pathname === "/api/academy" && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    return json({ progress: service.getAcademyProgress(user.id) });
  }

  if (pathname === "/api/academy" && method === "PUT") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const body = await readLimitedJsonBody(request, MAX_ACADEMY_PAYLOAD_BYTES);
    if (body === "too-large") {
      log("warn", "academy.sync.rejected", { ip: ip(request), userId: user.id, reason: "too-large" });
      return json({ error: "Progress payload is too large." }, 413);
    }
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = service.syncAcademyProgress(user.id, body.progress);
    if (!result.ok) {
      log("warn", "academy.sync.rejected", { ip: ip(request), userId: user.id, reason: result.error, status: result.status });
      return json({ error: result.error }, result.status);
    }
    log("info", "academy.sync", { ip: ip(request), userId: user.id, cards: result.cards });
    return json({ progress: result.progress });
  }

  // --- Admin console (signed-in accounts with admin access only) ---
  if (pathname.startsWith("/api/admin/")) {
    if (!admin) return json({ error: "Admin console is not configured." }, 503);
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Sign in to use the admin console." }, 401);
    if (!isAuthorizedAdmin(user, admin)) {
      log("warn", "admin.unauthorized", { ip: ip(request), userId: user.id, path: pathname });
      return json({ error: "This account doesn't have admin access." }, 403);
    }
    // Only an admin's request reaches the admin routes.
    return handleAdminRoutes(request, url, admin, user);
  }

  // --- Friends ---
  if (pathname === "/api/friends" && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const friends = service.listFriends(user.id).map((u) => ({ user: u, online: social.isOnline(u.id) }));
    const requests = service.listFriendRequests(user.id);
    return json({ friends, incoming: requests.incoming, outgoing: requests.outgoing });
  }


  const profileMatch = pathname.match(/^\/api\/users\/([^/]+)\/profile$/);
  if (profileMatch && method === "GET") {
    const user = service.authenticate(readSessionToken(request));
    if (!user) return json({ error: "Not authenticated." }, 401);
    const targetId = decodeURIComponent(profileMatch[1]!);
    const profile = service.getFriendProfile(user.id, targetId);
    if (profile === "forbidden") return json({ error: "You can only view stats for friends." }, 403);
    if (!profile) return json({ error: "User not found." }, 404);
    return json({ ...profile, online: social.isOnline(targetId) });
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
