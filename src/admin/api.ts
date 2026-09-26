import type { AdminDailyEntry, AdminOverview, AdminUserDetail } from "../../server/admin/AdminService";
import type { AdminEvent, AdminUserList, AuthUser, LeaderboardEntry, PublicUser } from "../../server/auth/types";
import type { AdminRoomSummary } from "../../server/rooms/RoomManager";

export type { AdminDailyEntry, AdminOverview, AdminUserDetail, AdminEvent, AdminUserList, AdminRoomSummary, LeaderboardEntry, PublicUser };

const TOKEN_KEY = "locato.admin.token";

export class AdminApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// The token lives in sessionStorage so it's gone when the tab closes; never localStorage.
export function loadToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked: the session just won't survive a reload.
  }
}

export interface AdminClient {
  get<T>(path: string): Promise<T>;
  send<T>(method: "PATCH" | "DELETE" | "POST", path: string, body?: unknown): Promise<T>;
}

export function createClient(token: string, onUnauthorized: () => void): AdminClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`/api/admin${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 403) onUnauthorized();
    if (!response.ok) throw new AdminApiError(response.status, data.error ?? `Request failed (${response.status}).`);
    return data as T;
  }
  return {
    get: (path) => request("GET", path),
    send: (method, path, body) => request(method, path, body),
  };
}

// Verifies a token before the console opens, without keeping a client around.
export async function checkToken(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/admin/session", { headers: { authorization: `Bearer ${token}` } });
    if (response.ok) return { ok: true };
    if (response.status === 404) return { ok: false, error: "The admin console is disabled on this server (ADMIN_TOKEN is not set)." };
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: response.status === 403 ? "That token was not accepted." : data.error ?? "Sign-in failed." };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

export interface AdminSystem {
  readonly startedAt: number;
  readonly uptimeSeconds: number;
  readonly runtime: { readonly bun: string | null; readonly nodeEnv: string; readonly platform: string };
  readonly host: { readonly app: string | null; readonly region: string | null; readonly machineId: string | null; readonly image: string | null };
  readonly memory: { readonly rssBytes: number; readonly heapUsedBytes: number; readonly heapTotalBytes: number };
  readonly database: { readonly path: string; readonly sizeBytes: number; readonly walBytes: number };
  readonly rooms: { readonly rooms: number; readonly connections: number };
  readonly limits: Record<string, number>;
  readonly features: { readonly githubOAuth: boolean; readonly googleOAuth: boolean; readonly allowedOrigins: readonly string[] | null };
  readonly streetview: Record<string, unknown>;
}

export type AdminUserUpdate = { displayName?: string; clearAvatar?: true };
export type { AuthUser };
