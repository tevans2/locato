import type {
  AdminUserList,
  AdminUserListQuery,
  CreateSessionInput,
  CreateUserInput,
  GameResult,
  LeaderboardEntry,
  LeaderboardQuery,
  Session,
  StoredUser,
  SubmitBestTimeInput,
  SubmitBestTimeResult,
  UserLeaderboardRank,
  UserStats,
  UserStore,
} from "./types";

const EMPTY_STATS: UserStats = { games: 0, correctAnswers: 0, wrongAnswers: 0, bestStreak: 0 };

// Process-memory UserStore. Used by tests, and as a graceful fallback for local dev when no
// SQLite database is configured. Not durable — data is lost on restart.
export function createMemoryUserStore(): UserStore {
  const usersById = new Map<string, StoredUser>();
  const usersByEmail = new Map<string, StoredUser>();
  const usersByOAuth = new Map<string, StoredUser>();
  const sessions = new Map<string, Session>();
  const stats = new Map<string, UserStats>();
  const bestTimes = new Map<string, { userId: string; gameMode: string; variant: string; timeMs: number; achievedAt: number }>();

  function bestTimeKey(userId: string, gameMode: string, variant: string): string {
    return `${userId}:${gameMode}:${variant}`;
  }

  return {
    createUser(input: CreateUserInput): StoredUser {
      const user: StoredUser = {
        id: input.id,
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        avatarUrl: input.avatarUrl,
        avatarEmoji: null,
        createdAt: input.createdAt,
      };
      usersById.set(user.id, user);
      usersByEmail.set(user.email, user);
      return user;
    },
    findUserByEmail: (email) => usersByEmail.get(email) ?? null,
    findUserById: (id) => usersById.get(id) ?? null,
    findUserByOAuth: (provider, providerId) => usersByOAuth.get(`${provider}:${providerId}`) ?? null,
    linkOAuthAccount(userId, provider, providerId) {
      const user = usersById.get(userId);
      if (user) usersByOAuth.set(`${provider}:${providerId}`, user);
    },
    updateAvatarEmoji(userId: string, emoji: string | null): void {
      const user = usersById.get(userId);
      if (!user) return;
      const updated = { ...user, avatarEmoji: emoji };
      usersById.set(userId, updated);
      usersByEmail.set(user.email, updated);
    },
    createSession(input: CreateSessionInput): Session {
      const session: Session = { id: input.id, userId: input.userId, expiresAt: input.expiresAt, createdAt: input.createdAt };
      sessions.set(session.id, session);
      return session;
    },
    findSession: (id) => sessions.get(id) ?? null,
    deleteSession: (id) => void sessions.delete(id),
    deleteExpiredSessions(now: number): void {
      for (const [id, session] of sessions) {
        if (session.expiresAt <= now) sessions.delete(id);
      }
    },
    getStats: (userId) => stats.get(userId) ?? EMPTY_STATS,
    recordGame(userId: string, result: GameResult): UserStats {
      const current = stats.get(userId) ?? EMPTY_STATS;
      const next: UserStats = {
        games: current.games + 1,
        correctAnswers: current.correctAnswers + result.correctAnswers,
        wrongAnswers: current.wrongAnswers + result.wrongAnswers,
        bestStreak: Math.max(current.bestStreak, result.bestStreak),
      };
      stats.set(userId, next);
      return next;
    },
    submitBestTime(userId: string, input: SubmitBestTimeInput): SubmitBestTimeResult {
      const key = bestTimeKey(userId, input.gameMode, input.variant);
      const existing = bestTimes.get(key);
      if (existing && input.timeMs >= existing.timeMs) {
        return { accepted: false, isPersonalBest: false };
      }
      bestTimes.set(key, { userId, gameMode: input.gameMode, variant: input.variant, timeMs: input.timeMs, achievedAt: input.achievedAt });
      return { accepted: true, isPersonalBest: true };
    },
    getLeaderboard(query: LeaderboardQuery): readonly LeaderboardEntry[] {
      const rows = [...bestTimes.values()]
        .filter((row) => row.gameMode === query.gameMode && row.variant === query.variant)
        .sort((a, b) => (a.timeMs !== b.timeMs ? a.timeMs - b.timeMs : a.achievedAt - b.achievedAt));

      return rows.slice(query.offset, query.offset + query.limit).map((row, index) => {
        const user = usersById.get(row.userId);
        return {
          rank: query.offset + index + 1,
          userId: row.userId,
          displayName: user?.displayName ?? "Player",
          avatarEmoji: user?.avatarEmoji ?? null,
          timeMs: row.timeMs,
          achievedAt: row.achievedAt,
        };
      });
    },
    getUserRank(userId: string, gameMode: string, variant: string): UserLeaderboardRank | null {
      const row = bestTimes.get(bestTimeKey(userId, gameMode, variant));
      if (!row) return null;

      const rank =
        [...bestTimes.values()]
          .filter((entry) => entry.gameMode === gameMode && entry.variant === variant)
          .filter((entry) => entry.timeMs < row.timeMs || (entry.timeMs === row.timeMs && entry.achievedAt < row.achievedAt)).length + 1;

      return { rank, timeMs: row.timeMs };
    },
    listUsers(query: AdminUserListQuery): AdminUserList {
      const needle = query.query?.toLowerCase() ?? null;
      const matched = [...usersById.values()]
        .filter((user) => needle === null || user.email.toLowerCase().includes(needle) || user.displayName.toLowerCase().includes(needle))
        .sort((a, b) => b.createdAt - a.createdAt);
      const page = matched.slice(query.offset, query.offset + query.limit);
      return {
        total: matched.length,
        users: page.map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarEmoji: user.avatarEmoji,
          hasPassword: user.passwordHash !== null,
          createdAt: user.createdAt,
          games: (stats.get(user.id) ?? EMPTY_STATS).games,
        })),
      };
    },
    deleteUser(id: string): boolean {
      const user = usersById.get(id);
      if (!user) return false;
      usersById.delete(id);
      usersByEmail.delete(user.email);
      for (const [key, value] of usersByOAuth) if (value.id === id) usersByOAuth.delete(key);
      for (const [key, session] of sessions) if (session.userId === id) sessions.delete(key);
      for (const [key, entry] of bestTimes) if (entry.userId === id) bestTimes.delete(key);
      stats.delete(id);
      return true;
    },
    deleteUserSessions(userId: string): number {
      let removed = 0;
      for (const [key, session] of sessions) {
        if (session.userId === userId) {
          sessions.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}
