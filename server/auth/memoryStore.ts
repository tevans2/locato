import type {
  AdminUserList,
  AdminUserListQuery,
  CategoryStats,
  CreateSessionInput,
  CreateUserInput,
  FullStats,
  GameRecord,
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

const EMPTY_STATS: UserStats = { totalGames: 0, totalCorrect: 0, totalWrong: 0, bestStreak: 0, soloGames: 0, soloCorrect: 0, soloWrong: 0, soloBestStreak: 0, multiplayerGames: 0, multiplayerWins: 0, multiplayerCorrect: 0, multiplayerWrong: 0, multiplayerBestStreak: 0, worldMapGames: 0, worldMapCompletions: 0, worldBestTimeMs: 0, worldBestCountries: 0 };

export function createMemoryUserStore(): UserStore {
  const usersById = new Map<string, StoredUser>();
  const usersByEmail = new Map<string, StoredUser>();
  const usersByOAuth = new Map<string, StoredUser>();
  const sessions = new Map<string, Session>();
  const stats = new Map<string, UserStats>();
  const categoryStats = new Map<string, Map<string, CategoryStats>>();
  const gameRecords = new Map<string, GameRecord[]>();
  const bestTimes = new Map<string, { userId: string; gameMode: string; variant: string; timeMs: number; achievedAt: number }>();

  function bestTimeKey(userId: string, gameMode: string, variant: string): string {
    return `${userId}:${gameMode}:${variant}`;
  }

  return {
    createUser(input: CreateUserInput): StoredUser {
      const user: StoredUser = { id: input.id, email: input.email, displayName: input.displayName, passwordHash: input.passwordHash, avatarUrl: input.avatarUrl, avatarEmoji: null, createdAt: input.createdAt };
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
    getFullStats(userId: string): FullStats {
      const s = stats.get(userId) ?? EMPTY_STATS;
      const cats = [...(categoryStats.get(userId)?.values() ?? [])].sort((a, b) => b.correct - a.correct);
      const records = [...(gameRecords.get(userId) ?? [])].sort((a, b) => b.playedAt - a.playedAt).slice(0, 20);
      return { ...s, categories: cats, recentGames: records };
    },
    recordGame(userId: string, result: GameResult, now: number): UserStats {
      const id = crypto.randomUUID();
      const isSolo = result.mode === "solo";
      const isMp = result.mode === "multiplayer";
      const isWorld = result.mode === "world-map";
      const record: GameRecord = {
        id, mode: result.mode, categoryIds: [...result.categoryIds],
        correctAnswers: result.correctAnswers, wrongAnswers: result.wrongAnswers, score: result.score, bestStreak: result.bestStreak,
        rank: result.rank ?? null, totalPlayers: result.totalPlayers ?? null, playedAt: now,
        durationMs: isWorld ? (result.durationMs ?? 0) : null,
        completed: isWorld ? Boolean(result.completed) : null,
        countriesFound: isWorld ? (result.countriesFound ?? 0) : null,
        countriesTotal: isWorld ? (result.countriesTotal ?? 0) : null,
        playMode: isWorld ? (result.playMode ?? null) : null,
      };
      const records = gameRecords.get(userId) ?? [];
      gameRecords.set(userId, [...records, record]);

      // Per-category stats only apply to prompt-based modes (solo/multiplayer).
      if (!isWorld) {
        for (const catId of result.categoryIds) {
          const cats = categoryStats.get(userId) ?? new Map<string, CategoryStats>();
          const existing = cats.get(catId) ?? { categoryId: catId, correct: 0, wrong: 0 };
          cats.set(catId, { categoryId: catId, correct: existing.correct + result.correctAnswers, wrong: existing.wrong + result.wrongAnswers });
          categoryStats.set(userId, cats);
        }
      }

      const current = stats.get(userId) ?? EMPTY_STATS;
      const worldTime = isWorld && result.completed && result.playMode !== "puzzle" && (result.durationMs ?? 0) > 0 ? (result.durationMs ?? 0) : 0;
      const worldCountries = isWorld && result.playMode !== "puzzle" ? (result.countriesFound ?? 0) : 0;
      const nextBestTime = worldTime === 0 ? current.worldBestTimeMs : current.worldBestTimeMs === 0 ? worldTime : Math.min(current.worldBestTimeMs, worldTime);
      const next: UserStats = {
        totalGames: current.totalGames + 1,
        totalCorrect: current.totalCorrect + result.correctAnswers,
        totalWrong: current.totalWrong + result.wrongAnswers,
        bestStreak: Math.max(current.bestStreak, result.bestStreak),
        soloGames: current.soloGames + (isSolo ? 1 : 0),
        soloCorrect: current.soloCorrect + (isSolo ? result.correctAnswers : 0),
        soloWrong: current.soloWrong + (isSolo ? result.wrongAnswers : 0),
        soloBestStreak: isSolo ? Math.max(current.soloBestStreak, result.bestStreak) : current.soloBestStreak,
        multiplayerGames: current.multiplayerGames + (isMp ? 1 : 0),
        multiplayerWins: current.multiplayerWins + (isMp && result.rank === 1 ? 1 : 0),
        multiplayerCorrect: current.multiplayerCorrect + (isMp ? result.correctAnswers : 0),
        multiplayerWrong: current.multiplayerWrong + (isMp ? result.wrongAnswers : 0),
        multiplayerBestStreak: isMp ? Math.max(current.multiplayerBestStreak, result.bestStreak) : current.multiplayerBestStreak,
        worldMapGames: current.worldMapGames + (isWorld ? 1 : 0),
        worldMapCompletions: current.worldMapCompletions + (isWorld && result.completed ? 1 : 0),
        worldBestTimeMs: nextBestTime,
        worldBestCountries: Math.max(current.worldBestCountries, worldCountries),
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
          games: (stats.get(user.id) ?? EMPTY_STATS).totalGames,
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
      categoryStats.delete(id);
      gameRecords.delete(id);
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
