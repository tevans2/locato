// Client-side auth module. Talks to the server's /auth/* and /api/* endpoints via fetch.
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
  readonly totalGames: number;
  readonly totalCorrect: number;
  readonly totalWrong: number;
  readonly bestStreak: number;
  readonly soloGames: number;
  readonly soloCorrect: number;
  readonly soloWrong: number;
  readonly soloBestStreak: number;
  readonly multiplayerGames: number;
  readonly multiplayerWins: number;
  readonly multiplayerCorrect: number;
  readonly multiplayerWrong: number;
  readonly multiplayerBestStreak: number;
  readonly worldMapGames: number;
  readonly worldMapCompletions: number;
  readonly worldBestTimeMs: number;
  readonly worldBestCountries: number;
}

export interface CategoryStats {
  readonly categoryId: string;
  readonly correct: number;
  readonly wrong: number;
}

export interface GameRecord {
  readonly id: string;
  readonly mode: "solo" | "multiplayer" | "world-map";
  readonly categoryIds: readonly string[];
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly score: number;
  readonly bestStreak: number;
  readonly rank: number | null;
  readonly totalPlayers: number | null;
  readonly playedAt: number;
  readonly durationMs: number | null;
  readonly completed: boolean | null;
  readonly countriesFound: number | null;
  readonly countriesTotal: number | null;
  readonly playMode: string | null;
}

export interface FullStats extends UserStats {
  readonly categories: readonly CategoryStats[];
  readonly recentGames: readonly GameRecord[];
}

export interface AuthState {
  readonly user: AuthUser | null;
  readonly stats: UserStats | null;
}

export interface GameResult {
  readonly mode: "solo" | "multiplayer" | "world-map";
  readonly categoryIds: readonly string[];
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly score: number;
  readonly bestStreak: number;
  readonly rank?: number;
  readonly totalPlayers?: number;
  readonly durationMs?: number;
  readonly completed?: boolean;
  readonly countriesFound?: number;
  readonly countriesTotal?: number;
  readonly playMode?: string;
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

export async function fetchFullStats(): Promise<FullStats | null> {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) return null;
    return (await response.json()) as FullStats;
  } catch {
    return null;
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
