import { logEvent } from "./events";
import type { AdminService } from "./AdminService";

export interface AdminRouteContext {
  readonly service: AdminService;
  // Host/process snapshot (uptime, memory, database, pools). Supplied by the Bun entrypoint.
  readonly system?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

function json(data: unknown, status = 200): Response {
  // Admin payloads carry emails and moderation state, so keep them out of every cache.
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function ip(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function intParam(url: URL, name: string): number | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Routes for an already-authorized admin request. The ADMIN_TOKEN check lives in
// handleAuthRequest, which only delegates here once the caller has proven the token.
export async function handleAdminRoutes(request: Request, url: URL, context: AdminRouteContext): Promise<Response> {
  const { pathname } = url;
  const { method } = request;
  const { service } = context;
  const audit = (action: string, details: Record<string, unknown>) => logEvent("info", action, { ip: ip(request), ...details });

  if (pathname === "/api/admin/session" && method === "GET") return json({ ok: true });

  if (pathname === "/api/admin/overview" && method === "GET") return json(service.overview());

  if (pathname === "/api/admin/system" && method === "GET") return json(context.system ? await context.system() : {});

  if (pathname === "/api/admin/events" && method === "GET") {
    return json({
      events: service.events({
        level: url.searchParams.get("level"),
        action: url.searchParams.get("action"),
        ip: url.searchParams.get("ip"),
        userId: url.searchParams.get("userId"),
        before: intParam(url, "before"),
        limit: intParam(url, "limit"),
      }),
    });
  }

  // --- Users ---
  if (pathname === "/api/admin/users" && method === "GET") {
    return json(service.listUsers({ q: url.searchParams.get("q") ?? undefined, limit: intParam(url, "limit"), offset: intParam(url, "offset") }));
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch) {
    const id = decodeURIComponent(userMatch[1]!);
    if (method === "GET") {
      const detail = service.getUserDetail(id);
      return detail ? json(detail) : json({ error: "User not found." }, 404);
    }
    if (method === "PATCH") {
      const body = await readJsonBody(request);
      if (!body) return json({ error: "Invalid request body." }, 400);
      const result = service.updateUser(id, body);
      if (!result.ok) return json({ error: result.error }, result.status);
      audit("admin.user.update", { targetUserId: id, displayName: body.displayName ?? null, clearAvatar: body.clearAvatar === true });
      return json({ user: result.value });
    }
    if (method === "DELETE") {
      const deleted = service.deleteUser(id);
      audit("admin.user.delete", { targetUserId: id, deleted });
      return deleted ? json({ ok: true, deleted: id }) : json({ error: "User not found." }, 404);
    }
  }

  const sessionsMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/sessions$/);
  if (sessionsMatch && method === "DELETE") {
    const id = decodeURIComponent(sessionsMatch[1]!);
    const revoked = service.revokeUserSessions(id);
    audit("admin.user.logout", { targetUserId: id, revoked });
    return json({ ok: true, revoked });
  }

  const statsMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/stats$/);
  if (statsMatch && method === "DELETE") {
    const id = decodeURIComponent(statsMatch[1]!);
    const reset = service.resetUserStats(id);
    audit("admin.user.reset_stats", { targetUserId: id, reset });
    return reset ? json({ ok: true }) : json({ error: "User not found." }, 404);
  }

  // --- Leaderboards ---
  if (pathname === "/api/admin/leaderboards/meta" && method === "GET") return json(service.leaderboardMeta());

  if (pathname === "/api/admin/leaderboards" && method === "GET") {
    const result = service.leaderboard({ mode: url.searchParams.get("mode"), variant: url.searchParams.get("variant") ?? "", limit: intParam(url, "limit") });
    return result.ok ? json({ entries: result.value }) : json({ error: result.error }, result.status);
  }

  const bestTimeMatch = pathname.match(/^\/api\/admin\/leaderboards\/([^/]+)$/);
  if (bestTimeMatch && method === "DELETE") {
    const userId = decodeURIComponent(bestTimeMatch[1]!);
    const mode = url.searchParams.get("mode") ?? "";
    const variant = url.searchParams.get("variant") ?? "";
    const deleted = service.deleteBestTime(userId, mode, variant);
    audit("admin.leaderboard.delete", { targetUserId: userId, mode, variant, deleted });
    return deleted ? json({ ok: true }) : json({ error: "Leaderboard entry not found." }, 404);
  }

  if (pathname === "/api/admin/daily" && method === "GET") {
    const date = url.searchParams.get("date") ?? "";
    if (!DATE_PATTERN.test(date)) return json({ error: "Invalid daily challenge date." }, 400);
    return json({ entries: service.daily(date) });
  }

  const dailyMatch = pathname.match(/^\/api\/admin\/daily\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/);
  if (dailyMatch && method === "DELETE") {
    const userId = decodeURIComponent(dailyMatch[1]!);
    const date = dailyMatch[2]!;
    const deleted = service.deleteDailyResult(userId, date);
    audit("admin.daily.delete", { targetUserId: userId, date, deleted });
    return deleted ? json({ ok: true }) : json({ error: "Daily result not found." }, 404);
  }

  // --- Live state ---
  if (pathname === "/api/admin/rooms" && method === "GET") return json({ rooms: service.rooms(), online: service.onlineUsers() });

  const roomMatch = pathname.match(/^\/api\/admin\/rooms\/([^/]+)$/);
  if (roomMatch && method === "DELETE") {
    const code = decodeURIComponent(roomMatch[1]!);
    const closed = service.closeRoom(code);
    audit("admin.room.close", { roomCode: code, closed });
    return closed ? json({ ok: true }) : json({ error: "Room not found." }, 404);
  }

  return json({ error: "Unknown admin route." }, 404);
}
