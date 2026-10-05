import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openDatabase, SqliteUserStore } from "../server/db/database";
import { AuthService } from "../server/auth/AuthService";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function originalDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "locato-ranked-")); directories.push(directory);
  const path = join(directory, "test.db");
  const db = new Database(path);
  db.exec([
    "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT, avatar_url TEXT, created_at INTEGER NOT NULL);",
    "CREATE TABLE mode_best_times (user_id TEXT, game_mode TEXT, variant TEXT, best_time_ms INTEGER, achieved_at INTEGER, PRIMARY KEY(user_id,game_mode,variant));",
    "CREATE TABLE mode_best_scores (user_id TEXT, game_mode TEXT, variant TEXT, best_score INTEGER, achieved_at INTEGER, PRIMARY KEY(user_id,game_mode,variant));",
    "CREATE TABLE daily_challenge_results (user_id TEXT, date TEXT, seed TEXT, score INTEGER, time_ms INTEGER, hints_used INTEGER, marks TEXT, share_text TEXT, completed_at INTEGER, PRIMARY KEY(user_id,date));",
    "INSERT INTO users VALUES ('old', 'old@test.local', 'OldPlayer', NULL, NULL, 1);",
    "INSERT INTO mode_best_scores VALUES ('old', 'flyover', '', 196, 1);",
    "INSERT INTO mode_best_times VALUES ('old', 'flags', '', 5000, 1);",
    "INSERT INTO daily_challenge_results VALUES ('old', '2026-10-04', 'daily:2026-10-04', 100, 1000, 0, '[]', 'original daily', 1);",
  ].join("\n"));
  db.close();
  return path;
}

it("keeps historical leaderboards, personal ranks and daily history visible without marking them verified", () => {
  const db = openDatabase(originalDatabase());
  const store = new SqliteUserStore(db);
  expect(store.getScoreLeaderboard({ gameMode: "flyover", variant: "", limit: 10, offset: 0 })).toMatchObject([{ userId: "old", score: 196, achievedAt: 1 }]);
  expect(store.getLeaderboard({ gameMode: "flags", variant: "", limit: 10, offset: 0 })).toMatchObject([{ userId: "old", timeMs: 5000, achievedAt: 1 }]);
  expect(store.getUserScoreRank("old", "flyover", "")).toEqual({ rank: 1, score: 196 });
  expect(store.getUserRank("old", "flags", "")).toEqual({ rank: 1, timeMs: 5000 });
  expect(store.getScorePlacement("flyover", "", 43)).toEqual({ rank: 2, total: 1 });
  expect(store.getTimePlacement("flags", "", 9000)).toEqual({ rank: 2, total: 1 });
  expect(store.getDailyResult("old", "2026-10-04")).toMatchObject({ score: 100, completedAt: 1 });
  expect(store.listDailyResults("old", 10)).toHaveLength(1);
  expect(store.listDailyResultsForDate("2026-10-04")).toHaveLength(1);
  expect(store.listDailyResultsForUsers(["old"], "2026-10-04")).toHaveLength(1);
  for (const table of ["mode_best_scores", "mode_best_times", "daily_challenge_results"]) {
    expect(db.query<{ verified: number }>("SELECT verified FROM " + table).get()?.verified).toBe(0);
  }
  db.close();
});

it("recovers bests and original dailies replaced by the prior patch, including missing historical rows", () => {
  const path = originalDatabase();
  let db = openDatabase(path);
  // Model an already deployed quarantine database, before the repair marker existed.
  db.exec("DELETE FROM schema_migrations; UPDATE mode_best_scores SET best_score = 43, achieved_at = 10, verified = 1; UPDATE mode_best_times SET best_time_ms = 300000, achieved_at = 11, verified = 1; UPDATE daily_challenge_results SET score = 80, completed_at = 12, verified = 1; INSERT INTO legacy_mode_best_scores VALUES ('old', 'worldsplit', '', 350, 2, 0);");
  db.close();
  db = openDatabase(path);
  const store = new SqliteUserStore(db);
  expect(store.getScoreLeaderboard({ gameMode: "flyover", variant: "", limit: 10, offset: 0 })).toMatchObject([{ score: 196, achievedAt: 1 }]);
  expect(store.getUserRank("old", "flags", "")).toEqual({ rank: 1, timeMs: 5000 });
  expect(store.getUserScoreRank("old", "worldsplit", "")).toEqual({ rank: 1, score: 350 });
  expect(store.getDailyResult("old", "2026-10-04")).toMatchObject({ score: 100, completedAt: 1, shareText: "original daily" });
  expect(db.query<{ verified: number }>("SELECT verified FROM mode_best_scores WHERE game_mode = 'flyover'").get()?.verified).toBe(0);
  expect(db.query<{ n: number }>("SELECT COUNT(*) AS n FROM legacy_mode_best_scores").get()?.n).toBe(2);
  db.close();
});

it("preserves stronger verified results and the original timestamp for equal historical bests", () => {
  const path = originalDatabase();
  let db = openDatabase(path);
  db.exec("DELETE FROM schema_migrations; UPDATE mode_best_scores SET best_score = 196, achieved_at = 10, verified = 1; UPDATE mode_best_times SET best_time_ms = 4000, achieved_at = 11, verified = 1; INSERT INTO legacy_mode_best_scores VALUES ('old', 'worldsplit', '', 350, 2, 0); INSERT INTO mode_best_scores VALUES ('old', 'worldsplit', '', 400, 12, 1);");
  db.close();
  db = openDatabase(path);
  expect(db.query("SELECT best_score, achieved_at, verified FROM mode_best_scores WHERE game_mode = 'flyover'").get()).toEqual({ best_score: 196, achieved_at: 1, verified: 0 });
  expect(db.query("SELECT best_score, achieved_at, verified FROM mode_best_scores WHERE game_mode = 'worldsplit'").get()).toEqual({ best_score: 400, achieved_at: 12, verified: 1 });
  expect(db.query("SELECT best_time_ms, achieved_at, verified FROM mode_best_times").get()).toEqual({ best_time_ms: 4000, achieved_at: 11, verified: 1 });
  db.close();
});

it("only replaces historical bests with improvements and keeps completed dailies immutable", () => {
  const db = openDatabase(originalDatabase());
  const store = new SqliteUserStore(db);
  expect(store.submitBestScore("old", { gameMode: "flyover", variant: "", score: 43, achievedAt: 10 })).toEqual({ accepted: false, isPersonalBest: false });
  expect(store.submitBestTime("old", { gameMode: "flags", variant: "", timeMs: 300000, achievedAt: 11 })).toEqual({ accepted: false, isPersonalBest: false });
  expect(store.submitBestTime("old", { gameMode: "flags", variant: "", timeMs: 5000, achievedAt: 11 })).toEqual({ accepted: false, isPersonalBest: false });
  expect(store.getUserScoreRank("old", "flyover", "")?.score).toBe(196);
  expect(store.getLeaderboard({ gameMode: "flags", variant: "", limit: 10, offset: 0 })[0]?.achievedAt).toBe(1);
  expect(store.submitBestTime("old", { gameMode: "flags", variant: "", timeMs: 4000, achievedAt: 12 })).toEqual({ accepted: true, isPersonalBest: true });
  expect(db.query<{ verified: number }>("SELECT verified FROM mode_best_times").get()?.verified).toBe(1);
  expect(store.saveDailyResult("old", { date: "2026-10-04", seed: "verified-daily:2026-10-04", score: 80, timeMs: 100000, hintsUsed: 0, marks: [], shareText: "server", completedAt: 12 })).toMatchObject({ score: 100, completedAt: 1 });
  db.close();
});

it("does not restore deleted users or reapply archives over later administrator corrections", () => {
  const path = originalDatabase();
  let db = openDatabase(path);
  db.exec("DELETE FROM schema_migrations; INSERT INTO legacy_mode_best_scores VALUES ('deleted-user', 'flyover', '', 100, 2, 0);");
  db.close();
  db = openDatabase(path);
  expect(db.query("SELECT user_id FROM mode_best_scores WHERE user_id = 'deleted-user'").get()).toBeNull();
  db.exec("UPDATE mode_best_scores SET best_score = 43, achieved_at = 20;");
  db.close();
  db = openDatabase(path);
  expect(new SqliteUserStore(db).getUserScoreRank("old", "flyover", "")?.score).toBe(43);
  expect(db.query<{ score: number }>("SELECT best_score AS score FROM legacy_mode_best_scores WHERE user_id = 'old'").get()?.score).toBe(196);
  expect(db.query<{ n: number }>("SELECT COUNT(*) AS n FROM schema_migrations WHERE id = 'restore_historical_results_v1'").get()?.n).toBe(1);
  db.close();
});

it("does not let historical display authorize fabricated new leaderboard submissions", () => {
  const db = openDatabase(originalDatabase());
  const store = new SqliteUserStore(db);
  const service = new AuthService(store, { hash: async (p) => p, verify: async (p, h) => p === h }, { clock: () => 100000, sessionTtlMs: 3600000 });
  expect(service.submitLeaderboardAttempt("old", { gameMode: "flyover", variant: "", score: 196 })).toHaveProperty("error");
  expect(service.submitLeaderboardAttempt("old", { gameMode: "flags", variant: "", timeMs: 4000, runId: "invented" })).toHaveProperty("error");
  expect(store.getUserRank("old", "flags", "")?.timeMs).toBe(5000);
  expect(store.getUserScoreRank("old", "flyover", "")?.score).toBe(196);
  db.close();
});

it("ranks and paginates historical and verified entries together while keeping variants separate", () => {
  const db = openDatabase(originalDatabase());
  db.exec("INSERT INTO users (id,email,display_name,created_at) VALUES ('new','new@test.local','NewPlayer',2); INSERT INTO mode_best_scores VALUES ('new','flyover','',43,10,1); INSERT INTO mode_best_times VALUES ('new','flags','',10000,10,1); INSERT INTO mode_best_times VALUES ('old','flags','territories',55000,2,0);");
  const store = new SqliteUserStore(db);
  expect(store.getScoreLeaderboard({ gameMode: "flyover", variant: "", limit: 1, offset: 1 })).toMatchObject([{ userId: "new", rank: 2, score: 43 }]);
  expect(store.getLeaderboard({ gameMode: "flags", variant: "", limit: 1, offset: 1 })).toMatchObject([{ userId: "new", rank: 2, timeMs: 10000 }]);
  expect(store.getUserRank("new", "flags", "")).toEqual({ rank: 2, timeMs: 10000 });
  expect(store.getUserScoreRank("new", "flyover", "")).toEqual({ rank: 2, score: 43 });
  expect(store.getTimePlacement("flags", "", 20000)).toEqual({ rank: 3, total: 2 });
  expect(store.getScorePlacement("flyover", "", 1)).toEqual({ rank: 3, total: 2 });
  expect(store.getLeaderboard({ gameMode: "flags", variant: "territories", limit: 10, offset: 0 })).toMatchObject([{ userId: "old", rank: 1, timeMs: 55000 }]);
  db.close();
});

it("stores local Flyover improvements as client-reported while preserving existing bests and other-mode provenance", () => {
  const db = openDatabase(originalDatabase());
  db.exec("INSERT INTO users (id,email,display_name,created_at) VALUES ('local','local@test.local','LocalPlayer',2);");
  const store = new SqliteUserStore(db);
  const service = new AuthService(store, { hash: async (p) => p, verify: async (p, h) => p === h }, { clock: () => 100000, sessionTtlMs: 3600000 });
  expect(service.submitLeaderboardAttempt("local", { gameMode: "flyover", variant: "", score: 43 })).toMatchObject({ accepted: true });
  expect(service.submitLeaderboardAttempt("local", { gameMode: "flyover", variant: "", score: 60 })).toMatchObject({ accepted: true });
  expect(db.query("SELECT best_score, verified FROM mode_best_scores WHERE user_id = 'local'").get()).toEqual({ best_score: 60, verified: 0 });
  expect(service.submitLeaderboardAttempt("old", { gameMode: "flyover", variant: "", score: 60 })).toMatchObject({ accepted: false });
  expect(store.getUserScoreRank("old", "flyover", "")?.score).toBe(196);
  store.submitBestScore("local", { gameMode: "worldsplit", variant: "", score: 100, achievedAt: 100001 });
  expect(db.query("SELECT verified FROM mode_best_scores WHERE game_mode = 'worldsplit'").get()).toEqual({ verified: 1 });
  db.close();
});

it("marks restored local Daily scores unverified without changing earlier results or server receipt provenance", () => {
  const db = openDatabase(originalDatabase());
  const store = new SqliteUserStore(db);
  const service = new AuthService(store, { hash: async (p) => p, verify: async (p, h) => p === h }, { sessionTtlMs: 3600000 });
  const local = { date: "2026-10-05", seed: "daily:2026-10-05", score: 80, timeMs: 120000, hintsUsed: 0, marks: [] as const, shareText: "local daily", completedAt: 10 };
  expect(service.saveDailyResult("old", local)).toEqual(local);
  expect(db.query("SELECT score, verified FROM daily_challenge_results WHERE date = '2026-10-05'").get()).toEqual({ score: 80, verified: 0 });
  expect(service.saveDailyResult("old", { ...local, score: 100, completedAt: 20 })).toEqual(local);
  expect(service.saveDailyResult("old", { ...local, date: "2026-10-04", seed: "daily:2026-10-04" })).toMatchObject({ score: 100, completedAt: 1 });
  store.saveDailyResult("old", { ...local, date: "2026-10-06", seed: "verified-daily:2026-10-06" });
  expect(db.query("SELECT verified FROM daily_challenge_results WHERE date = '2026-10-06'").get()).toEqual({ verified: 1 });
  db.close();
});
