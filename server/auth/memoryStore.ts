import type { CreateSessionInput, CreateUserInput, GameResult, Session, StoredUser, UserStats, UserStore } from "./types";

const EMPTY_STATS: UserStats = { games: 0, correctAnswers: 0, wrongAnswers: 0, bestStreak: 0 };

// Process-memory UserStore. Used by tests, and as a graceful fallback for local dev when no
// SQLite database is configured. Not durable — data is lost on restart.
export function createMemoryUserStore(): UserStore {
  const usersById = new Map<string, StoredUser>();
  const usersByEmail = new Map<string, StoredUser>();
  const usersByOAuth = new Map<string, StoredUser>();
  const sessions = new Map<string, Session>();
  const stats = new Map<string, UserStats>();

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
  };
}
