import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { openDatabase, SqliteUserStore } from "../server/db/database";
import { AdminService } from "../server/admin/AdminService";
import type { UserStore } from "../server/auth/types";

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const MIN = 60_000;

function withStores(run: (store: UserStore, label: string) => void): void {
  run(createMemoryUserStore(), "memory");
  const dir = mkdtempSync(join(tmpdir(), "locato-revert-"));
  try {
    run(new SqliteUserStore(openDatabase(join(dir, "locato.db"))), "sqlite");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function player(store: UserStore, id: string): string {
  store.createUser({ id, email: `${id}@b.com`, displayName: id, passwordHash: null, avatarUrl: null, createdAt: NOW });
  return id;
}

const scores = (store: UserStore, mode = "flyover") => store.getScoreLeaderboard({ gameMode: mode, variant: "", limit: 10, offset: 0 }).map((e) => [e.userId, e.score]);
const times = (store: UserStore) => store.getLeaderboard({ gameMode: "flags", variant: "", limit: 10, offset: 0 }).map((e) => [e.userId, e.timeMs]);

describe("removing a fake leaderboard best", () => {
  it("falls back to the player's previous score, then drops them when nothing's left", () => withStores((store) => {
    const admin = new AdminService(store, { clock: () => NOW });
    const cheat = player(store, "cheat");
    const honest = player(store, "honest");
    store.submitBestScore(cheat, { gameMode: "flyover", variant: "", score: 40, achievedAt: NOW - 3 * MIN });
    store.submitBestScore(cheat, { gameMode: "flyover", variant: "", score: 30, achievedAt: NOW - 2 * MIN }); // not a best, still history
    store.submitBestScore(cheat, { gameMode: "flyover", variant: "", score: 196, achievedAt: NOW - MIN, verified: false });
    store.submitBestScore(honest, { gameMode: "flyover", variant: "", score: 55, achievedAt: NOW });
    expect(scores(store)).toEqual([["cheat", 196], ["honest", 55]]);

    expect(admin.removeBoardEntry(cheat, "flyover", "")).toEqual({ removed: 196, revertedTo: { value: 40, achievedAt: NOW - 3 * MIN } });
    expect(scores(store)).toEqual([["honest", 55], ["cheat", 40]]);
    expect(admin.removeBoardEntry(cheat, "flyover", "")).toEqual({ removed: 40, revertedTo: { value: 30, achievedAt: NOW - 2 * MIN } });
    expect(admin.removeBoardEntry(cheat, "flyover", "")).toEqual({ removed: 30, revertedTo: null });
    expect(scores(store)).toEqual([["honest", 55]]);
    expect(admin.removeBoardEntry(cheat, "flyover", "")).toBeNull();
  }));

  it("removes the same fake posted twice in one go, and later real bests still count", () => withStores((store) => {
    const admin = new AdminService(store, { clock: () => NOW });
    const cheat = player(store, "cheat");
    store.submitBestScore(cheat, { gameMode: "flyover", variant: "", score: 40, achievedAt: NOW - 3 * MIN });
    store.submitBestScore(cheat, { gameMode: "flyover", variant: "", score: 196, achievedAt: NOW - 2 * MIN });
    store.submitBestScore(cheat, { gameMode: "flyover", variant: "", score: 196, achievedAt: NOW - MIN });
    expect(admin.removeBoardEntry(cheat, "flyover", "")?.revertedTo?.value).toBe(40);
    store.submitBestScore(cheat, { gameMode: "flyover", variant: "", score: 60, achievedAt: NOW });
    expect(scores(store)).toEqual([["cheat", 60]]);
  }));

  it("falls back to the previous time on a time board", () => withStores((store) => {
    const admin = new AdminService(store, { clock: () => NOW });
    const cheat = player(store, "cheat");
    store.submitBestTime(cheat, { gameMode: "flags", variant: "", timeMs: 4 * MIN, achievedAt: NOW - 2 * MIN });
    store.submitBestTime(cheat, { gameMode: "flags", variant: "", timeMs: 9_000, achievedAt: NOW - MIN });
    expect(times(store)).toEqual([["cheat", 9_000]]);
    expect(admin.removeBoardEntry(cheat, "flags", "")?.revertedTo).toEqual({ value: 4 * MIN, achievedAt: NOW - 2 * MIN });
    expect(times(store)).toEqual([["cheat", 4 * MIN]]);
  }));
});

describe("attempt history backfill", () => {
  it("recovers an older best from the pre-verification snapshot for results posted before history existed", () => {
    const dir = mkdtempSync(join(tmpdir(), "locato-backfill-"));
    const path = join(dir, "locato.db");
    try {
      const first = openDatabase(path);
      first.exec(`INSERT INTO users (id, email, display_name, created_at) VALUES ('cheat', 'cheat@b.com', 'cheat', ${NOW});
        INSERT INTO legacy_mode_best_scores (user_id, game_mode, variant, best_score, achieved_at, verified) VALUES ('cheat', 'flyover', '', 40, ${NOW - 9 * MIN}, 0);
        INSERT INTO mode_best_scores (user_id, game_mode, variant, best_score, achieved_at, verified) VALUES ('cheat', 'flyover', '', 196, ${NOW - MIN}, 0);
        DELETE FROM leaderboard_attempts;
        DELETE FROM schema_migrations WHERE id = 'leaderboard_attempts_v1';`);
      first.close();

      const store = new SqliteUserStore(openDatabase(path)); // runs the backfill
      const admin = new AdminService(store, { clock: () => NOW });
      expect(admin.removeBoardEntry("cheat", "flyover", "")).toEqual({ removed: 196, revertedTo: { value: 40, achievedAt: NOW - 9 * MIN } });

      // Runs once: a restart doesn't re-add the struck-off 196.
      const again = new SqliteUserStore(openDatabase(path));
      expect(scores(again)).toEqual([["cheat", 40]]);
      expect(new AdminService(again, { clock: () => NOW }).removeBoardEntry("cheat", "flyover", "")?.revertedTo).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
