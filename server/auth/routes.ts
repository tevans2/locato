import type { AuthService } from "./AuthService";
import { readSessionToken, serializeClearCookie, serializeSessionCookie, type CookieOptions } from "./cookies";
import type { GameResult } from "./types";

const MAX_STAT_VALUE = 1_000_000;

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function parseGameResult(body: Record<string, unknown>): GameResult | null {
  const correctAnswers = body.correctAnswers;
  const wrongAnswers = body.wrongAnswers;
  const bestStreak = body.bestStreak;
  const valid = [correctAnswers, wrongAnswers, bestStreak].every(
    (value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_STAT_VALUE,
  );
  if (!valid) return null;
  return { correctAnswers: correctAnswers as number, wrongAnswers: wrongAnswers as number, bestStreak: bestStreak as number };
}

// Returns a Response for any /auth/* or /api/* route it owns, or null so the caller can fall
// through to static file serving. Cookies are HttpOnly so the session token is never exposed to JS.
export async function handleAuthRequest(request: Request, url: URL, service: AuthService, cookieOptions: CookieOptions): Promise<Response | null> {
  const { pathname } = url;
  const { method } = request;

  if (pathname === "/auth/register" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = await service.register(body);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ user: result.user }, 201, { "set-cookie": serializeSessionCookie(result.session.id, service.sessionMaxAgeSeconds, cookieOptions) });
  }

  if (pathname === "/auth/login" && method === "POST") {
    const body = await readJsonBody(request);
    if (!body) return json({ error: "Invalid request body." }, 400);
    const result = await service.login(body);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ user: result.user }, 200, { "set-cookie": serializeSessionCookie(result.session.id, service.sessionMaxAgeSeconds, cookieOptions) });
  }

  if (pathname === "/auth/logout" && method === "POST") {
    service.logout(readSessionToken(request));
    return json({ ok: true }, 200, { "set-cookie": serializeClearCookie(cookieOptions) });
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
    return json({ stats: service.recordGame(user.id, result) });
  }

  return null;
}
