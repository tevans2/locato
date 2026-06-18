import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { indexCountries, rawCountries, validateCountries } from "../src/core/countries";
import { RoomManager, type MultiplayerConnection } from "./rooms/RoomManager";
import { AuthService, bunPasswordHasher, handleAuthRequest, readSessionToken, type AuthUser } from "./auth";
import { openDatabase, SqliteUserStore } from "./db/database";
import { SocialHub, type SocialConnection } from "./social/SocialHub";
import { StreetViewLocationPool } from "./streetview";
import { createMapTapRoundResponse, validateMapTapGuessResponse } from "./maptap";

interface WebSocketData {
  // Resolved once at upgrade time from the session cookie; immutable for the socket's lifetime.
  readonly user: AuthUser | null;
  readonly kind: "room" | "social";
}

const DEFAULT_PORT = 3000;
const TICK_INTERVAL_MS = 250;
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SERVER_DIR, "..");
const DIST_DIR = resolve(PROJECT_ROOT, "dist");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function readIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function allowedOrigins(): ReadonlySet<string> | null {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) return null;
  return new Set(raw.split(",").map((origin) => origin.trim()).filter(Boolean));
}

function isAllowedOrigin(request: Request, origins: ReadonlySet<string> | null): boolean {
  if (!origins) return true;
  const origin = request.headers.get("origin");
  return origin !== null && origins.has(origin);
}

function safeStaticPath(pathname: string): string | null {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const full = join(DIST_DIR, normalized);
  if (!full.startsWith(DIST_DIR)) return null;
  try {
    const stat = existsSync(full) ? statSync(full) : null;
    return stat?.isFile() ? full : null;
  } catch {
    return null;
  }
}

function serveStatic(pathname: string): Response {
  const filePath = safeStaticPath(pathname);
  if (!filePath) {
    const indexPath = safeStaticPath("/index.html");
    if (!indexPath) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(indexPath), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  const ext = extname(filePath);
  return new Response(Bun.file(filePath), { headers: { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" } });
}

const countryIndex = indexCountries(rawCountries);
const validation = validateCountries(countryIndex);
if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join("\n"));

const roomManager = new RoomManager({
  countryIndex,
  maxPlayersPerRoom: readIntegerEnv("MAX_PLAYERS_PER_ROOM", 8),
  maxRooms: readIntegerEnv("MAX_ROOMS", 500),
  roomTtlMs: readIntegerEnv("ROOM_TTL_SECONDS", 7200) * 1000,
  answerRateLimitPerSecond: readIntegerEnv("ANSWER_RATE_LIMIT_PER_SECOND", 5),
});

const origins = allowedOrigins();
setInterval(() => roomManager.sweep(Date.now()), TICK_INTERVAL_MS).unref?.();

const SESSION_TTL_MS = readIntegerEnv("SESSION_TTL_DAYS", 30) * 24 * 60 * 60 * 1000;
const databasePath = process.env.DATABASE_PATH ?? resolve(PROJECT_ROOT, ".data/locato.db");
const userStore = new SqliteUserStore(openDatabase(databasePath));
const authService = new AuthService(userStore, bunPasswordHasher, { sessionTtlMs: SESSION_TTL_MS });
const cookieOptions = { secure: process.env.NODE_ENV === "production" };
const baseUrl = process.env.BASE_URL ?? `http://localhost:${readIntegerEnv("PORT", DEFAULT_PORT)}`;
// Out-of-band admin credential. When unset, the /api/admin surface is disabled entirely.
const adminToken = process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN.length > 0 ? process.env.ADMIN_TOKEN : null;
// Presence + friend/invite push hub, backed by the persistent /social socket.
const socialHub = new SocialHub((userId) => authService.friendIds(userId));
const streetViewPool = new StreetViewLocationPool({
  storagePath: process.env.STREETVIEW_POOL_PATH ?? resolve(PROJECT_ROOT, ".data/streetview-country-pool.json"),
  metadataApiKey: process.env.GOOGLE_MAPS_STREETVIEW_METADATA_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "",
  maxEntries: readIntegerEnv("STREETVIEW_POOL_MAX_ENTRIES", 500),
  dailyGenerateCount: readIntegerEnv("STREETVIEW_DAILY_GENERATE_COUNT", 50),
  refreshHours: readIntegerEnv("STREETVIEW_REFRESH_HOURS", 24),
  metadataRadiusMeters: readIntegerEnv("STREETVIEW_METADATA_RADIUS_METERS", 1000),
});
streetViewPool.warm();

// Hourly cleanup of expired session rows; cheap and keeps the table from growing unbounded.
setInterval(() => authService.pruneExpiredSessions(), 60 * 60 * 1000).unref?.();

// Map each Bun socket to a stable connection object so RoomManager can use it as a Map key
// across open/message/close callbacks. The socket itself changes identity on each callback
// reference, so we need one wrapper that lives for the socket's full lifetime.
const connectionMap = new WeakMap<Bun.ServerWebSocket<WebSocketData>, MultiplayerConnection>();
const socialConnectionMap = new WeakMap<Bun.ServerWebSocket<WebSocketData>, SocialConnection>();

const server = Bun.serve<WebSocketData>({
  hostname: "0.0.0.0",
  port: readIntegerEnv("PORT", DEFAULT_PORT),
  async fetch(request, serverInstance) {
    const url = new URL(request.url);
    const { method } = request;

    if (url.pathname === "/health") return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } });

    if (url.pathname === "/ws") {
      if (!isAllowedOrigin(request, origins)) return new Response("Forbidden", { status: 403 });
      // Authenticate the upgrade from the session cookie so the socket carries the real identity.
      const user = authService.authenticate(readSessionToken(request));
      const upgraded = serverInstance.upgrade(request, { data: { user, kind: "room" } });
      return upgraded ? undefined : new Response("Upgrade failed", { status: 400 });
    }
    if (url.pathname === "/social") {
      if (!isAllowedOrigin(request, origins)) return new Response("Forbidden", { status: 403 });
      // The social channel is for signed-in users only — presence makes no sense for guests.
      const user = authService.authenticate(readSessionToken(request));
      if (!user) return new Response("Unauthorized", { status: 401 });
      const upgraded = serverInstance.upgrade(request, { data: { user, kind: "social" } });
      return upgraded ? undefined : new Response("Upgrade failed", { status: 400 });
    }


    if (url.pathname === "/api/maptap/round" && method === "GET") {
      return createMapTapRoundResponse(url);
    }

    if (url.pathname === "/api/maptap/guess" && method === "POST") {
      return validateMapTapGuessResponse(request);
    }

    if (url.pathname === "/api/streetview-country/round" && method === "GET") {
      try {
        return json(await streetViewPool.createRound());
      } catch (error) {
        console.warn(JSON.stringify({ time: new Date().toISOString(), level: "warn", action: "streetview.round.failed", error: error instanceof Error ? error.message : String(error) }));
        return json({ error: "Street View round unavailable." }, 503);
      }
    }

    if (url.pathname === "/api/streetview-country/rounds" && method === "GET") {
      try {
        const fallbackCount = readIntegerEnv("STREETVIEW_CLIENT_CACHE_SIZE", 5);
        const parsedCount = Number.parseInt(url.searchParams.get("count") ?? String(fallbackCount), 10);
        const count = Number.isFinite(parsedCount) ? parsedCount : fallbackCount;
        return json(await streetViewPool.createRounds(count));
      } catch (error) {
        console.warn(JSON.stringify({ time: new Date().toISOString(), level: "warn", action: "streetview.rounds.failed", error: error instanceof Error ? error.message : String(error) }));
        return json({ error: "Street View rounds unavailable." }, 503);
      }
    }

    if (url.pathname === "/api/streetview-country/stats" && method === "GET") {
      return json(await streetViewPool.stats());
    }

    const authResponse = await handleAuthRequest(request, url, authService, cookieOptions, baseUrl, adminToken, socialHub);
    if (authResponse) return authResponse;

    return serveStatic(url.pathname);
  },
  websocket: {
    open(socket) {
      if (socket.data.kind === "social") {
        const user = socket.data.user;
        if (!user) { socket.close(1008, "unauthorized"); return; }
        const connection: SocialConnection = { userId: user.id, send: (data) => socket.send(data) };
        socialConnectionMap.set(socket, connection);
        socialHub.attach(connection);
        return;
      }
      const connection: MultiplayerConnection = {
        send: (msg) => socket.send(msg),
        close: (code, reason) => socket.close(code, reason),
        authenticatedName: socket.data.user?.displayName ?? null,
      };
      connectionMap.set(socket, connection);
      roomManager.attach(connection);
    },
    message(socket, message) {
      // The social channel is server-push only; clients only send heartbeats, which we ignore.
      if (socket.data.kind === "social") return;
      const connection = connectionMap.get(socket);
      if (connection) roomManager.handleRawMessage(connection, message);
    },
    close(socket) {
      if (socket.data.kind === "social") {
        const connection = socialConnectionMap.get(socket);
        if (connection) socialHub.detach(connection);
        socialConnectionMap.delete(socket);
        return;
      }
      const connection = connectionMap.get(socket);
      if (connection) roomManager.detach(connection);
      connectionMap.delete(socket);
    },
  },
});

console.info(`locato server listening on ${server.hostname}:${server.port}`);
