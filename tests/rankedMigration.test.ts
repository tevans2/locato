import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openDatabase, SqliteUserStore } from "../server/db/database";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

it("quarantines old scores and times, preserves review snapshots, and accepts slower verified replacements", () => {
  const directory = mkdtempSync(join(tmpdir(), "locato-ranked-")); directories.push(directory);
  const path = join(directory, "test.db");
  // An original deployed schema, before there was any verification column.
  let db = new Database(path);
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT, avatar_url TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE mode_best_times (user_id TEXT, game_mode TEXT, variant TEXT, best_time_ms INTEGER, achieved_at INTEGER, PRIMARY KEY(user_id,game_mode,variant));
    CREATE TABLE mode_best_scores (user_id TEXT, game_mode TEXT, variant TEXT, best_score INTEGER, achieved_at INTEGER, PRIMARY KEY(user_id,game_mode,variant));
    CREATE TABLE daily_challenge_results (user_id TEXT, date TEXT, seed TEXT, score INTEGER, time_ms INTEGER, hints_used INTEGER, marks TEXT, share_text TEXT, completed_at INTEGER, PRIMARY KEY(user_id,date));
    INSERT INTO users VALUES ('old', 'old@test.local', 'OldPlayer', NULL, NULL, 1);
    INSERT INTO mode_best_scores VALUES ('old', 'flyover', '', 196, 1);
    INSERT INTO mode_best_times VALUES ('old', 'flags', '', 5000, 1);
    INSERT INTO daily_challenge_results VALUES ('old', '2026-10-04', 'daily:2026-10-04', 100, 1000, 0, '[]', '', 1);`);
  db.close();
  db = openDatabase(path);
  const store = new SqliteUserStore(db);
  expect(store.getScoreLeaderboard({ gameMode: "flyover", variant: "", limit: 10, offset: 0 })).toEqual([]);
  expect(store.getLeaderboard({ gameMode: "flags", variant: "", limit: 10, offset: 0 })).toEqual([]);
  expect(store.getUserScoreRank("old", "flyover", "")).toBeNull();
  expect(store.getUserRank("old", "flags", "")).toBeNull();
  expect(store.getScorePlacement("flyover", "", 1)).toEqual({ rank: 1, total: 0 });
  expect(store.getTimePlacement("flags", "", 9000)).toEqual({ rank: 1, total: 0 });
  expect(store.getDailyResult("old", "2026-10-04")).toBeNull();
  expect(store.listDailyResultsForDate("2026-10-04")).toEqual([]);
  expect(db.query<{ n: number }>("SELECT COUNT(*) AS n FROM legacy_mode_best_scores").get()?.n).toBe(1);
  expect(store.submitBestScore("old", { gameMode: "flyover", variant: "", score: 43, achievedAt: 10 })).toMatchObject({ accepted: true });
  expect(store.submitBestTime("old", { gameMode: "flags", variant: "", timeMs: 300_000, achievedAt: 11 })).toMatchObject({ accepted: true });
  store.saveDailyResult("old", { date: "2026-10-04", seed: "verified-daily:2026-10-04", score: 80, timeMs: 100_000, hintsUsed: 0, marks: [], shareText: "server", completedAt: 12 });
  expect(store.getUserScoreRank("old", "flyover", "")).toEqual({ rank: 1, score: 43 });
  expect(store.getUserRank("old", "flags", "")).toEqual({ rank: 1, timeMs: 300_000 });
  expect(store.getDailyResult("old", "2026-10-04")?.score).toBe(80);
  db.close();
  db = openDatabase(path); // Idempotent migration must neither hide new results nor lose archived evidence.
  expect(new SqliteUserStore(db).getUserScoreRank("old", "flyover", "")?.score).toBe(43);
  expect(db.query<{ score: number }>("SELECT best_score AS score FROM legacy_mode_best_scores").get()?.score).toBe(196);
  db.close();
});
