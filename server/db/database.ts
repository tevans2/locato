// This module imports bun:sqlite — never import from Node/vitest test graph.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { CategoryStats, CreateSessionInput, CreateUserInput, FullStats, GameRecord, GameResult, Session, StoredUser, UserStats, UserStore } from "../auth/types";

const EMPTY_STATS: UserStats = { totalGames: 0, totalCorrect: 0, totalWrong: 0, bestStreak: 0, soloGames: 0, soloCorrect: 0, soloWrong: 0, soloBestStreak: 0, multiplayerGames: 0, multiplayerWins: 0, multiplayerCorrect: 0, multiplayerWrong: 0, multiplayerBestStreak: 0, worldMapGames: 0, worldMapCompletions: 0, worldBestTimeMs: 0, worldBestCountries: 0 };

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
      total_games INTEGER NOT NULL DEFAULT 0,
      total_correct INTEGER NOT NULL DEFAULT 0,
      total_wrong INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      solo_games INTEGER NOT NULL DEFAULT 0,
      solo_correct INTEGER NOT NULL DEFAULT 0,
      solo_wrong INTEGER NOT NULL DEFAULT 0,
      solo_best_streak INTEGER NOT NULL DEFAULT 0,
      multiplayer_games INTEGER NOT NULL DEFAULT 0,
      multiplayer_wins INTEGER NOT NULL DEFAULT 0,
      multiplayer_correct INTEGER NOT NULL DEFAULT 0,
      multiplayer_wrong INTEGER NOT NULL DEFAULT 0,
      multiplayer_best_streak INTEGER NOT NULL DEFAULT 0,
      world_map_games INTEGER NOT NULL DEFAULT 0,
      world_map_completions INTEGER NOT NULL DEFAULT 0,
      world_best_time_ms INTEGER NOT NULL DEFAULT 0,
      world_best_countries INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS category_stats (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL,
      correct INTEGER NOT NULL DEFAULT 0,
      wrong INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS game_records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      category_ids TEXT NOT NULL,
      correct_answers INTEGER NOT NULL DEFAULT 0,
      wrong_answers INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      rank INTEGER,
      total_players INTEGER,
      played_at INTEGER NOT NULL,
      duration_ms INTEGER,
      completed INTEGER,
      countries_found INTEGER,
      countries_total INTEGER,
      play_mode TEXT
    );
    CREATE INDEX IF NOT EXISTS game_records_user_played ON game_records(user_id, played_at DESC);
  `);

  // Additive migrations: columns added after initial schema deployment.
  const addIfMissing = (sql: string) => { try { db.exec(sql); } catch { /* already exists */ } };
  addIfMissing("ALTER TABLE users ADD COLUMN avatar_emoji TEXT DEFAULT NULL;");
  // Expand user_stats from old 4-column schema to full split schema.
  for (const col of ["total_games", "total_correct", "total_wrong", "solo_games", "solo_correct", "solo_wrong", "solo_best_streak", "multiplayer_games", "multiplayer_wins", "multiplayer_correct", "multiplayer_wrong", "multiplayer_best_streak", "world_map_games", "world_map_completions", "world_best_time_ms", "world_best_countries"]) {
    addIfMissing(`ALTER TABLE user_stats ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0;`);
  }
  // World-map per-game columns added to game_records after initial deployment.
  addIfMissing("ALTER TABLE game_records ADD COLUMN duration_ms INTEGER;");
  addIfMissing("ALTER TABLE game_records ADD COLUMN completed INTEGER;");
  addIfMissing("ALTER TABLE game_records ADD COLUMN countries_found INTEGER;");
  addIfMissing("ALTER TABLE game_records ADD COLUMN countries_total INTEGER;");
  addIfMissing("ALTER TABLE game_records ADD COLUMN play_mode TEXT;");
  // Rename old games/correct_answers/wrong_answers/best_streak → total_* where they diverge.
  // Old schema used: games, correct_answers, wrong_answers, best_streak.
  // If the old 'games' column exists, copy it to total_games then we can just read total_games.
  try {
    db.exec("UPDATE user_stats SET total_games = games, total_correct = correct_answers, total_wrong = wrong_answers, best_streak = MAX(best_streak, best_streak) WHERE total_games = 0 AND games > 0;");
  } catch { /* columns don't exist — fresh install, nothing to migrate */ }
}

const USER_SELECT = "SELECT id, email, display_name AS displayName, password_hash AS passwordHash, avatar_url AS avatarUrl, avatar_emoji AS avatarEmoji, created_at AS createdAt FROM users";
const STATS_SELECT = `SELECT
  COALESCE(total_games, 0) AS totalGames,
  COALESCE(total_correct, 0) AS totalCorrect,
  COALESCE(total_wrong, 0) AS totalWrong,
  COALESCE(best_streak, 0) AS bestStreak,
  COALESCE(solo_games, 0) AS soloGames,
  COALESCE(solo_correct, 0) AS soloCorrect,
  COALESCE(solo_wrong, 0) AS soloWrong,
  COALESCE(solo_best_streak, 0) AS soloBestStreak,
  COALESCE(multiplayer_games, 0) AS multiplayerGames,
  COALESCE(multiplayer_wins, 0) AS multiplayerWins,
  COALESCE(multiplayer_correct, 0) AS multiplayerCorrect,
  COALESCE(multiplayer_wrong, 0) AS multiplayerWrong,
  COALESCE(multiplayer_best_streak, 0) AS multiplayerBestStreak,
  COALESCE(world_map_games, 0) AS worldMapGames,
  COALESCE(world_map_completions, 0) AS worldMapCompletions,
  COALESCE(world_best_time_ms, 0) AS worldBestTimeMs,
  COALESCE(world_best_countries, 0) AS worldBestCountries
FROM user_stats WHERE user_id = ?`;

export class SqliteUserStore implements UserStore {
  constructor(private readonly db: Database) {}

  createUser(input: CreateUserInput): StoredUser {
    this.db.query("INSERT INTO users (id, email, display_name, password_hash, avatar_url, avatar_emoji, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)").run(input.id, input.email, input.displayName, input.passwordHash, input.avatarUrl, input.createdAt);
    return { id: input.id, email: input.email, displayName: input.displayName, passwordHash: input.passwordHash, avatarUrl: input.avatarUrl, avatarEmoji: null, createdAt: input.createdAt };
  }

  findUserByEmail(email: string): StoredUser | null {
    return this.db.query<StoredUser>(`${USER_SELECT} WHERE email = ?`).get(email);
  }

  findUserById(id: string): StoredUser | null {
    return this.db.query<StoredUser>(`${USER_SELECT} WHERE id = ?`).get(id);
  }

  findUserByOAuth(provider: string, providerId: string): StoredUser | null {
    return this.db.query<StoredUser>(`
      SELECT u.id, u.email, u.display_name AS displayName, u.password_hash AS passwordHash,
             u.avatar_url AS avatarUrl, u.avatar_emoji AS avatarEmoji, u.created_at AS createdAt
      FROM users u
      JOIN oauth_accounts oa ON oa.user_id = u.id
      WHERE oa.provider = ? AND oa.provider_id = ?
    `).get(provider, providerId);
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
    return this.db.query<UserStats>(STATS_SELECT).get(userId) ?? EMPTY_STATS;
  }

  getFullStats(userId: string): FullStats {
    const stats = this.getStats(userId);
    const categories = this.db.query<CategoryStats>("SELECT category_id AS categoryId, correct, wrong FROM category_stats WHERE user_id = ? ORDER BY correct DESC").all(userId);
    const recentGames = this.db.query<{ id: string; mode: string; category_ids: string; correct_answers: number; wrong_answers: number; score: number; best_streak: number; rank: number | null; total_players: number | null; played_at: number; duration_ms: number | null; completed: number | null; countries_found: number | null; countries_total: number | null; play_mode: string | null }>(
      "SELECT id, mode, category_ids, correct_answers, wrong_answers, score, best_streak, rank, total_players, played_at, duration_ms, completed, countries_found, countries_total, play_mode FROM game_records WHERE user_id = ? ORDER BY played_at DESC LIMIT 20"
    ).all(userId).map(r => ({
      id: r.id,
      mode: r.mode as "solo" | "multiplayer" | "world-map",
      categoryIds: JSON.parse(r.category_ids) as string[],
      correctAnswers: r.correct_answers,
      wrongAnswers: r.wrong_answers,
      score: r.score,
      bestStreak: r.best_streak,
      rank: r.rank,
      totalPlayers: r.total_players,
      playedAt: r.played_at,
      durationMs: r.duration_ms,
      completed: r.completed === null ? null : r.completed === 1,
      countriesFound: r.countries_found,
      countriesTotal: r.countries_total,
      playMode: r.play_mode,
    }));
    return { ...stats, categories, recentGames };
  }

  recordGame(userId: string, result: GameResult, now: number): UserStats {
    const id = crypto.randomUUID();
    const isSolo = result.mode === "solo";
    const isMp = result.mode === "multiplayer";
    const isWorld = result.mode === "world-map";
    const isMpWin = isMp && result.rank === 1;
    const completed = isWorld ? (result.completed ? 1 : 0) : null;
    const durationMs = isWorld ? (result.durationMs ?? 0) : null;
    const countriesFound = isWorld ? (result.countriesFound ?? 0) : null;
    const countriesTotal = isWorld ? (result.countriesTotal ?? 0) : null;
    const playMode = isWorld ? (result.playMode ?? null) : null;

    this.db.query("INSERT INTO game_records (id, user_id, mode, category_ids, correct_answers, wrong_answers, score, best_streak, rank, total_players, played_at, duration_ms, completed, countries_found, countries_total, play_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, result.mode, JSON.stringify(result.categoryIds), result.correctAnswers, result.wrongAnswers, result.score, result.bestStreak, result.rank ?? null, result.totalPlayers ?? null, now, durationMs, completed, countriesFound, countriesTotal, playMode);

    // Per-category stats only apply to prompt-based modes (solo/multiplayer).
    if (!isWorld) {
      for (const catId of result.categoryIds) {
        this.db.query("INSERT INTO category_stats (user_id, category_id, correct, wrong) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, category_id) DO UPDATE SET correct = correct + excluded.correct, wrong = wrong + excluded.wrong").run(userId, catId, result.correctAnswers, result.wrongAnswers);
      }
    }

    // World-map aggregates: best time + best countries are full-world metrics, so puzzle
    // continents are excluded from both (but still counted as games/completions and logged).
    const worldGames = isWorld ? 1 : 0;
    const worldCompletions = isWorld && result.completed ? 1 : 0;
    const worldTime = isWorld && result.completed && result.playMode !== "puzzle" && (result.durationMs ?? 0) > 0 ? (result.durationMs ?? 0) : 0;
    const worldCountries = isWorld && result.playMode !== "puzzle" ? (result.countriesFound ?? 0) : 0;

    this.db.query(`
      INSERT INTO user_stats (user_id, total_games, total_correct, total_wrong, best_streak,
        solo_games, solo_correct, solo_wrong, solo_best_streak,
        multiplayer_games, multiplayer_wins, multiplayer_correct, multiplayer_wrong, multiplayer_best_streak,
        world_map_games, world_map_completions, world_best_time_ms, world_best_countries)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        total_games = total_games + 1,
        total_correct = total_correct + excluded.total_correct,
        total_wrong = total_wrong + excluded.total_wrong,
        best_streak = MAX(best_streak, excluded.best_streak),
        solo_games = solo_games + excluded.solo_games,
        solo_correct = solo_correct + excluded.solo_correct,
        solo_wrong = solo_wrong + excluded.solo_wrong,
        solo_best_streak = MAX(solo_best_streak, excluded.solo_best_streak),
        multiplayer_games = multiplayer_games + excluded.multiplayer_games,
        multiplayer_wins = multiplayer_wins + excluded.multiplayer_wins,
        multiplayer_correct = multiplayer_correct + excluded.multiplayer_correct,
        multiplayer_wrong = multiplayer_wrong + excluded.multiplayer_wrong,
        multiplayer_best_streak = MAX(multiplayer_best_streak, excluded.multiplayer_best_streak),
        world_map_games = world_map_games + excluded.world_map_games,
        world_map_completions = world_map_completions + excluded.world_map_completions,
        world_best_time_ms = CASE
          WHEN excluded.world_best_time_ms = 0 THEN world_best_time_ms
          WHEN world_best_time_ms = 0 THEN excluded.world_best_time_ms
          ELSE MIN(world_best_time_ms, excluded.world_best_time_ms) END,
        world_best_countries = MAX(world_best_countries, excluded.world_best_countries)
    `).run(
      userId,
      result.correctAnswers, result.wrongAnswers, result.bestStreak,
      isSolo ? 1 : 0, isSolo ? result.correctAnswers : 0, isSolo ? result.wrongAnswers : 0, isSolo ? result.bestStreak : 0,
      isMp ? 1 : 0, isMpWin ? 1 : 0, isMp ? result.correctAnswers : 0, isMp ? result.wrongAnswers : 0, isMp ? result.bestStreak : 0,
      worldGames, worldCompletions, worldTime, worldCountries,
    );

    return this.getStats(userId);
  }
}
