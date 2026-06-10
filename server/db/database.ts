// This module imports bun:sqlite — never import from Node/vitest test graph.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type {
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
} from "../auth/types";

export function openDatabase(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      avatar_url TEXT,
      avatar_emoji TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (provider, provider_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS user_stats (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      games INTEGER NOT NULL DEFAULT 0,
      correct_answers INTEGER NOT NULL DEFAULT 0,
      wrong_answers INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mode_best_times (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_mode TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT '',
      best_time_ms INTEGER NOT NULL,
      achieved_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, game_mode, variant)
    );

    CREATE INDEX IF NOT EXISTS mode_best_times_rank
      ON mode_best_times (game_mode, variant, best_time_ms ASC, achieved_at ASC);
  `);
  // Non-destructive additive migration: add avatar_emoji column to existing databases.
  try { db.exec("ALTER TABLE users ADD COLUMN avatar_emoji TEXT DEFAULT NULL;"); } catch { /* column already exists */ }
}

// Column aliases map snake_case storage to camelCase domain types so rows are returned ready to use.
export class SqliteUserStore implements UserStore {
  constructor(private readonly db: Database) {}

  createUser(input: CreateUserInput): StoredUser {
    this.db
      .query("INSERT INTO users (id, email, display_name, password_hash, avatar_url, avatar_emoji, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)")
      .run(input.id, input.email, input.displayName, input.passwordHash, input.avatarUrl, input.createdAt);
    return { id: input.id, email: input.email, displayName: input.displayName, passwordHash: input.passwordHash, avatarUrl: input.avatarUrl, avatarEmoji: null, createdAt: input.createdAt };
  }

  findUserByEmail(email: string): StoredUser | null {
    return this.db
      .query<StoredUser>("SELECT id, email, display_name AS displayName, password_hash AS passwordHash, avatar_url AS avatarUrl, avatar_emoji AS avatarEmoji, created_at AS createdAt FROM users WHERE email = ?")
      .get(email);
  }

  findUserById(id: string): StoredUser | null {
    return this.db
      .query<StoredUser>("SELECT id, email, display_name AS displayName, password_hash AS passwordHash, avatar_url AS avatarUrl, avatar_emoji AS avatarEmoji, created_at AS createdAt FROM users WHERE id = ?")
      .get(id);
  }

  findUserByOAuth(provider: string, providerId: string): StoredUser | null {
    return this.db
      .query<StoredUser>(
        `SELECT u.id, u.email, u.display_name AS displayName, u.password_hash AS passwordHash,
                u.avatar_url AS avatarUrl, u.avatar_emoji AS avatarEmoji, u.created_at AS createdAt
         FROM users u JOIN oauth_accounts oa ON oa.user_id = u.id
         WHERE oa.provider = ? AND oa.provider_id = ?`,
      )
      .get(provider, providerId);
  }

  linkOAuthAccount(userId: string, provider: string, providerId: string): void {
    this.db.query("INSERT OR IGNORE INTO oauth_accounts (provider, provider_id, user_id) VALUES (?, ?, ?)").run(provider, providerId, userId);
  }

  updateAvatarEmoji(userId: string, emoji: string | null): void {
    this.db.query("UPDATE users SET avatar_emoji = ? WHERE id = ?").run(emoji, userId);
  }

  createSession(input: CreateSessionInput): Session {
    this.db.query("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(input.id, input.userId, input.expiresAt, input.createdAt);
    return { id: input.id, userId: input.userId, expiresAt: input.expiresAt, createdAt: input.createdAt };
  }

  findSession(id: string): Session | null {
    return this.db.query<Session>("SELECT id, user_id AS userId, expires_at AS expiresAt, created_at AS createdAt FROM sessions WHERE id = ?").get(id);
  }

  deleteSession(id: string): void {
    this.db.query("DELETE FROM sessions WHERE id = ?").run(id);
  }

  deleteExpiredSessions(now: number): void {
    this.db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }

  getStats(userId: string): UserStats {
    return (
      this.db
        .query<UserStats>("SELECT games, correct_answers AS correctAnswers, wrong_answers AS wrongAnswers, best_streak AS bestStreak FROM user_stats WHERE user_id = ?")
        .get(userId) ?? { games: 0, correctAnswers: 0, wrongAnswers: 0, bestStreak: 0 }
    );
  }

  recordGame(userId: string, result: GameResult): UserStats {
    this.db
      .query(
        `INSERT INTO user_stats (user_id, games, correct_answers, wrong_answers, best_streak)
         VALUES (?, 1, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           games = games + 1,
           correct_answers = correct_answers + excluded.correct_answers,
           wrong_answers = wrong_answers + excluded.wrong_answers,
           best_streak = MAX(best_streak, excluded.best_streak)`,
      )
      .run(userId, result.correctAnswers, result.wrongAnswers, result.bestStreak);
    return this.getStats(userId);
  }

  submitBestTime(userId: string, input: SubmitBestTimeInput): SubmitBestTimeResult {
    const existing = this.db
      .query<{ bestTimeMs: number }>("SELECT best_time_ms AS bestTimeMs FROM mode_best_times WHERE user_id = ? AND game_mode = ? AND variant = ?")
      .get(userId, input.gameMode, input.variant);

    if (existing && input.timeMs >= existing.bestTimeMs) {
      return { accepted: false, isPersonalBest: false };
    }

    this.db
      .query(
        `INSERT INTO mode_best_times (user_id, game_mode, variant, best_time_ms, achieved_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, game_mode, variant) DO UPDATE SET
           best_time_ms = excluded.best_time_ms,
           achieved_at = excluded.achieved_at
         WHERE excluded.best_time_ms < mode_best_times.best_time_ms`,
      )
      .run(userId, input.gameMode, input.variant, input.timeMs, input.achievedAt);

    return { accepted: true, isPersonalBest: true };
  }

  getLeaderboard(query: LeaderboardQuery): readonly LeaderboardEntry[] {
    const rows = this.db
      .query<{ userId: string; displayName: string; avatarEmoji: string | null; timeMs: number; achievedAt: number }>(
        `SELECT u.id AS userId, u.display_name AS displayName, u.avatar_emoji AS avatarEmoji,
                m.best_time_ms AS timeMs, m.achieved_at AS achievedAt
         FROM mode_best_times m
         JOIN users u ON u.id = m.user_id
         WHERE m.game_mode = ? AND m.variant = ?
         ORDER BY m.best_time_ms ASC, m.achieved_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(query.gameMode, query.variant, query.limit, query.offset);

    return rows.map((row, index) => ({
      rank: query.offset + index + 1,
      userId: row.userId,
      displayName: row.displayName,
      avatarEmoji: row.avatarEmoji,
      timeMs: row.timeMs,
      achievedAt: row.achievedAt,
    }));
  }

  getUserRank(userId: string, gameMode: string, variant: string): UserLeaderboardRank | null {
    const row = this.db
      .query<{ timeMs: number; achievedAt: number }>(
        "SELECT best_time_ms AS timeMs, achieved_at AS achievedAt FROM mode_best_times WHERE user_id = ? AND game_mode = ? AND variant = ?",
      )
      .get(userId, gameMode, variant);
    if (!row) return null;

    const rankRow = this.db
      .query<{ rank: number }>(
        `SELECT 1 + COUNT(*) AS rank
         FROM mode_best_times
         WHERE game_mode = ? AND variant = ?
           AND (best_time_ms < ? OR (best_time_ms = ? AND achieved_at < ?))`,
      )
      .get(gameMode, variant, row.timeMs, row.timeMs, row.achievedAt);

    return { rank: rankRow?.rank ?? 1, timeMs: row.timeMs };
  }
}
