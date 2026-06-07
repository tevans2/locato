import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { CreateSessionInput, CreateUserInput, GameResult, Session, StoredUser, UserStats, UserStore } from "../auth/types";

const EMPTY_STATS: UserStats = { games: 0, correctAnswers: 0, wrongAnswers: 0, bestStreak: 0 };

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
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
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
  `);
}

// Column aliases map snake_case storage to the camelCase domain types so rows are returned ready to use.
export class SqliteUserStore implements UserStore {
  constructor(private readonly db: Database) {}

  createUser(input: CreateUserInput): StoredUser {
    this.db
      .query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.id, input.email, input.displayName, input.passwordHash, input.createdAt);
    return { id: input.id, email: input.email, displayName: input.displayName, passwordHash: input.passwordHash, createdAt: input.createdAt };
  }

  findUserByEmail(email: string): StoredUser | null {
    return this.db
      .query<StoredUser>("SELECT id, email, display_name AS displayName, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE email = ?")
      .get(email);
  }

  findUserById(id: string): StoredUser | null {
    return this.db
      .query<StoredUser>("SELECT id, email, display_name AS displayName, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE id = ?")
      .get(id);
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
        .get(userId) ?? EMPTY_STATS
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
}
