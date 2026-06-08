// Client-side auth module. Talks to the server's /auth/* and /api/games endpoints via fetch.
// No cookies are accessed from JS — they are HttpOnly and sent automatically by the browser.

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly avatarEmoji: string | null;
  readonly createdAt: number;
}

export interface UserStats {
  readonly games: number;
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly bestStreak: number;
}

export interface AuthState {
  readonly user: AuthUser | null;
  readonly stats: UserStats | null;
}

export interface GameResult {
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly bestStreak: number;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function fetchAuthState(): Promise<AuthState> {
  try {
    const response = await fetch("/auth/me");
    if (!response.ok) return { user: null, stats: null };
    const data = (await response.json()) as { user: AuthUser; stats: UserStats };
    return { user: data.user, stats: data.stats };
  } catch {
    return { user: null, stats: null };
  }
}

export async function registerWithPassword(email: string, password: string, displayName?: string): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  const response = await postJson("/auth/register", { email, password, displayName });
  const data = (await response.json()) as { user?: AuthUser; error?: string };
  return response.ok && data.user ? { ok: true, user: data.user } : { ok: false, error: data.error ?? "Registration failed." };
}

export async function loginWithPassword(email: string, password: string): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  const response = await postJson("/auth/login", { email, password });
  const data = (await response.json()) as { user?: AuthUser; error?: string };
  return response.ok && data.user ? { ok: true, user: data.user } : { ok: false, error: data.error ?? "Login failed." };
}

export function signInWithGitHub(): void {
  window.location.href = "/auth/github";
}

export function signInWithGoogle(): void {
  window.location.href = "/auth/google";
}

export async function signOut(): Promise<void> {
  await postJson("/auth/logout", {});
}

export async function recordGame(result: GameResult): Promise<UserStats | null> {
  try {
    const response = await postJson("/api/games", result);
    if (!response.ok) return null;
    const data = (await response.json()) as { stats?: UserStats };
    return data.stats ?? null;
  } catch {
    return null;
  }
}

// Fire-and-forget: saves the emoji to the user's account so it persists across devices.
// Silently ignored when not authenticated or offline.
export function saveAvatarToServer(emoji: string): void {
  void fetch("/auth/avatar", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ emoji }) }).catch(() => undefined);
}

export { AVATAR_OPTIONS, getPlayerEmoji, getStoredAvatar, storeAvatar } from "./avatars";
