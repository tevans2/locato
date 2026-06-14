import { createSessionToken, createUserId } from "./tokens";
import {
  DEFAULT_LEADERBOARD_LIMIT,
  MAX_LEADERBOARD_LIMIT,
  MAX_TIME_MS,
  MIN_TIME_MS,
  isLeaderboardGameMode,
  normalizeLeaderboardVariant,
} from "../leaderboard/validation";
import type {
  AdminUserList,
  AuthUser,
  DailyChallengeResult,
  DailySummary,
  FriendRequestLists,
  FullStats,
  GameResult,
  PublicUser,
  SendFriendRequestResult,
  LeaderboardEntry,
  LeaderboardQuery,
  PasswordHasher,
  Session,
  StoredUser,
  SubmitBestTimeResult,
  UserLeaderboardRank,
  UserStats,
  UserStore,
} from "./types";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 20;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_ADMIN_PAGE = 50;
const MAX_ADMIN_PAGE = 200;
const DEFAULT_DAILY_HISTORY_LIMIT = 14;

export interface AuthServiceOptions {
  readonly sessionTtlMs: number;
  readonly clock?: () => number;
}

export type AuthOutcome =
  | { readonly ok: true; readonly user: AuthUser; readonly session: Session }
  | { readonly ok: false; readonly status: number; readonly error: string };

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email) ? email : null;
}

// The display name doubles as a unique handle (used to add friends), so it must match the
// username charset and length. Returns the trimmed name (case preserved) or null if invalid.
function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= USERNAME_MIN_LENGTH && name.length <= USERNAME_MAX_LENGTH && USERNAME_PATTERN.test(name) ? name : null;
}

function previousDailyDate(date: string, daysBack: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const utc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const previous = new Date(utc - daysBack * 86_400_000);
  return previous.toISOString().slice(0, 10);
}

const SUBMIT_RATE_LIMIT = 10;
const SUBMIT_RATE_WINDOW_MS = 60_000;

export class AuthService {
  private readonly clock: () => number;
  private readonly ttlMs: number;
  private readonly submitTimestamps = new Map<string, number[]>();

  constructor(
    private readonly store: UserStore,
    private readonly hasher: PasswordHasher,
    private readonly options: AuthServiceOptions,
  ) {
    this.clock = options.clock ?? (() => Date.now());
    this.ttlMs = options.sessionTtlMs;
  }

  get sessionMaxAgeSeconds(): number {
    return Math.floor(this.ttlMs / 1000);
  }

  async register(input: { email?: unknown; password?: unknown; displayName?: unknown }): Promise<AuthOutcome> {
    const email = normalizeEmail(input.email);
    if (!email) return { ok: false, status: 400, error: "A valid email address is required." };

    const password = typeof input.password === "string" ? input.password : "";
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return { ok: false, status: 400, error: `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.` };
    }

    const username = normalizeUsername(input.displayName);
    if (!username) {
      return { ok: false, status: 400, error: `Username must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters using letters, numbers, _ or -.` };
    }
    if (this.store.findUserByEmail(email)) return { ok: false, status: 409, error: "An account with that email already exists." };
    if (this.store.findUserByUsername(username)) return { ok: false, status: 409, error: "That username is taken." };
    const now = this.clock();
    const passwordHash = await this.hasher.hash(password);
    const user = this.store.createUser({ id: createUserId(), email, displayName: username, passwordHash, avatarUrl: null, createdAt: now });
    return { ok: true, user: this.toAuthUser(user), session: this.openSession(user.id, now) };
  }

  async login(input: { email?: unknown; password?: unknown }): Promise<AuthOutcome> {
    const invalid = { ok: false, status: 401, error: "Invalid email or password." } as const;
    const email = normalizeEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    if (!email || password.length === 0) return invalid;

    const user = this.store.findUserByEmail(email);
    if (!user) return invalid;
    if (user.passwordHash === null) return { ok: false, status: 401, error: "Sign in with your OAuth provider." };
    if (!(await this.hasher.verify(password, user.passwordHash))) return invalid;

    return { ok: true, user: this.toAuthUser(user), session: this.openSession(user.id, this.clock()) };
  }

  logout(token: string | null): void {
    if (token) this.store.deleteSession(token);
  }

  authenticate(token: string | null): AuthUser | null {
    if (!token) return null;
    const session = this.store.findSession(token);
    if (!session) return null;
    if (session.expiresAt <= this.clock()) {
      this.store.deleteSession(token);
      return null;
    }
    const user = this.store.findUserById(session.userId);
    return user ? this.toAuthUser(user) : null;
  }

  upsertOAuthUser(
    provider: string,
    providerId: string,
    profile: { email: string; displayName: string; avatarUrl?: string | null },
  ): AuthUser {
    const existing = this.store.findUserByOAuth(provider, providerId);
    if (existing) return this.toAuthUser(existing);

    const byEmail = this.store.findUserByEmail(profile.email);
    if (byEmail) {
      this.store.linkOAuthAccount(byEmail.id, provider, providerId);
      return this.toAuthUser(byEmail);
    }

    const now = this.clock();
    const user = this.store.createUser({
      id: createUserId(),
      email: profile.email,
      displayName: this.generateUniqueUsername(profile.displayName || profile.email.split("@")[0] || "player"),
      passwordHash: null,
      avatarUrl: profile.avatarUrl ?? null,
      createdAt: now,
    });
    this.store.linkOAuthAccount(user.id, provider, providerId);
    return this.toAuthUser(user);
  }

  // Derive a unique, valid username for an OAuth signup from their provider name/email,
  // suffixing with random digits on collision so two "John Smith"s don't clash.
  private generateUniqueUsername(base: string): string {
    const cleaned = base.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, USERNAME_MAX_LENGTH);
    let candidate = cleaned;
    while (candidate.length < USERNAME_MIN_LENGTH) candidate += "0";
    if (!this.store.findUserByUsername(candidate)) return candidate;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const suffix = String(Math.floor(Math.random() * 10000));
      const stem = cleaned.slice(0, Math.max(USERNAME_MIN_LENGTH - 1, USERNAME_MAX_LENGTH - suffix.length - 1));
      const next = `${stem}-${suffix}`;
      if (!this.store.findUserByUsername(next)) return next;
    }
    return `player-${createUserId().slice(0, 8)}`;
  }

  getStats(userId: string): UserStats {
    return this.store.getStats(userId);
  }

  getFullStats(userId: string): FullStats {
    return this.store.getFullStats(userId);
  }

  recordGame(userId: string, result: GameResult): UserStats {
    return this.store.recordGame(userId, result, this.clock());
  }

  getDailyResult(userId: string, date: string): DailyChallengeResult | null {
    return this.store.getDailyResult(userId, date);
  }

  saveDailyResult(userId: string, result: DailyChallengeResult): DailyChallengeResult {
    return this.store.saveDailyResult(userId, result);
  }

  getDailySummary(userId: string, date: string, limit = DEFAULT_DAILY_HISTORY_LIMIT): DailySummary {
    const history = this.store.listDailyResults(userId, limit);
    const resultDates = new Set(history.map((result) => result.date));
    let streak = 0;
    for (let offset = 0; ; offset += 1) {
      if (!resultDates.has(previousDailyDate(date, offset))) break;
      streak += 1;
    }

    const best = history.reduce<DailyChallengeResult | null>((currentBest, result) => {
      if (!currentBest) return result;
      if (result.score !== currentBest.score) return result.score > currentBest.score ? result : currentBest;
      if (result.timeMs !== currentBest.timeMs) return result.timeMs < currentBest.timeMs ? result : currentBest;
      return result.hintsUsed < currentBest.hintsUsed ? result : currentBest;
    }, null);

    const friendsToday = this.store
      .listDailyResultsForUsers(this.store.friendIds(userId), date)
      .map((entry) => {
        const friend = this.store.findUserById(entry.userId);
        return friend ? { user: this.toPublicUser(friend), result: entry.result } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.result.score - a.result.score || a.result.timeMs - b.result.timeMs || a.user.username.localeCompare(b.user.username));

    return { history, streak, best, friendsToday };
  }

  submitBestTime(userId: string, input: { gameMode?: unknown; variant?: unknown; timeMs?: unknown }): SubmitBestTimeResult | { error: string } {
    if (!this.allowSubmit(userId)) return { error: "Too many submissions. Try again shortly." };

    const gameMode = typeof input.gameMode === "string" ? input.gameMode : "";
    if (!isLeaderboardGameMode(gameMode)) return { error: "Invalid game mode." };

    const variantRaw = typeof input.variant === "string" ? input.variant : "";
    const variant = normalizeLeaderboardVariant(gameMode, variantRaw);
    if (variant === null) return { error: "Invalid leaderboard variant." };

    const timeMs = input.timeMs;
    if (typeof timeMs !== "number" || !Number.isInteger(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS) {
      return { error: "Invalid completion time." };
    }

    return this.store.submitBestTime(userId, { gameMode, variant, timeMs, achievedAt: this.clock() });
  }

  getLeaderboard(query: { gameMode?: unknown; variant?: unknown; limit?: unknown; offset?: unknown }): { entries: readonly LeaderboardEntry[] } | { error: string } {
    const gameMode = typeof query.gameMode === "string" ? query.gameMode : "";
    if (!isLeaderboardGameMode(gameMode)) return { error: "Invalid game mode." };

    const variantRaw = typeof query.variant === "string" ? query.variant : "";
    const variant = normalizeLeaderboardVariant(gameMode, variantRaw);
    if (variant === null) return { error: "Invalid leaderboard variant." };

    const limit = typeof query.limit === "number" && Number.isInteger(query.limit) ? Math.min(Math.max(query.limit, 1), MAX_LEADERBOARD_LIMIT) : DEFAULT_LEADERBOARD_LIMIT;
    const offset = typeof query.offset === "number" && Number.isInteger(query.offset) && query.offset >= 0 ? query.offset : 0;
    const boardQuery: LeaderboardQuery = { gameMode, variant, limit, offset };
    return { entries: this.store.getLeaderboard(boardQuery) };
  }

  getUserLeaderboardRank(userId: string, gameMode: string, variant: string): UserLeaderboardRank | null {
    return this.store.getUserRank(userId, gameMode, variant);
  }

  // --- Admin account controls ---

  listUsers(query: { q?: unknown; limit?: unknown; offset?: unknown }): AdminUserList {
    const search = typeof query.q === "string" && query.q.trim().length > 0 ? query.q.trim() : null;
    const limit = typeof query.limit === "number" && Number.isInteger(query.limit) ? Math.min(Math.max(query.limit, 1), MAX_ADMIN_PAGE) : DEFAULT_ADMIN_PAGE;
    const offset = typeof query.offset === "number" && Number.isInteger(query.offset) && query.offset > 0 ? query.offset : 0;
    return this.store.listUsers({ query: search, limit, offset });
  }

  getUserDetail(id: string): { user: AuthUser; stats: UserStats } | null {
    const user = this.store.findUserById(id);
    return user ? { user: this.toAuthUser(user), stats: this.store.getStats(id) } : null;
  }

  deleteUser(id: string): boolean {
    return this.store.deleteUser(id);
  }

  revokeUserSessions(id: string): number {
    return this.store.deleteUserSessions(id);
  }

  // --- Friends ---

  // Send a friend request to a user identified by username. Returns the store result, or
  // "not-found" when the username doesn't resolve, or "rate-limited" when over the limit.
  sendFriendRequest(requesterId: string, username: unknown): SendFriendRequestResult | "rate-limited" {
    if (!this.allowSubmit(`friend-req:${requesterId}`)) return "rate-limited";
    const handle = normalizeUsername(username);
    if (!handle) return "not-found";
    const target = this.store.findUserByUsername(handle);
    if (!target) return "not-found";
    return this.store.sendFriendRequest(requesterId, target.id, this.clock());
  }

  acceptFriendRequest(userId: string, requesterId: string): boolean {
    return this.store.acceptFriendRequest(userId, requesterId, this.clock());
  }

  removeFriendship(userId: string, otherId: string): boolean {
    return this.store.removeFriendship(userId, otherId);
  }

  listFriends(userId: string): readonly PublicUser[] {
    return this.store.listFriends(userId);
  }

  listFriendRequests(userId: string): FriendRequestLists {
    return this.store.listFriendRequests(userId);
  }

  areFriends(a: string, b: string): boolean {
    return this.store.areFriends(a, b);
  }

  friendIds(userId: string): readonly string[] {
    return this.store.friendIds(userId);
  }

  searchUsers(userId: string, query: unknown): readonly PublicUser[] {
    if (typeof query !== "string" || query.trim().length < 2) return [];
    if (!this.allowSubmit(`user-search:${userId}`)) return [];
    return this.store.searchUsers(query.trim(), userId, 20);
  }

  // Resolve a username to its user id (for pushing live notifications to the right person).
  resolveUserId(username: unknown): string | null {
    const handle = normalizeUsername(username);
    return handle ? this.store.findUserByUsername(handle)?.id ?? null : null;
  }

  private allowSubmit(userId: string): boolean {
    const now = this.clock();
    const recent = (this.submitTimestamps.get(userId) ?? []).filter((timestamp) => now - timestamp < SUBMIT_RATE_WINDOW_MS);
    if (recent.length >= SUBMIT_RATE_LIMIT) return false;
    recent.push(now);
    this.submitTimestamps.set(userId, recent);
    return true;
  }

  updateAvatarEmoji(userId: string, emoji: string | null): void {
    this.store.updateAvatarEmoji(userId, emoji);
  }

  pruneExpiredSessions(): void {
    this.store.deleteExpiredSessions(this.clock());
  }

  // Public so OAuth callbacks can open a session for a user they just upserted.
  createSessionFor(userId: string): Session {
    return this.openSession(userId, this.clock());
  }

  private openSession(userId: string, now: number): Session {
    return this.store.createSession({ id: createSessionToken(), userId, expiresAt: now + this.ttlMs, createdAt: now });
  }

  private toAuthUser(user: StoredUser): AuthUser {
    return { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, avatarEmoji: user.avatarEmoji, createdAt: user.createdAt };
  }

  private toPublicUser(user: StoredUser): PublicUser {
    return { id: user.id, username: user.displayName, avatarEmoji: user.avatarEmoji };
  }
}
