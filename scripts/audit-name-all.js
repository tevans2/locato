// Read-only check of Name all countries times.
//   bun audit-name-all.js                       audit every entry on the board
//   bun audit-name-all.js "<name or email>"     one player in detail
// Optional second argument: the database path (default /data/locato.db, the Fly volume).
const { Database } = require("bun:sqlite");
const db = new Database(process.argv[3] ?? "/data/locato.db", { readonly: true });
const who = process.argv[2];
const at = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
const clock = (ms) => (ms == null ? "-" : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`);

// A real timed run that sets a best saves a finished game record (with its time) within moments
// of the board entry. Look for one within 2 minutes and 1 second of the board time.
function matchingRun(userId, timeMs, achievedAt) {
  return db.query("SELECT played_at, duration_ms FROM game_records WHERE user_id = ? AND play_mode = ? AND completed = 1 AND duration_ms > 0 AND ABS(duration_ms - ?) <= 1000 AND ABS(played_at - ?) <= 120000").get(userId, "name-all", timeMs, achievedAt);
}

if (!who) {
  console.log("NAME ALL COUNTRIES BOARD AUDIT (fastest first)\n");
  console.log("  " + "player".padEnd(22) + "board".padStart(9) + "  set                 " + "fastest recorded run".padStart(21) + "  runs  verdict");
  const rows = db.query("SELECT u.id, u.display_name, b.best_time_ms, b.achieved_at FROM mode_best_times b JOIN users u ON u.id = b.user_id WHERE b.game_mode = ? AND b.variant = ? ORDER BY b.best_time_ms").all("name-all", "");
  for (const r of rows) {
    const runs = db.query("SELECT COUNT(*) AS n, MIN(CASE WHEN completed = 1 AND duration_ms > 0 THEN duration_ms END) AS fastest FROM game_records WHERE user_id = ? AND play_mode = ?").get(r.id, "name-all");
    const match = matchingRun(r.id, r.best_time_ms, r.achieved_at);
    const verdict = match ? "ok: matches a recorded run" : runs.fastest ? "CHECK: no recorded run at this time" : "CHECK: never recorded a finished timed run";
    console.log("  " + r.display_name.padEnd(22) + clock(r.best_time_ms).padStart(9) + "  " + at(r.achieved_at) + "  " + clock(runs.fastest).padStart(19) + "  " + String(runs.n).padStart(4) + "  " + verdict);
  }
  process.exit(0);
}

const user = db.query("SELECT id, display_name, email, created_at FROM users WHERE display_name = ? OR email = ?").get(who, who);
if (!user) { console.log("No user called", who); process.exit(1); }

console.log("USER", user.display_name, user.email, "joined", at(user.created_at));

console.log("\nBEST TIMES ON THE BOARD");
for (const r of db.query("SELECT game_mode, variant, best_time_ms, achieved_at FROM mode_best_times WHERE user_id = ? ORDER BY game_mode").all(user.id)) {
  console.log(" ", r.game_mode.padEnd(14), (r.variant || "").padEnd(14), clock(r.best_time_ms).padStart(9), "set", at(r.achieved_at));
}

const best = db.query("SELECT best_time_ms, achieved_at FROM mode_best_times WHERE user_id = ? AND game_mode = ? AND variant = ?").get(user.id, "name-all", "");
if (best) {
  const match = matchingRun(user.id, best.best_time_ms, best.achieved_at);
  console.log("\nNAME ALL BOARD TIME", clock(best.best_time_ms), "→", match ? `matches a finished run recorded at ${at(match.played_at)}` : "NO FINISHED RUN WAS RECORDED WITH THIS TIME");
}

console.log("\nNAME ALL COUNTRIES RUNS THE GAME RECORDED (oldest first)");
for (const r of db.query("SELECT played_at, duration_ms, completed, countries_found, countries_total FROM game_records WHERE user_id = ? AND play_mode = ? ORDER BY played_at").all(user.id, "name-all")) {
  console.log(" ", at(r.played_at), r.completed ? "finished  " : "unfinished", `${r.countries_found}/${r.countries_total}`.padStart(7), r.duration_ms ? clock(r.duration_ms) : "(practice or not finished: no time)");
}

console.log("\nLEADERBOARD POSTS, EACH CHECKED AGAINST A GAME RECORD FROM THE SAME MOMENT");
for (const e of db.query("SELECT time, ip, details FROM admin_events WHERE user_id = ? AND action = ? ORDER BY time").all(user.id, "leaderboard.submitted")) {
  const d = JSON.parse(e.details);
  if (d.mode !== "name-all") continue;
  const game = db.query("SELECT duration_ms, countries_found, countries_total FROM game_records WHERE user_id = ? AND play_mode = ? AND completed = 1 AND played_at BETWEEN ? AND ?").get(user.id, "name-all", e.time - 15000, e.time + 15000);
  const verdict = !game
    ? "NO MATCHING GAME RECORD (posted without a finished run being recorded)"
    : Math.abs(game.duration_ms - d.timeMs) <= 1000
      ? `matches a finished run (${game.countries_found}/${game.countries_total}, ${clock(game.duration_ms)})`
      : `TIME DIFFERS: the game recorded ${clock(game.duration_ms)}`;
  console.log(" ", at(e.time), "posted", clock(d.timeMs).padStart(9), d.accepted ? "new best " : "not a best", "ip", e.ip, "→", verdict);
}

console.log("\nIPS THIS ACCOUNT HAS USED");
for (const r of db.query("SELECT ip, count(*) AS n, min(time) AS first, max(time) AS last FROM admin_events WHERE user_id = ? GROUP BY ip ORDER BY last DESC").all(user.id)) {
  console.log(" ", String(r.ip).padEnd(40), String(r.n).padStart(4), "events", at(r.first), "→", at(r.last));
}

console.log("\nFASTEST NAME ALL TIMES ON THE BOARD, FOR COMPARISON");
for (const r of db.query("SELECT u.display_name, b.best_time_ms, b.achieved_at FROM mode_best_times b JOIN users u ON u.id = b.user_id WHERE b.game_mode = ? AND b.variant = ? ORDER BY b.best_time_ms LIMIT 10").all("name-all", "")) {
  console.log(" ", r.display_name.padEnd(24), clock(r.best_time_ms).padStart(9), "set", at(r.achieved_at));
}
