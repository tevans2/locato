// Fills empty leaderboards with a handful of filler accounts posting deliberately slow times and
// low scores, so a new board isn't blank and any real player who finishes a run jumps above them.
//
// Self-contained (bun:sqlite only), so it can be shipped to a Fly machine and run there:
//
//   bun scripts/seed-filler.ts            # add / refresh the filler accounts and their results
//   bun scripts/seed-filler.ts --clean    # delete every filler account (cascades their results)
//   bun scripts/seed-filler.ts --dry-run  # print what would be written, change nothing
//
// Uses $DATABASE_PATH (default ./.data/locato.db). Filler accounts are on @filler.locato.invalid,
// have no password and no OAuth link, so nobody can sign in as them. Only those accounts are ever
// touched, and re-running is idempotent (each account keeps its id; results are rewritten).
import { Database } from "bun:sqlite";

const DOMAIN = "filler.locato.invalid";
const DAY_MS = 86_400_000;
const min = (m: number, s = 0) => (m * 60 + s) * 1000;
const MAX_TIME_MS = 7_200_000; // server/leaderboard/validation.ts

const PLAYERS = [
  { name: "jmarsh91", avatar: null },
  { name: "priya_k", avatar: "🌺" },
  { name: "tomwhitfield", avatar: null },
  { name: "LenaVogel", avatar: "🦊" },
  { name: "dkowalski", avatar: null },
  { name: "sofia_m22", avatar: "🌍" },
] as const;

// Fillers always rank below every real player: if a real result is already slower (or lower) than
// a filler's planned one, the filler is pushed past it.
const BEHIND_MARGIN = 1.08;

// Time boards: [mode, variant, slowest, fastest filler time]. All well behind a casual finisher.
const TIME_BOARDS: ReadonlyArray<readonly [string, string, number, number]> = [
  ["flags", "", min(22), min(12)],
  ["flags", "territories", min(9), min(5)],
  ["flags", "both", min(28), min(16)],
  ["flag-colors", "", min(30), min(18)],
  ["shapes", "", min(28), min(16)],
  ["codes", "", min(16), min(9)],
  ["capitals", "", min(22), min(12)],
  ["capital-recall", "", min(38), min(22)],
  ["name-all", "", min(75), min(50)],
  ["name-all", "Africa", min(22), min(13)],
  ["name-all", "Asia", min(20), min(12)],
  ["name-all", "Europe", min(18), min(10)],
  ["name-all", "North America", min(12), min(7)],
  ["name-all", "Oceania", min(6), min(3, 30)],
  ["name-all", "South America", min(5), min(3)],
  ["click-country", "", min(50), min(30)],
  ["spot-country", "", min(40), min(25)],
  ["puzzle", "Africa", min(24), min(15)],
  ["puzzle", "Asia", min(26), min(16)],
  ["puzzle", "Europe", min(20), min(12)],
  ["puzzle", "North America", min(12), min(7)],
  ["puzzle", "Oceania", min(6), min(3, 30)],
  ["puzzle", "South America", min(5), min(3)],
];

// Score boards: [mode, lowest, highest filler score]. Max scores live in src/core/leaderboards.ts.
const SCORE_BOARDS: ReadonlyArray<readonly [string, number, number]> = [
  ["map-tap", 6_000, 16_000], // max 50000
  ["worldsplit", 120, 240], // max 500
  ["geoguessr", 3_000, 8_000], // max 25000
  ["flyover", 3, 9], // max 167
  ["overland", 90, 200], // max 500
  ["mystery", 80, 190], // max 500
  ["streetview-country", 3, 7], // max 15
];

// Deterministic so re-runs produce the same board.
function rngFor(label: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < label.length; i += 1) state = Math.imul(state ^ label.charCodeAt(i), 16777619);
  state >>>= 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const args = process.argv.slice(2);
const clean = args.includes("--clean");
const dryRun = args.includes("--dry-run");
const databasePath = process.env.DATABASE_PATH ?? "./.data/locato.db";
const db = new Database(databasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

const now = Date.now();
const emailOf = (name: string) => `${name.toLowerCase()}@${DOMAIN}`;
const fillerIds = () => db.query<{ id: string }, [string]>("SELECT id FROM users WHERE email LIKE ?").all(`%@${DOMAIN}`).map((row) => row.id);

const run = db.transaction(() => {
  if (clean) {
    const ids = fillerIds();
    for (const id of ids) {
      for (const table of ["legacy_mode_best_times", "legacy_mode_best_scores", "legacy_daily_challenge_results"]) {
        try { db.query(`DELETE FROM ${table} WHERE user_id = ?`).run(id); } catch { /* table absent */ }
      }
      db.query("DELETE FROM users WHERE id = ?").run(id);
    }
    return { removed: ids.length, times: 0, scores: 0, skipped: [] as string[] };
  }

  let times = 0;
  let scores = 0;
  const skipped: string[] = [];
  PLAYERS.forEach((player, index) => {
    const email = emailOf(player.name);
    let user = db.query<{ id: string }, [string]>("SELECT id FROM users WHERE email = ?").get(email);
    if (!user) {
      const taken = db.query("SELECT 1 FROM users WHERE display_name = ? COLLATE NOCASE").get(player.name);
      if (taken) { skipped.push(player.name); return; }
      const id = crypto.randomUUID();
      const createdAt = now - (20 + index * 3) * DAY_MS;
      db.query("INSERT INTO users (id, email, display_name, password_hash, avatar_url, avatar_emoji, created_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)")
        .run(id, email, player.name, player.avatar, createdAt);
      user = { id };
    }
    const userId = user.id;
    for (const table of ["mode_best_times", "mode_best_scores", "leaderboard_attempts"]) db.query(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);

    // Each filler covers most boards; together every board ends up with 3–6 entries.
    for (const [mode, variant, slow, fast] of TIME_BOARDS) {
      const rng = rngFor(`${player.name}:${mode}:${variant}`);
      if (index >= 3 && rng() < 0.4) continue;
      const worstReal = db.query<{ ms: number | null }, [string, string, string]>(
        "SELECT MAX(best_time_ms) AS ms FROM mode_best_times WHERE game_mode = ? AND variant = ? AND user_id NOT IN (SELECT id FROM users WHERE email LIKE ?)",
      ).get(mode, variant, `%@${DOMAIN}`)?.ms ?? 0;
      const floor = Math.max(fast, Math.round(worstReal * BEHIND_MARGIN));
      const ceiling = Math.max(slow, Math.round(floor * (slow / fast)));
      const ms = Math.min(MAX_TIME_MS, Math.round(floor + (ceiling - floor) * rng()));
      // At the 2h cap a tie is possible; ties rank by date, so a later date keeps the filler behind.
      const at = ms >= MAX_TIME_MS ? now : now - Math.round((1 + rng() * 13) * DAY_MS);
      db.query("INSERT INTO mode_best_times (user_id, game_mode, variant, best_time_ms, achieved_at, verified) VALUES (?, ?, ?, ?, ?, 1)").run(userId, mode, variant, ms, at);
      db.query("INSERT INTO leaderboard_attempts (user_id, game_mode, variant, metric, value, achieved_at, verified) VALUES (?, ?, ?, 'time', ?, ?, 1)").run(userId, mode, variant, ms, at);
      times += 1;
    }
    for (const [mode, low, high] of SCORE_BOARDS) {
      const rng = rngFor(`${player.name}:${mode}`);
      if (index >= 3 && rng() < 0.4) continue;
      const lowestReal = db.query<{ score: number | null }, [string, string]>(
        "SELECT MIN(best_score) AS score FROM mode_best_scores WHERE game_mode = ? AND variant = '' AND user_id NOT IN (SELECT id FROM users WHERE email LIKE ?)",
      ).get(mode, `%@${DOMAIN}`)?.score;
      const cap = lowestReal === null || lowestReal === undefined ? high : Math.min(high, Math.floor((lowestReal - 1) / BEHIND_MARGIN));
      const bottom = Math.max(0, Math.min(low, Math.round(cap * (low / high))));
      const score = Math.max(0, Math.round(bottom + (Math.max(bottom, cap) - bottom) * rng()));
      // A real 0 can't be undercut; tie it with a later date so the filler still ranks below.
      const at = lowestReal !== null && lowestReal !== undefined && score >= lowestReal ? now : now - Math.round((1 + rng() * 13) * DAY_MS);
      db.query("INSERT INTO mode_best_scores (user_id, game_mode, variant, best_score, achieved_at, verified) VALUES (?, ?, '', ?, ?, 1)").run(userId, mode, score, at);
      db.query("INSERT INTO leaderboard_attempts (user_id, game_mode, variant, metric, value, achieved_at, verified) VALUES (?, ?, '', 'score', ?, ?, 1)").run(userId, mode, score, at);
      scores += 1;
    }
  });
  if (dryRun) throw new DryRun({ removed: 0, times, scores, skipped });
  return { removed: 0, times, scores, skipped };
});

class DryRun extends Error {
  constructor(readonly summary: { removed: number; times: number; scores: number; skipped: string[] }) { super("dry run"); }
}

let summary;
try {
  summary = run();
} catch (error) {
  if (!(error instanceof DryRun)) throw error;
  summary = error.summary;
  console.log("(dry run: rolled back)");
}
console.log(`${databasePath}: ${clean ? `removed ${summary.removed} filler accounts` : `${PLAYERS.length - summary.skipped.length} filler accounts, ${summary.times} times, ${summary.scores} scores`}${summary.skipped.length ? `; skipped (username taken): ${summary.skipped.join(", ")}` : ""}`);
console.log(`filler accounts now: ${fillerIds().length}`);
