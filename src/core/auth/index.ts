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

export type DailyRoundMark = "correct" | "hint" | "miss";

export interface DailyChallengeResult {
  readonly date: string;
  readonly seed: string;
  readonly score: number;
  readonly timeMs: number;
  readonly hintsUsed: number;
  readonly marks: readonly DailyRoundMark[];
  readonly shareText: string;
  readonly completedAt: number;
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarEmoji: string | null;
  readonly timeMs: number;
  readonly achievedAt: number;
}

export interface LeaderboardResponse {
  readonly entries: readonly LeaderboardEntry[];
  readonly currentUser: { readonly rank: number; readonly timeMs: number } | null;
}

export interface SubmitBestTimeInput {
  readonly gameMode: string;
  readonly variant?: string;
  readonly timeMs: number;
}

export interface SubmitBestTimeResponse {
  readonly accepted: boolean;
  readonly isPersonalBest: boolean;
}

export interface PublicUser {
  readonly id: string;
  readonly username: string;
  readonly avatarEmoji: string | null;
}

export interface FriendInfo {
  readonly user: PublicUser;
  readonly online: boolean;
}

export interface FriendRequestInfo {
  readonly user: PublicUser;
  readonly createdAt: number;
}

export interface FriendsData {
  readonly friends: readonly FriendInfo[];
  readonly incoming: readonly FriendRequestInfo[];
  readonly outgoing: readonly FriendRequestInfo[];
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

export async function fetchLeaderboard(mode: string, variant = "", limit = 50): Promise<LeaderboardResponse | null> {
  try {
    const params = new URLSearchParams({ mode, variant, limit: String(limit) });
    const response = await fetch(`/api/leaderboard?${params.toString()}`);
    if (!response.ok) return null;
    return (await response.json()) as LeaderboardResponse;
  } catch {
    return null;
  }
}

export async function submitBestTime(input: SubmitBestTimeInput): Promise<SubmitBestTimeResponse | null> {
  try {
    const response = await postJson("/api/leaderboard", input);
    if (!response.ok) return null;
    return (await response.json()) as SubmitBestTimeResponse;
  } catch {
    return null;
  }
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

export async function fetchDailyChallengeResult(date: string): Promise<DailyChallengeResult | null> {
  try {
    const response = await fetch(`/api/daily/${encodeURIComponent(date)}`);
    if (!response.ok) return null;
    const data = (await response.json()) as { result?: DailyChallengeResult | null };
    return data.result ?? null;
  } catch {
    return null;
  }
}

export async function saveDailyChallengeResult(result: DailyChallengeResult): Promise<DailyChallengeResult | null> {
  try {
    const response = await postJson("/api/daily", result);
    if (!response.ok) return null;
    const data = (await response.json()) as { result?: DailyChallengeResult | null };
    return data.result ?? null;
  } catch {
    return null;
  }
}

export async function fetchFriends(): Promise<FriendsData | null> {
  try {
    const response = await fetch("/api/friends");
    if (!response.ok) return null;
    return (await response.json()) as FriendsData;
  } catch {
    return null;
  }
}

export async function searchUsers(query: string): Promise<readonly PublicUser[]> {
  try {
    const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) return [];
    return ((await response.json()) as { users: readonly PublicUser[] }).users;
  } catch {
    return [];
  }
}

export async function sendFriendRequest(username: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  try {
    const response = await postJson("/api/friends/requests", { username });
    const data = (await response.json()) as { status?: string; error?: string };
    return response.ok && data.status ? { ok: true, status: data.status } : { ok: false, error: data.error ?? "Request failed." };
  } catch {
    return { ok: false, error: "Network error." };
  }
}

export async function acceptFriendRequest(userId: string): Promise<boolean> {
  try {
    return (await postJson(`/api/friends/requests/${encodeURIComponent(userId)}/accept`, {})).ok;
  } catch {
    return false;
  }
}

export async function declineFriendRequest(userId: string): Promise<boolean> {
  try {
    return (await fetch(`/api/friends/requests/${encodeURIComponent(userId)}`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

export async function removeFriend(userId: string): Promise<boolean> {
  try {
    return (await fetch(`/api/friends/${encodeURIComponent(userId)}`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

export async function inviteFriendToGame(userId: string, roomCode: string): Promise<boolean> {
  try {
    return (await postJson("/api/friends/invite", { userId, roomCode })).ok;
  } catch {
    return false;
  }
}

// Fire-and-forget: saves the emoji to the user's account so it persists across devices.
// Silently ignored when not authenticated or offline.
export function saveAvatarToServer(emoji: string): void {
  void fetch("/auth/avatar", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ emoji }) }).catch(() => undefined);
}

export { AVATAR_OPTIONS, getPlayerEmoji, getStoredAvatar, storeAvatar } from "./avatars";
