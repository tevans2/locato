import { normalizeUsername } from "../auth/AuthService";
import type { AcademyProgress } from "../../src/core/academy/types";
import { LEADERBOARD_MODES, type LeaderboardMetric } from "../../src/core/leaderboards";
import { isLeaderboardGameMode, leaderboardMetric, leaderboardModeConfig, normalizeLeaderboardVariant } from "../leaderboard/validation";
import type { AdminRoomSummary, RoomManagerStats } from "../rooms/RoomManager";
import type {
  AdminBestScore,
  StoredRun,
  AdminBestTime,
  AdminEvent,
  AdminEventLevel,
  AdminSessionInfo,
  AdminTotals,
  AdminUserList,
  AdminAccess,
  AuthUser,
  CategoryStats,
  DailyChallengeResult,
  GameRecord,
  LeaderboardEntry,
  LeaderboardScoreEntry,
  PublicUser,
  StoredUser,
  UserStats,
  UserStore,
} from "../auth/types";

const DAY_MS = 86_400_000;
const DEFAULT_USER_PAGE = 50;
const MAX_USER_PAGE = 200;
const DEFAULT_EVENT_PAGE = 100;
const MAX_EVENT_PAGE = 500;
const OVERVIEW_DAYS = 30;
const TOP_PLAYERS = 8;
// Moderation hints only — nothing is rejected on these. A 10-round daily in under 15s means
// under 1.5s a round, and a sub-10s best time is faster than any real run we've seen.
export const SUSPICIOUS_DAILY_MS = 15_000;
export const SUSPICIOUS_BEST_TIME_MS = 10_000;
// A perfect total on a distance-scored board (MapTap, GeoGuessr) means every pin was dead on.
const SUSPICIOUS_PERFECT_SCORE_MIN = 1_000;

function isSuspiciousScore(gameMode: string, score: number): boolean {
  const maxScore = leaderboardModeConfig(gameMode)?.maxScore;
  return maxScore !== undefined && maxScore >= SUSPICIOUS_PERFECT_SCORE_MIN && score >= maxScore;
}

export type AdminLeaderboardEntry =
  | (LeaderboardEntry & { readonly suspicious: boolean })
  | (LeaderboardScoreEntry & { readonly suspicious: boolean });

export interface AdminRoomsBridge {
  listRooms(): readonly AdminRoomSummary[];
  closeRoom(code: string): boolean;
  stats(): RoomManagerStats;
}

export interface AdminPresenceBridge {
  onlineUserIds(): readonly string[];
}

export interface AdminServiceOptions {
  readonly rooms?: AdminRoomsBridge;
  readonly presence?: AdminPresenceBridge;
  readonly clock?: () => number;
  /** Accounts that are always admins (ADMIN_EMAILS): how the first admin gets in. */
  readonly adminEmails?: readonly string[];
}

export interface AdminWindowStats {
  readonly activeUsers: number;
  readonly signups: number;
  readonly games: number;
  readonly dailies: number;
  readonly logins: number;
}

export interface AdminDayStats {
  readonly date: string;
  readonly activeUsers: number;
  readonly signups: number;
  readonly games: number;
  readonly dailies: number;
}

export interface AdminOverview {
  readonly generatedAt: number;
  readonly totals: AdminTotals;
  readonly live: { readonly onlineUsers: number; readonly rooms: number; readonly roomConnections: number };
  readonly windows: { readonly day: AdminWindowStats; readonly week: AdminWindowStats; readonly month: AdminWindowStats; readonly previousMonth: AdminWindowStats };
  readonly series: readonly AdminDayStats[];
  readonly modes: readonly { readonly mode: string; readonly games: number; readonly players: number }[];
  readonly topPlayers: readonly { readonly user: PublicUser; readonly games: number; readonly dailies: number; readonly lastActiveAt: number }[];
}

// Headline numbers only — the dossier never ships the raw progress blob.
export interface AdminAcademySummary {
  readonly cardsSeen: number;
  // Cards in the top Leitner box (5 = long-term memory).
  readonly cardsMastered: number;
  readonly activeDays: number;
  readonly placementCompletedAt: number | null;
  readonly updatedAt: number;
}

export interface AdminUserDetail {
  readonly user: AuthUser & { readonly hasPassword: boolean; readonly admin: AdminAccess };
  readonly online: boolean;
  readonly providers: readonly string[];
  readonly stats: UserStats;
  readonly categories: readonly CategoryStats[];
  readonly recentGames: readonly GameRecord[];
  readonly dailies: readonly DailyChallengeResult[];
  readonly bestTimes: readonly (AdminBestTime & { readonly suspicious: boolean })[];
  readonly bestScores: readonly (AdminBestScore & { readonly suspicious: boolean })[];
  readonly sessions: readonly AdminSessionInfo[];
  readonly friends: readonly PublicUser[];
  readonly friendRequests: { readonly incoming: number; readonly outgoing: number };
  readonly events: readonly AdminEvent[];
  readonly academy: AdminAcademySummary | null;
  /** Audited runs, newest first (src/core/runAudit). */
  readonly runs: readonly AdminRun[];
}

/** A run for the admin console: its checks, plus when each country was found (for the curve). */
export interface AdminRun {
  readonly id: string;
  readonly userId: string;
  readonly displayName: string | null;
  readonly gameMode: string;
  readonly variant: string;
  readonly timed: boolean;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly outcome: StoredRun["outcome"];
  readonly claimedMs: number | null;
  readonly countries: number;
  readonly flags: StoredRun["flags"];
  readonly verdict: StoredRun["verdict"];
  readonly posted: boolean;
  readonly refused: boolean;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** ms into the run each country was found. */
  readonly times: readonly number[];
  readonly typedInputs: number;
  readonly scriptedInputs: number;
  readonly pastes: number;
  readonly hiddenMs: number;
}

export interface AdminDailyEntry {
  readonly rank: number;
  readonly user: { readonly id: string; readonly displayName: string; readonly email: string };
  readonly result: DailyChallengeResult;
  readonly flags: readonly ("too-fast" | "backdated")[];
}

export type AdminResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly status: number; readonly error: string };

function fail(status: number, error: string): { ok: false; status: number; error: string } {
  return { ok: false, status, error };
}

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(Math.max(value, min), max) : fallback;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function modeLabel(mode: string, playMode: string | null): string {
  return playMode ? `${mode} · ${playMode}` : mode;
}

// Admin-only read and moderation layer over the user store plus live in-memory state.
// The route layer checks the caller is an admin (isAdmin) before anything here runs.
export class AdminService {
  private readonly clock: () => number;
  private readonly adminEmails: ReadonlySet<string>;

  constructor(private readonly store: UserStore, private readonly options: AdminServiceOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.adminEmails = new Set((options.adminEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean));
  }

  // --- Admin access ---

  adminAccess(user: { readonly id: string; readonly email: string }): AdminAccess {
    if (this.adminEmails.has(user.email.toLowerCase())) return "config";
    return this.store.isAdmin(user.id) ? "granted" : null;
  }

  isAdmin(user: { readonly id: string; readonly email: string }): boolean {
    return this.adminAccess(user) !== null;
  }

  /** Grant or revoke console access. ADMIN_EMAILS accounts and your own access can't be revoked here. */
  setAdmin(actorId: string, targetId: string, admin: unknown): AdminResult<AdminAccess> {
    if (typeof admin !== "boolean") return fail(400, "Send admin: true or false.");
    const user = this.store.findUserById(targetId);
    if (!user) return fail(404, "User not found.");
    if (!admin && this.adminAccess(user) === "config") return fail(409, "This account is an admin through ADMIN_EMAILS. Remove it there instead.");
    if (!admin && targetId === actorId) return fail(409, "You can't remove your own admin access. Ask another admin.");
    this.store.setAdmin(targetId, admin);
    return { ok: true, value: this.adminAccess(user) };
  }

  overview(): AdminOverview {
    const now = this.clock();
    const todayStart = Date.parse(`${utcDate(now)}T00:00:00.000Z`);
    const seriesStart = todayStart - (OVERVIEW_DAYS - 1) * DAY_MS;
    const monthStart = now - OVERVIEW_DAYS * DAY_MS;
    const previousStart = now - 2 * OVERVIEW_DAYS * DAY_MS;
    const rows = this.store.listActivitySince(Math.min(seriesStart, previousStart));

    const windowStats = (from: number, to: number): AdminWindowStats => {
      const inRange = (at: number) => at >= from && at < to;
      const active = new Set<string>();
      const games = rows.games.filter((r) => inRange(r.at));
      const dailies = rows.dailies.filter((r) => inRange(r.at));
      const logins = rows.logins.filter((r) => inRange(r.at));
      for (const r of [...games, ...dailies, ...logins]) active.add(r.userId);
      return { activeUsers: active.size, signups: rows.signups.filter((r) => inRange(r.at)).length, games: games.length, dailies: dailies.length, logins: logins.length };
    };

    const series: AdminDayStats[] = [];
    for (let day = 0; day < OVERVIEW_DAYS; day += 1) {
      const from = seriesStart + day * DAY_MS;
      const stats = windowStats(from, from + DAY_MS);
      series.push({ date: utcDate(from), activeUsers: stats.activeUsers, signups: stats.signups, games: stats.games, dailies: stats.dailies });
    }

    const modeCounts = new Map<string, { games: number; players: Set<string> }>();
    for (const game of rows.games) {
      if (game.at < monthStart) continue;
      const key = modeLabel(game.mode, game.playMode);
      const entry = modeCounts.get(key) ?? { games: 0, players: new Set<string>() };
      entry.games += 1;
      entry.players.add(game.userId);
      modeCounts.set(key, entry);
    }

    const perUser = new Map<string, { games: number; dailies: number; lastActiveAt: number }>();
    const bump = (userId: string, at: number, field: "games" | "dailies") => {
      const entry = perUser.get(userId) ?? { games: 0, dailies: 0, lastActiveAt: 0 };
      entry[field] += 1;
      entry.lastActiveAt = Math.max(entry.lastActiveAt, at);
      perUser.set(userId, entry);
    };
    for (const game of rows.games) if (game.at >= monthStart) bump(game.userId, game.at, "games");
    for (const daily of rows.dailies) if (daily.at >= monthStart) bump(daily.userId, daily.at, "dailies");
    const topPlayers = [...perUser.entries()]
      .sort(([, a], [, b]) => b.games + b.dailies - (a.games + a.dailies) || b.lastActiveAt - a.lastActiveAt)
      .slice(0, TOP_PLAYERS)
      .flatMap(([userId, entry]) => {
        const user = this.store.findUserById(userId);
        return user ? [{ user: this.toPublicUser(user), ...entry }] : [];
      });

    const roomStats = this.options.rooms?.stats() ?? { rooms: 0, connections: 0 };
    return {
      generatedAt: now,
      totals: this.store.getAdminTotals(now),
      live: { onlineUsers: this.options.presence?.onlineUserIds().length ?? 0, rooms: roomStats.rooms, roomConnections: roomStats.connections },
      windows: {
        day: windowStats(now - DAY_MS, now + 1),
        week: windowStats(now - 7 * DAY_MS, now + 1),
        month: windowStats(monthStart, now + 1),
        previousMonth: windowStats(previousStart, monthStart),
      },
      series,
      modes: [...modeCounts.entries()].map(([mode, entry]) => ({ mode, games: entry.games, players: entry.players.size })).sort((a, b) => b.games - a.games),
      topPlayers,
    };
  }

  // --- Users ---

  listUsers(query: { q?: unknown; limit?: unknown; offset?: unknown }): AdminUserList {
    const list = this.store.listUsers({
      query: nonEmpty(query.q),
      limit: clampInt(query.limit, DEFAULT_USER_PAGE, 1, MAX_USER_PAGE),
      offset: clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    });
    return { ...list, users: list.users.map((user) => (this.adminEmails.has(user.email.toLowerCase()) ? { ...user, admin: "config" } : user)) };
  }

  getUserDetail(id: string): AdminUserDetail | null {
    const user = this.store.findUserById(id);
    if (!user) return null;
    const now = this.clock();
    const full = this.store.getFullStats(id);
    const { categories, recentGames, ...stats } = full;
    const requests = this.store.listFriendRequests(id);
    const online = new Set(this.options.presence?.onlineUserIds() ?? []);
    return {
      user: { ...this.toAuthUser(user), hasPassword: user.passwordHash !== null, admin: this.adminAccess(user) },
      online: online.has(id),
      providers: this.store.listUserProviders(id),
      stats,
      categories,
      recentGames,
      dailies: this.store.listDailyResults(id, 60),
      bestTimes: this.store.listUserBestTimes(id).map((row) => ({ ...row, suspicious: row.timeMs < SUSPICIOUS_BEST_TIME_MS })),
      bestScores: this.store.listUserBestScores(id).map((row) => ({ ...row, suspicious: isSuspiciousScore(row.gameMode, row.score) })),
      sessions: this.store.listUserSessions(id, now),
      friends: this.store.listFriends(id),
      friendRequests: { incoming: requests.incoming.length, outgoing: requests.outgoing.length },
      events: this.store.listEvents({ level: null, action: null, ip: null, userId: id, before: null, limit: 50 }),
      academy: this.academySummary(id),
      runs: this.store.listUserRuns(id, 30).map((run) => this.toAdminRun(run, user.displayName)),
    };
  }

  /** Runs that raised a flag, across every player, newest first. */
  flaggedRuns(limit: unknown): readonly AdminRun[] {
    const count = typeof limit === "number" && Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    return this.store.listFlaggedRuns(count).map((run) => this.toAdminRun(run, this.store.findUserById(run.userId)?.displayName ?? null));
  }

  private toAdminRun(run: StoredRun, displayName: string | null): AdminRun {
    const entries = run.timeline?.entries ?? [];
    return {
      id: run.id,
      userId: run.userId,
      displayName,
      gameMode: run.gameMode,
      variant: run.variant,
      timed: run.timed,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      outcome: run.outcome,
      claimedMs: run.claimedMs,
      countries: run.countries,
      flags: run.flags,
      verdict: run.verdict,
      posted: run.posted,
      refused: run.refused,
      ip: run.ip,
      userAgent: run.userAgent,
      times: entries.map((entry) => entry[1]),
      typedInputs: entries.reduce((sum, entry) => sum + entry[2], 0),
      scriptedInputs: entries.reduce((sum, entry) => sum + entry[3], 0),
      pastes: run.timeline?.signals.pastes ?? 0,
      hiddenMs: run.timeline?.signals.hiddenMs ?? 0,
    };
  }

  private academySummary(userId: string): AdminAcademySummary | null {
    const stored = this.store.getAcademyProgress(userId);
    if (!stored) return null;
    let progress: AcademyProgress;
    try {
      progress = JSON.parse(stored.progress) as AcademyProgress;
    } catch {
      return null;
    }
    const cards = Object.values(progress.cards ?? {});
    return {
      cardsSeen: cards.filter((card) => card.lastSeenAt > 0 || card.box > 0).length,
      cardsMastered: cards.filter((card) => card.box === 5).length,
      activeDays: Object.values(progress.activity ?? {}).filter((count) => count > 0).length,
      placementCompletedAt: progress.placementCompletedAt ?? null,
      updatedAt: stored.updatedAt,
    };
  }

  updateUser(id: string, patch: { displayName?: unknown; clearAvatar?: unknown }): AdminResult<AuthUser> {
    const user = this.store.findUserById(id);
    if (!user) return fail(404, "User not found.");
    if (patch.displayName !== undefined) {
      const name = normalizeUsername(patch.displayName);
      if (!name) return fail(400, "Username must be 3–20 characters using letters, numbers, _ or -.");
      const clash = this.store.findUserByUsername(name);
      if (clash && clash.id !== id) return fail(409, "That username is taken.");
      this.store.updateDisplayName(id, name);
    }
    if (patch.clearAvatar === true) this.store.updateAvatarEmoji(id, null);
    return { ok: true, value: this.toAuthUser(this.store.findUserById(id)!) };
  }

  deleteUser(id: string): boolean {
    return this.store.deleteUser(id);
  }

  revokeUserSessions(id: string): number {
    return this.store.deleteUserSessions(id);
  }

  // Deliberately leaves Academy progress alone: it's learning state, not competitive stats, and
  // wiping it server-side would just be re-uploaded (and merged back) from the player's device.
  resetUserStats(id: string): boolean {
    if (!this.store.findUserById(id)) return false;
    this.store.resetUserStats(id);
    return true;
  }

  // --- Leaderboards ---

  leaderboardMeta(): { readonly modes: readonly { readonly id: string; readonly metric: LeaderboardMetric; readonly variants: readonly string[]; readonly maxScore?: number }[] } {
    return {
      modes: LEADERBOARD_MODES.map((config) => ({
        id: config.mode,
        metric: config.metric,
        variants: [...config.variants],
        ...(config.maxScore !== undefined ? { maxScore: config.maxScore } : {}),
      })),
    };
  }

  leaderboard(query: { mode?: unknown; variant?: unknown; limit?: unknown }): AdminResult<{ readonly metric: LeaderboardMetric; readonly entries: readonly AdminLeaderboardEntry[] }> {
    const mode = typeof query.mode === "string" ? query.mode : "";
    if (!isLeaderboardGameMode(mode)) return fail(400, "Invalid game mode.");
    const variant = normalizeLeaderboardVariant(mode, typeof query.variant === "string" ? query.variant : "");
    if (variant === null) return fail(400, "Invalid leaderboard variant.");
    const boardQuery = { gameMode: mode, variant, limit: clampInt(query.limit, 100, 1, 500), offset: 0 };
    if (leaderboardMetric(mode) === "score") {
      const entries = this.store.getScoreLeaderboard(boardQuery);
      return { ok: true, value: { metric: "score", entries: entries.map((entry) => ({ ...entry, suspicious: isSuspiciousScore(mode, entry.score) })) } };
    }
    const entries = this.store.getLeaderboard(boardQuery);
    return { ok: true, value: { metric: "time", entries: entries.map((entry) => ({ ...entry, suspicious: entry.timeMs < SUSPICIOUS_BEST_TIME_MS })) } };
  }

  /** Remove one board entry (a best time or a best score, by the mode's metric). */
  deleteBestTime(userId: string, mode: string, variant: string): boolean {
    const metric = leaderboardMetric(mode);
    if (metric === "score") return this.store.deleteBestScore(userId, mode, variant);
    if (metric === "time") return this.store.deleteBestTime(userId, mode, variant);
    return false;
  }

  daily(date: string): readonly AdminDailyEntry[] {
    return this.store
      .listDailyResultsForDate(date)
      .flatMap((entry) => {
        const user = this.store.findUserById(entry.userId);
        return user ? [{ user: { id: user.id, displayName: user.displayName, email: user.email }, result: entry.result }] : [];
      })
      .sort((a, b) => b.result.score - a.result.score || a.result.timeMs - b.result.timeMs || a.result.hintsUsed - b.result.hintsUsed)
      .map((entry, index) => {
        const flags: ("too-fast" | "backdated")[] = [];
        if (entry.result.timeMs < SUSPICIOUS_DAILY_MS) flags.push("too-fast");
        // Allow a day either side for timezones; anything further was submitted for another day.
        if (Math.abs(Date.parse(`${date}T12:00:00.000Z`) - entry.result.completedAt) > 1.5 * DAY_MS) flags.push("backdated");
        return { rank: index + 1, ...entry, flags };
      });
  }

  deleteDailyResult(userId: string, date: string): boolean {
    return this.store.deleteDailyResult(userId, date);
  }

  // --- Live state & events ---

  rooms(): readonly AdminRoomSummary[] {
    return this.options.rooms?.listRooms() ?? [];
  }

  closeRoom(code: string): boolean {
    return this.options.rooms?.closeRoom(code) ?? false;
  }

  onlineUsers(): readonly PublicUser[] {
    return (this.options.presence?.onlineUserIds() ?? []).flatMap((id) => {
      const user = this.store.findUserById(id);
      return user ? [this.toPublicUser(user)] : [];
    });
  }

  events(query: { level?: unknown; action?: unknown; ip?: unknown; userId?: unknown; before?: unknown; limit?: unknown }): readonly AdminEvent[] {
    const level: AdminEventLevel | null = query.level === "info" || query.level === "warn" ? query.level : null;
    return this.store.listEvents({
      level,
      action: nonEmpty(query.action),
      ip: nonEmpty(query.ip),
      userId: nonEmpty(query.userId),
      before: typeof query.before === "number" && Number.isInteger(query.before) ? query.before : null,
      limit: clampInt(query.limit, DEFAULT_EVENT_PAGE, 1, MAX_EVENT_PAGE),
    });
  }

  private toAuthUser(user: StoredUser): AuthUser {
    return { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, avatarEmoji: user.avatarEmoji, createdAt: user.createdAt };
  }

  private toPublicUser(user: StoredUser): PublicUser {
    return { id: user.id, username: user.displayName, avatarEmoji: user.avatarEmoji };
  }
}
