// Seeds a local dev database with realistic players, leaderboards, dailies, friends, Academy
// progress and admin events. Run with Bun:
//
//   npm run seed                  # refresh seed data in ./.data/locato.db (or $DATABASE_PATH)
//   npm run seed -- --reset       # delete every seed account first, then seed
//   npm run seed -- --clean       # delete every seed account and stop
//   npm run seed -- --seed=7      # a different (still deterministic) dataset
//
// Only accounts on @seed.locato.test plus tester@locato.test are ever touched. The seeding logic
// lives in server/dev/seed.ts; this wrapper just opens SQLite and prints the summary.
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bunPasswordHasher } from "../server/auth/passwords";
import { openDatabase, SqliteUserStore } from "../server/db/database";
import { checkSeedSafety, DEFAULT_SEED, SEED_EMAIL_DOMAIN, seedDevData } from "../server/dev/seed";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage(): never {
  console.log(`Usage: bun scripts/seed-dev.ts [--reset] [--clean] [--seed=N]

  --reset    delete all seed accounts (@${SEED_EMAIL_DOMAIN} + tester@locato.test) before seeding
  --clean    delete all seed accounts and exit without seeding
  --seed=N   RNG seed for a different deterministic dataset (default ${DEFAULT_SEED})

Writes to $DATABASE_PATH (default ./.data/locato.db). Refuses to run with NODE_ENV=production,
on a Fly machine, or against /data.`);
  process.exit(0);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) usage();
const unknown = args.filter((arg) => !["--reset", "--clean"].includes(arg) && !/^--seed=\d+$/.test(arg));
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(" ")}. Try --help.`);
  process.exit(1);
}
const seedArg = args.find((arg) => arg.startsWith("--seed="));
const seed = seedArg ? Number.parseInt(seedArg.slice("--seed=".length), 10) : DEFAULT_SEED;

const databasePath = process.env.DATABASE_PATH ?? resolve(PROJECT_ROOT, ".data/locato.db");
const safety = checkSeedSafety({
  env: process.env,
  databasePath,
  localRoots: [PROJECT_ROOT, homedir(), tmpdir(), "/tmp", "/private/tmp", "/private/var/folders"],
});
if (!safety.ok) {
  console.error(`Refusing to seed: ${safety.reason}`);
  process.exit(1);
}

const db = openDatabase(safety.path);
const store = new SqliteUserStore(db);
const started = performance.now();
const summary = await seedDevData({
  store,
  hasher: bunPasswordHasher,
  seed,
  reset: args.includes("--reset"),
  cleanOnly: args.includes("--clean"),
  transaction: (work) => db.transaction(work)(),
  log: (message) => console.log(message),
});

const count = (table: string) => (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const tables = ["users", "sessions", "game_records", "mode_best_times", "mode_best_scores", "daily_challenge_results", "friendships", "academy_progress", "admin_events"];

console.log(`\nLocato dev seed (seed=${summary.seed}) → ${safety.path}  [${Math.round(performance.now() - started)} ms]`);
if (summary.removedUsers > 0) console.log(`  removed ${summary.removedUsers} previous seed account(s)`);
if (args.includes("--clean")) {
  console.log("  --clean: seed accounts removed, nothing re-seeded.");
  process.exit(0);
}
console.log(`  accounts: ${summary.createdUsers} created, ${summary.refreshedUsers} refreshed${summary.skippedUsernames.length ? `, skipped ${summary.skippedUsernames.join(", ")}` : ""}`);
console.log(`  best times: ${summary.bestTimes}, best scores: ${summary.bestScores} across ${summary.boards.length} boards (${summary.boards.map((b) => `${b.board} ${b.entries}`).join(", ")})`);
console.log(`  dailies: ${summary.dailyResults} over 14 days (${summary.dailyToday} today) · games: ${summary.games} · sessions: ${summary.sessions}`);
console.log(`  tester friends: ${summary.friends.accepted} accepted, ${summary.friends.incoming} incoming, ${summary.friends.outgoing} outgoing`);
console.log(`  academy: ${summary.academyCards} cards, ${summary.academyDue} due now · admin events: ${summary.eventsSkipped ? "already seeded, kept" : `${summary.events} added`}`);
console.log(`  table rows (all accounts): ${tables.map((table) => `${table}=${count(table)}`).join(" ")}`);

if (summary.tester) {
  const t = summary.tester;
  console.log(`\nTest user   ${t.username}  /  ${t.email}  /  password: ${t.password}`);
  console.log(`            daily streak ${t.dailyStreak}, ${t.dailyDates.length} of the last 14 days`);
  console.log(`            ranks: ${t.ranks.map((r) => `${r.board} #${r.rank}/${r.of}`).join(", ")}`);
  console.log(`Every seed player (e.g. atlas_amy@${SEED_EMAIL_DOMAIN}) uses the same password.`);
  console.log(`\nLog in: npm run serve (or: DATABASE_PATH=${safety.path} bun server/index.ts), open http://localhost:${process.env.PORT ?? 3000}, Sign in with the email above.`);
  console.log(process.env.ADMIN_EMAILS ? `Admin: open /admin and sign in as one of ${process.env.ADMIN_EMAILS}.` : `Admin: start the server with ADMIN_EMAILS=<a seed player's email> to use the admin console at /admin.`);
  console.log(`\nAchievements live in localStorage. After signing in, paste this into the browser console:\n${summary.achievementsSnippet}`);
}
