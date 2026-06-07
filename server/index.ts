import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { indexCountries, rawCountries, validateCountries } from "../src/core/countries";
import { RoomManager } from "./rooms/RoomManager";

interface WebSocketData {}

const DEFAULT_PORT = 3000;
// Drives round timeouts and result→next-round transitions, so it must tick well under one
// second to keep pacing tight; it also doubles as the room TTL/cleanup pass.
const TICK_INTERVAL_MS = 250;
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SERVER_DIR, "..");
const DIST_DIR = resolve(PROJECT_ROOT, "dist");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function readIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function allowedOrigins(): ReadonlySet<string> | null {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) return null;
  const origins = raw.split(",").map((origin) => origin.trim()).filter(Boolean);
  return origins.length === 0 ? null : new Set(origins);
}

function isAllowedOrigin(request: Request, origins: ReadonlySet<string> | null): boolean {
  if (!origins) return true;
  const origin = request.headers.get("origin");
  return origin !== null && origins.has(origin);
}

function safeStaticPath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const candidate = decoded === "/" ? join(DIST_DIR, "index.html") : resolve(DIST_DIR, `.${decoded}`);
  if (!candidate.startsWith(`${DIST_DIR}/`) && candidate !== join(DIST_DIR, "index.html")) return null;
  return candidate;
}

function serveStatic(pathname: string): Response {
  const requestedPath = safeStaticPath(pathname);
  if (!requestedPath) return new Response("Forbidden", { status: 403 });

  const path = existsSync(requestedPath) && statSync(requestedPath).isFile() ? requestedPath : join(DIST_DIR, "index.html");
  if (!existsSync(path) || !statSync(path).isFile()) return new Response("Not found", { status: 404 });

  const contentType = CONTENT_TYPES[extname(path)] ?? "application/octet-stream";
  return new Response(Bun.file(path), { headers: { "content-type": contentType } });
}

const countryIndex = indexCountries(rawCountries);
const validation = validateCountries(countryIndex);

if (!validation.valid) {
  throw new Error(validation.issues.map((issue) => issue.message).join("\n"));
}

const roomManager = new RoomManager({
  countryIndex,
  maxPlayersPerRoom: readIntegerEnv("MAX_PLAYERS_PER_ROOM", 8),
  maxRooms: readIntegerEnv("MAX_ROOMS", 500),
  roomTtlMs: readIntegerEnv("ROOM_TTL_SECONDS", 7200) * 1000,
  answerRateLimitPerSecond: readIntegerEnv("ANSWER_RATE_LIMIT_PER_SECOND", 5),
});
const origins = allowedOrigins();

setInterval(() => roomManager.sweep(Date.now()), TICK_INTERVAL_MS).unref?.();

const server = Bun.serve<WebSocketData>({
  port: readIntegerEnv("PORT", DEFAULT_PORT),
  fetch(request, serverInstance) {
    const url = new URL(request.url);

    if (url.pathname === "/health") return new Response("ok", { headers: { "content-type": "text/plain; charset=utf-8" } });

    if (url.pathname === "/ws") {
      if (!isAllowedOrigin(request, origins)) return new Response("Forbidden", { status: 403 });
      const upgraded = serverInstance.upgrade(request, { data: {} });
      return upgraded ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    return serveStatic(url.pathname);
  },
  websocket: {
    open(socket) {
      roomManager.attach(socket);
    },
    message(socket, message) {
      roomManager.handleRawMessage(socket, message);
    },
    close(socket) {
      roomManager.detach(socket);
    },
  },
});

console.info(`locato server listening on ${server.hostname}:${server.port}`);
