import type { AdminBans, AdminDailyEntry, AdminLeaderboardEntry, AdminOverview, AdminRun, AdminUserDetail } from "../../server/admin/AdminService";
import type { AdminEvent, AdminUserList, AuthUser, LeaderboardEntry, PublicUser } from "../../server/auth/types";
import type { AdminRoomSummary } from "../../server/rooms/RoomManager";

export type { AdminBans, AdminDailyEntry, AdminLeaderboardEntry, AdminOverview, AdminRun, AdminUserDetail, AdminEvent, AdminUserList, AdminRoomSummary, LeaderboardEntry, PublicUser };

export class AdminApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface AdminClient {
  get<T>(path: string): Promise<T>;
  send<T>(method: "PATCH" | "DELETE" | "POST" | "PUT", path: string, body?: unknown): Promise<T>;
}

// The console rides on the player's own session cookie (HttpOnly, same origin): no token in JS.
export function createClient(onSignedOut: (status: 401 | 403) => void): AdminClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`/api/admin${path}`, { method, headers, credentials: "same-origin", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401 || response.status === 403) onSignedOut(response.status);
    if (!response.ok) throw new AdminApiError(response.status, data.error ?? `Request failed (${response.status}).`);
    return data as T;
  }
  return {
    get: (path) => request("GET", path),
    send: (method, path, body) => request(method, path, body),
  };
}

export interface AdminIdentity {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarEmoji: string | null;
}

export type AdminSessionState =
  | { readonly kind: "admin"; readonly user: AdminIdentity }
  | { readonly kind: "signed-out" }
  | { readonly kind: "not-admin" }
  | { readonly kind: "error"; readonly error: string };

/** Who the current session belongs to, and whether they may use the console. */
export async function checkSession(): Promise<AdminSessionState> {
  try {
    const response = await fetch("/api/admin/session", { credentials: "same-origin" });
    if (response.ok) return { kind: "admin", user: ((await response.json()) as { user: AdminIdentity }).user };
    if (response.status === 401) return { kind: "signed-out" };
    if (response.status === 403) return { kind: "not-admin" };
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { kind: "error", error: data.error ?? `The server answered ${response.status}.` };
  } catch {
    return { kind: "error", error: "Could not reach the server." };
  }
}

export async function signIn(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch("/auth/login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (response.ok) return { ok: true };
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error ?? "Sign-in failed." };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

export async function signOut(): Promise<void> {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
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
  readonly features: { readonly githubOAuth: boolean; readonly googleOAuth: boolean; readonly allowedOrigins: readonly string[] | null; readonly runAuditEnforced?: boolean };
  readonly streetview: Record<string, unknown>;
}

export type RemovedBoardEntry = { readonly ok: true; readonly removed: number; readonly revertedTo: { readonly value: number; readonly achievedAt: number } | null };
export type AdminUserUpdate = { displayName?: string; clearAvatar?: true };
export type { AdminAccess } from "../../server/auth/types";
export type { AuthUser };
