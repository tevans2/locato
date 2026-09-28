// Dev-only data seeding. Fills a local database with realistic players, leaderboards, dailies,
// game history, friends, Academy progress and admin events so every UI surface has something to
// show. Everything is written through the UserStore API (the same calls the server makes), so
// this module has no bun:sqlite dependency and runs against the in-memory store in tests.
// `scripts/seed-dev.ts` is the thin Bun wrapper that opens SQLite and calls `seedDevData`.
//
// Never imported by the server itself.
import { isAbsolute, relative, resolve } from "node:path";
import { rawCountries } from "../../src/core/countries";
import type { Continent } from "../../src/core/countries";
import { LEARNING_GROUPS } from "../../src/core/academy/groups";
import { BOX_INTERVALS_MS } from "../../src/core/academy/srs";
import type { AcademyProgress, AcademySkill, CardKey, CardProgress, LeitnerBox } from "../../src/core/academy/types";
import { createDailyShareText, DAILY_COUNTRY_COUNT, DAILY_HINT_PENALTY, DAILY_MAX_SCORE, DAILY_POINTS_PER_ROUND, DAILY_WRONG_GUESS_PENALTY } from "../../src/core/dailyChallenge";
import { validateAcademyProgress } from "../academy/validation";
import { normalizeUsername } from "../auth/AuthService";
import { createSessionToken, createUserId } from "../auth/tokens";
import { CONTINENTS, MAX_TIME_MS, MIN_TIME_MS, leaderboardModeConfig, normalizeLeaderboardVariant, type LeaderboardGameMode } from "../leaderboard/validation";
import type { AdminEventInput, DailyChallengeResult, DailyRoundMark, GameResult, PasswordHasher, StoredUser, UserStore } from "../auth/types";

export const SEED_EMAIL_DOMAIN = "seed.locato.test";
export const TEST_USER = { username: "tester", email: "tester@locato.test", password: "locato-dev" } as const;
export const DEFAULT_SEED = 1;
// Mirrors STORAGE_KEY in src/storage/achievements.ts (not exported there; achievements are device-local).
export const ACHIEVEMENTS_STORAGE_KEY = "locato.achievements.v1";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const DAILY_DAYS = 14;
const HISTORY_DAYS = 60;
const SESSION_TTL_MS = 30 * DAY_MS;
// Seed admin events come from documentation IP ranges (RFC 5737); this one marks "already seeded".
const SENTINEL_IP = "203.0.113.1";

/** True for accounts this seeder owns. Nothing else is ever modified or deleted. */
export function isSeedEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return lower === TEST_USER.email || lower.endsWith(`@${SEED_EMAIL_DOMAIN}`);
}

// ---------------------------------------------------------------------------------------------
// Safety

export interface SeedSafetyInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly databasePath: string;
  /** Directories a local dev database may live under (project root, home, temp dirs). */
  readonly localRoots: readonly string[];
}

export type SeedSafetyResult = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string };

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Refuses anything that looks like production: NODE_ENV, a Fly machine, or the Fly volume. */
export function checkSeedSafety(input: SeedSafetyInput): SeedSafetyResult {
  const { env } = input;
  if (env.NODE_ENV === "production") {
    return { ok: false, reason: "NODE_ENV=production. The seeder only runs against local dev databases." };
  }
  const flyVar = ["FLY_APP_NAME", "FLY_MACHINE_ID", "FLY_ALLOC_ID"].find((name) => env[name]);
  if (flyVar) return { ok: false, reason: `${flyVar} is set, so this looks like a Fly machine. Refusing to seed.` };

  const path = resolve(input.databasePath);
  if (isInside(path, "/data")) {
    return { ok: false, reason: `DATABASE_PATH ${path} is on /data (the Fly volume mount). Refusing to seed.` };
  }
  if (!input.localRoots.some((root) => isInside(path, root))) {
    return { ok: false, reason: `DATABASE_PATH ${path} is not under the project, your home directory or a temp directory, so it may not be a local dev database. Refusing to seed.` };
  }
  return { ok: true, path };
}

// ---------------------------------------------------------------------------------------------
// Deterministic randomness

export type Rng = () => number;

// mulberry32: tiny, fast, good enough for fixtures.
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

// Independent stream per (seed, label) so adding a player or board doesn't reshuffle everything else.
function rngFor(seed: number, label: string): Rng {
  return createRng(hashString(`${seed}:${label}`));
}

const between = (rng: Rng, min: number, max: number) => min + (max - min) * rng();
const intBetween = (rng: Rng, min: number, max: number) => Math.floor(between(rng, min, max + 1));
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// ---------------------------------------------------------------------------------------------
// Roster

const AVATARS = ["🌍", "🌎", "🌏", "🗺️", "🧭", "🏔️", "🏝️", "🌋", "🗼", "🗽", "🦁", "🐘", "🦊", "🐨", "🦅", "🦜", "🐬", "🦋", "🌺", "🌵"] as const;

const PLAYER_NAMES = [
  "atlas_amy", "MapleMarco", "kiwi_kate", "nomad_nils", "compass_rose", "PolarPip", "sahara_sam", "fjord_freya",
  "LemurLeo", "andes_ana", "borealis", "CoralCruz", "dune_dash", "tundra_tom", "MonsoonMia", "baobab_ben",
  "GlacierGus", "pampas_paz", "steppe_sid", "lagoon_lu", "IslandIvy", "mesa_max", "OasisOmar", "delta_dee",
  "ridge_rae", "cairn_cal", "TidePoolTess", "volcano_vic", "MeridianMo", "equator_eli", "archipelaJo", "savanna_sol",
  "PeakPriya", "riverbend", "capecod_cy", "zenith_zoe", "quokka_quinn", "orbit_otto", "tropic_taj", "zoomzoom",
] as const;

// Friends of the tester: accepted, plus one request each way still pending.
const ACCEPTED_FRIENDS = ["atlas_amy", "kiwi_kate", "fjord_freya", "andes_ana", "MeridianMo"] as const;
const INCOMING_REQUEST = "quokka_quinn";
const OUTGOING_REQUEST = "PolarPip";
// One player whose times are too good to be true, so the admin "too fast" flags have something to show.
const SUSPICIOUS_PLAYER = "zoomzoom";

interface PlayerSpec {
  readonly username: string;
  readonly email: string;
  readonly avatar: string | null;
  /** 0 = best in the world, 1 = beginner. Correlated across every board. */
  readonly skill: number;
  /** 0–1, how often they turn up (boards entered, dailies played, games per day). */
  readonly activity: number;
  readonly createdDaysAgo: number;
  readonly isTester: boolean;
}

function buildRoster(seed: number): PlayerSpec[] {
  const players = PLAYER_NAMES.map((username, index): PlayerSpec => {
    const rng = rngFor(seed, `player:${username}`);
    const isFriend = (ACCEPTED_FRIENDS as readonly string[]).includes(username);
    return {
      username,
      email: `${username.toLowerCase()}@${SEED_EMAIL_DOMAIN}`,
      // A few players never picked an avatar, like real accounts.
      avatar: rng() < 0.12 ? null : pick(rng, AVATARS),
      skill: username === SUSPICIOUS_PLAYER ? 0 : clamp01(rng() ** 0.9),
      activity: isFriend ? between(rng, 0.7, 1) : between(rng, 0.25, 1),
      // Most accounts are older than the 30-day admin window, a handful signed up recently.
      createdDaysAgo: index % 6 === 0 ? intBetween(rng, 1, 28) : intBetween(rng, 35, 180),
      isTester: false,
    };
  });
  players.push({ username: TEST_USER.username, email: TEST_USER.email, avatar: "🧭", skill: 0.5, activity: 0.8, createdDaysAgo: 75, isTester: true });
  return players;
}

// ---------------------------------------------------------------------------------------------
// Boards

interface BoardSpec {
  readonly gameMode: LeaderboardGameMode;
  readonly variant: string;
  readonly fastMs: number;
  readonly slowMs: number;
  /** Share of players with a time on this board (scaled by each player's activity). */
  readonly popularity: number;
}

const min = (minutes: number, seconds = 0) => (minutes * 60 + seconds) * 1000;

const PUZZLE_RANGES: Readonly<Record<Continent, readonly [number, number]>> = {
  Africa: [min(3), min(12)],
  Asia: [min(3), min(13)],
  Europe: [min(2, 30), min(10)],
  "North America": [min(1, 20), min(6)],
  Oceania: [min(0, 40), min(3)],
  "South America": [min(0, 30), min(2, 30)],
};

export const SEED_BOARDS: readonly BoardSpec[] = [
  { gameMode: "flags", variant: "", fastMs: min(1, 30), slowMs: min(8), popularity: 0.95 },
  { gameMode: "flags", variant: "territories", fastMs: min(0, 50), slowMs: min(4), popularity: 0.45 },
  { gameMode: "flags", variant: "both", fastMs: min(2, 30), slowMs: min(11), popularity: 0.4 },
  { gameMode: "flag-colors", variant: "", fastMs: min(3), slowMs: min(14), popularity: 0.45 },
  { gameMode: "shapes", variant: "", fastMs: min(2, 30), slowMs: min(12), popularity: 0.7 },
  { gameMode: "codes", variant: "", fastMs: min(1, 15), slowMs: min(6), popularity: 0.55 },
  { gameMode: "capitals", variant: "", fastMs: min(2), slowMs: min(9), popularity: 0.85 },
  { gameMode: "capital-recall", variant: "", fastMs: min(4), slowMs: min(18), popularity: 0.5 },
  { gameMode: "name-all", variant: "", fastMs: min(8), slowMs: min(40), popularity: 0.7 },
  { gameMode: "click-country", variant: "", fastMs: min(6), slowMs: min(25), popularity: 0.6 },
  { gameMode: "spot-country", variant: "", fastMs: min(5), slowMs: min(20), popularity: 0.5 },
  ...CONTINENTS.map((continent): BoardSpec => ({ gameMode: "puzzle", variant: continent, fastMs: PUZZLE_RANGES[continent][0], slowMs: PUZZLE_RANGES[continent][1], popularity: continent === "Europe" || continent === "Africa" ? 0.65 : 0.45 })),
];

interface ScoreBoardSpec {
  readonly gameMode: LeaderboardGameMode;
  readonly variant: string;
  /** Share of the board's maxScore the best and the weakest regulars reach. */
  readonly bestShare: number;
  readonly worstShare: number;
  readonly popularity: number;
}

// Score boards (highest first). Shares keep every seeded total under the board's maxScore.
export const SEED_SCORE_BOARDS: readonly ScoreBoardSpec[] = [
  { gameMode: "map-tap", variant: "", bestShare: 0.88, worstShare: 0.3, popularity: 0.6 },
  { gameMode: "worldsplit", variant: "", bestShare: 0.96, worstShare: 0.5, popularity: 0.45 },
  { gameMode: "geoguessr", variant: "", bestShare: 0.9, worstShare: 0.25, popularity: 0.65 },
  { gameMode: "streetview-country", variant: "", bestShare: 1, worstShare: 0.3, popularity: 0.55 },
];

const boardLabel = (board: { gameMode: string; variant: string }) => (board.variant ? `${board.gameMode}:${board.variant}` : board.gameMode);

// The tester sits on most boards mid-table, skips a couple, and is top 5 on one so medals + "you" show.
const TESTER_SKIPS = new Set(["flags:territories", "puzzle:Oceania"]);
const TESTER_PODIUM_BOARD = "capitals";
const TESTER_PODIUM_RANK = 3;
// ...and on one score board too.
const TESTER_SCORE_PODIUM_BOARD = "geoguessr";

function seedMaxScore(board: ScoreBoardSpec): number {
  const maxScore = leaderboardModeConfig(board.gameMode)?.maxScore;
  if (maxScore === undefined) throw new Error(`Seed board ${boardLabel(board)} is not a score board`);
  return maxScore;
}

function boardScore(rng: Rng, board: ScoreBoardSpec, skill: number): number {
  const maxScore = seedMaxScore(board);
  const position = clamp01(skill * 0.8 + rng() * 0.3) ** 1.25;
  const share = board.bestShare - (board.bestShare - board.worstShare) * position;
  return Math.min(maxScore, Math.max(0, Math.round(maxScore * share)));
}

function boardTime(rng: Rng, board: BoardSpec, skill: number): number {
  const position = clamp01(skill * 0.8 + rng() * 0.3) ** 1.25;
  const ms = Math.round(board.fastMs + (board.slowMs - board.fastMs) * position + rng() * 0.03 * board.fastMs);
  return Math.min(MAX_TIME_MS, Math.max(MIN_TIME_MS + 1, ms));
}

// ---------------------------------------------------------------------------------------------
// Time helpers (local calendar days, like the client's daily challenge)

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localMidnight(now: number, daysAgo: number): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysAgo).getTime();
}

// A moment on a past local day, at a plausible waking hour, never in the future.
function momentOn(rng: Rng, now: number, daysAgo: number): number {
  const at = localMidnight(now, daysAgo) + Math.round(between(rng, 7, 23) * HOUR_MS);
  return Math.min(at, now - intBetween(rng, 2, 50) * MINUTE_MS);
}

// ---------------------------------------------------------------------------------------------
// Dailies

function dailyResult(rng: Rng, skill: number, date: string, completedAt: number, tooFast = false): DailyChallengeResult {
  const marks: DailyRoundMark[] = [];
  let score = 0;
  let hintsUsed = 0;
  const pCorrect = 0.93 - skill * 0.45;
  const pHint = 0.05 + skill * 0.2;
  for (let round = 0; round < DAILY_COUNTRY_COUNT; round += 1) {
    const roll = tooFast ? 0 : rng();
    if (roll < pCorrect) {
      marks.push("correct");
      score += rng() < 0.15 ? DAILY_POINTS_PER_ROUND - DAILY_WRONG_GUESS_PENALTY : DAILY_POINTS_PER_ROUND;
    } else if (roll < pCorrect + pHint) {
      const hints = rng() < 0.3 ? 2 : 1;
      hintsUsed += hints;
      marks.push("hint");
      score += Math.max(0, DAILY_POINTS_PER_ROUND - hints * DAILY_HINT_PENALTY);
    } else {
      marks.push("miss");
    }
  }
  score = Math.min(DAILY_MAX_SCORE, Math.round(score));
  const misses = marks.filter((mark) => mark === "miss").length;
  const timeMs = tooFast ? intBetween(rng, 9_000, 13_000) : Math.round(50_000 + skill * 110_000 + rng() * 70_000 + misses * 9_000 + hintsUsed * 6_000);
  return { date, seed: `daily:${date}`, score, timeMs, hintsUsed, marks, shareText: createDailyShareText(date, score, timeMs, marks), completedAt };
}

function consecutiveFromToday(dates: readonly string[], now: number): number {
  const played = new Set(dates);
  let streak = 0;
  while (played.has(localDayKey(localMidnight(now, streak) + 12 * HOUR_MS))) streak += 1;
  return streak;
}

// Days (0 = today) the tester played: a 7-day streak ending today plus three earlier days = 10 of 14.
const TESTER_DAILY_DAYS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];

// ---------------------------------------------------------------------------------------------
// Game history

const SOLO_CATEGORIES = ["flags", "shapes", "capitals", "codes", "capital-recall", "flag-colors"] as const;
const WORLD_PLAY_MODES = ["name-all", "click-country", "spot-country", "puzzle"] as const;
const COUNTRY_TOTAL = rawCountries.length;
const CONTINENT_TOTALS = new Map<string, number>(CONTINENTS.map((continent) => [continent, rawCountries.filter((country) => country.continent === continent).length]));

function gameResult(rng: Rng, skill: number): GameResult {
  const accuracy = clamp01(0.55 + (1 - skill) * 0.4 + between(rng, -0.08, 0.08));
  const kind = rng();
  if (kind < 0.55) {
    const first = pick(rng, SOLO_CATEGORIES);
    const categoryIds = rng() < 0.25 ? [...new Set([first, pick(rng, SOLO_CATEGORIES)])] : [first];
    const answers = intBetween(rng, 10, 60);
    const correct = Math.round(answers * accuracy);
    const wrong = answers - correct;
    const bestStreak = Math.min(correct, Math.max(1, Math.round(correct * between(rng, 0.25, wrong === 0 ? 1 : 0.7))));
    return { mode: "solo", categoryIds, correctAnswers: correct, wrongAnswers: wrong, score: correct * 10, bestStreak };
  }
  if (kind < 0.72) {
    const totalPlayers = intBetween(rng, 2, 6);
    const rank = Math.min(totalPlayers, 1 + Math.floor(clamp01(skill + between(rng, -0.35, 0.35)) * totalPlayers));
    const answers = intBetween(rng, 8, 20);
    const correct = Math.round(answers * accuracy);
    return { mode: "multiplayer", categoryIds: [pick(rng, SOLO_CATEGORIES)], correctAnswers: correct, wrongAnswers: answers - correct, score: correct * 100, bestStreak: Math.max(1, Math.round(correct * between(rng, 0.3, 0.8))), rank, totalPlayers };
  }
  const playMode = pick(rng, WORLD_PLAY_MODES);
  const continent = pick(rng, CONTINENTS);
  const countriesTotal = playMode === "puzzle" ? CONTINENT_TOTALS.get(continent)! : COUNTRY_TOTAL;
  const completed = rng() < 0.3 + (1 - skill) * 0.4;
  const board = SEED_BOARDS.find((spec) => spec.gameMode === playMode && (playMode !== "puzzle" || spec.variant === continent))!;
  const timed = rng() < 0.7;
  return {
    mode: "world-map",
    categoryIds: [`world-map:${playMode}`],
    correctAnswers: 0,
    wrongAnswers: 0,
    score: 0,
    bestStreak: 0,
    durationMs: completed && timed ? boardTime(rng, board, skill) + intBetween(rng, 0, 90_000) : 0,
    completed,
    countriesFound: completed ? countriesTotal : Math.round(countriesTotal * between(rng, 0.3, 0.95)),
    countriesTotal,
    playMode,
  };
}

// ---------------------------------------------------------------------------------------------
// Academy

function testerAcademy(seed: number, now: number): AcademyProgress {
  const rng = rngFor(seed, "academy");
  const cards: Record<CardKey, CardProgress> = {};
  const skills: readonly AcademySkill[] = ["flag", "shape", "capital", "map"];
  const set = (code: string, skill: AcademySkill, box: LeitnerBox, due: boolean) => {
    const interval = BOX_INTERVALS_MS[box];
    // Due cards were last seen more than one interval ago; the rest part-way through theirs.
    const lastSeenAt = due ? now - interval - intBetween(rng, 1, 36) * HOUR_MS : now - Math.round(interval * between(rng, 0.1, 0.6));
    cards[`${code}:${skill}` as CardKey] = { box, correct: box + intBetween(rng, 0, 4), wrong: intBetween(rng, 0, box <= 2 ? 3 : 1), lastSeenAt, dueAt: lastSeenAt + interval };
  };
  const group = (id: string) => LEARNING_GROUPS.find((g) => g.id === id)!.countryCodes;

  // Mastered: every skill at box 4+.
  for (const code of group("europe-big-names")) for (const skill of skills) set(code, skill, rng() < 0.4 ? 5 : 4, false);
  group("north-america-headliners").forEach((code, index) => {
    for (const skill of skills) set(code, skill, index < 3 ? 4 : skill === "map" ? 3 : 4, false);
  });
  // Learning, with a handful of cards due for review right now.
  group("east-asia").forEach((code, index) => {
    for (const skill of skills) set(code, skill, index < 2 ? 3 : index < 4 ? 2 : 1, (index === 2 || index === 3) && (skill === "flag" || skill === "capital"));
  });
  group("south-america-big-names").slice(0, 3).forEach((code) => {
    set(code, "flag", 2, false);
    set(code, "capital", 1, false);
  });
  group("africa-big-names").slice(0, 2).forEach((code) => set(code, "flag", 1, true));

  const activity: Record<string, number> = {};
  for (let daysAgo = 0; daysAgo < 30; daysAgo += 1) {
    if (daysAgo === 0 || rng() < 0.6) activity[localDayKey(localMidnight(now, daysAgo) + 12 * HOUR_MS)] = intBetween(rng, 8, 45);
  }
  const updatedAt = Math.max(...Object.values(cards).map((card) => card.lastSeenAt));
  return { version: 1, cards, placementCompletedAt: now - 28 * DAY_MS, activity, updatedAt };
}

// ---------------------------------------------------------------------------------------------
// Admin events

function adminEvents(seed: number, now: number, players: readonly { spec: PlayerSpec; user: StoredUser }[]): AdminEventInput[] {
  const rng = rngFor(seed, "events");
  const ip = () => (rng() < 0.5 ? `203.0.113.${intBetween(rng, 2, 250)}` : `198.51.100.${intBetween(rng, 2, 250)}`);
  const events: AdminEventInput[] = [];
  const add = (daysAgo: number, level: "info" | "warn", action: string, userId: string | null, details: Record<string, unknown>, eventIp = ip()) => {
    events.push({ time: momentOn(rng, now, daysAgo), level, action, ip: eventIp, userId, details });
  };
  for (const { spec, user } of players) {
    if (spec.createdDaysAgo <= DAILY_DAYS) add(spec.createdDaysAgo, "info", "register.ok", user.id, { email: user.email });
    const logins = Math.round(spec.activity * 3);
    for (let i = 0; i < logins; i += 1) add(intBetween(rng, 0, DAILY_DAYS - 1), "info", "login.ok", user.id, { email: user.email });
    if (rng() < 0.5) add(intBetween(rng, 0, 6), "info", "daily.recorded", user.id, { date: localDayKey(now), score: intBetween(rng, 40, 100) });
    if (rng() < 0.4) add(intBetween(rng, 0, 10), "info", "leaderboard.submitted", user.id, { gameMode: pick(rng, SEED_BOARDS).gameMode, isPersonalBest: rng() < 0.6 });
    if (rng() < 0.3) add(intBetween(rng, 0, 10), "info", "game.recorded", user.id, { mode: "solo", correct: intBetween(rng, 8, 40) });
  }
  for (let i = 0; i < 6; i += 1) add(intBetween(rng, 0, 13), "warn", "login.failed", null, { email: `${pick(rng, PLAYER_NAMES).toLowerCase()}@${SEED_EMAIL_DOMAIN}`, reason: "Invalid email or password." });
  add(2, "warn", "register.failed", null, { reason: "That username is taken.", status: 409 });
  add(1, "warn", "admin.unauthorized", null, { path: "/api/admin/overview" }, "198.51.100.66");
  add(1, "warn", "admin.unauthorized", null, { path: "/api/admin/users" }, "198.51.100.66");
  add(4, "warn", "oauth.error", null, { provider: "github", error: "access_denied" });
  add(3, "warn", "academy.sync.rejected", null, { reason: "Card XX:flag: Unknown country in card key." });
  const tester = players.find((p) => p.spec.isTester)!.user;
  // The sentinel marks this database's event log as seeded.
  add(0, "info", "login.ok", tester.id, { email: tester.email }, SENTINEL_IP);
  add(0, "info", "academy.sync", tester.id, { cards: 0 });
  return events.sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------------------------
// Achievements (device-local; the seeder can only print a snippet for the browser console)

export function achievementsSnippet(dailyDates: readonly string[]): string {
  const state = {
    unlockedIds: ["daily-first", "daily-streak-3", "daily-streak-7", "solo-perfect", "solo-no-hints", "world-first", "puzzle-first", "puzzle-accurate", "world-south-america-complete"],
    dailyDates: [...dailyDates].sort(),
    bestDailyStreak: 7,
    completedWorldModes: ["name-all", "click-country"],
    completedPuzzleContinents: ["Europe", "North America", "South America"],
    completedWorldContinents: ["South America"],
    completedLandlockedCountryCodes: ["AT", "CH", "CZ", "HU", "SK", "BO", "PY", "MN", "NP", "BT", "LA", "KZ"],
    completedNoHintSoloContinents: ["South America"],
  };
  return `localStorage.setItem(${JSON.stringify(ACHIEVEMENTS_STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(state))}); location.reload();`;
}

// ---------------------------------------------------------------------------------------------
// Main entry

export interface SeedOptions {
  readonly store: UserStore;
  readonly hasher: PasswordHasher;
  readonly now?: number;
  readonly seed?: number;
  /** Delete every existing seed account (and its data) before seeding. */
  readonly reset?: boolean;
  /** Only delete seed accounts; don't seed anything. */
  readonly cleanOnly?: boolean;
  /** Wraps the synchronous writes, e.g. in a SQLite transaction. */
  readonly transaction?: (work: () => void) => void;
  readonly log?: (message: string) => void;
}

export interface SeedSummary {
  readonly seed: number;
  readonly removedUsers: number;
  readonly createdUsers: number;
  readonly refreshedUsers: number;
  readonly skippedUsernames: readonly string[];
  readonly bestTimes: number;
  readonly bestScores: number;
  readonly boards: readonly { readonly board: string; readonly entries: number }[];
  readonly dailyResults: number;
  readonly dailyToday: number;
  readonly games: number;
  readonly sessions: number;
  readonly friends: { readonly accepted: number; readonly incoming: number; readonly outgoing: number };
  readonly academyCards: number;
  readonly academyDue: number;
  readonly events: number;
  readonly eventsSkipped: boolean;
  readonly tester: {
    readonly id: string;
    readonly username: string;
    readonly email: string;
    readonly password: string;
    readonly ranks: readonly { readonly board: string; readonly rank: number; readonly of: number }[];
    readonly dailyStreak: number;
    readonly dailyDates: readonly string[];
  } | null;
  readonly achievementsSnippet: string | null;
}

/** Every seed-owned account currently in the store (seed domain + the tester). */
export function findSeedUsers(store: UserStore): StoredUser[] {
  const found = new Map<string, StoredUser>();
  for (let offset = 0; ; offset += 100) {
    const page = store.listUsers({ query: `@${SEED_EMAIL_DOMAIN}`, limit: 100, offset });
    for (const summary of page.users) {
      const user = store.findUserById(summary.id);
      if (user && isSeedEmail(user.email)) found.set(user.id, user);
    }
    if (page.users.length < 100) break;
  }
  const tester = store.findUserByEmail(TEST_USER.email);
  if (tester) found.set(tester.id, tester);
  return [...found.values()];
}

// Clears what the seeder writes for one seed account, so a re-run replaces rather than duplicates.
function clearSeedData(store: UserStore, user: StoredUser, seedIds: ReadonlySet<string>, keepSessions: boolean): void {
  store.resetUserStats(user.id);
  for (const row of store.listUserBestTimes(user.id)) store.deleteBestTime(user.id, row.gameMode, row.variant);
  for (const row of store.listUserBestScores(user.id)) store.deleteBestScore(user.id, row.gameMode, row.variant);
  for (const result of store.listDailyResults(user.id, 10_000)) store.deleteDailyResult(user.id, result.date);
  if (!keepSessions) store.deleteUserSessions(user.id);
  // Only friendships between two seed accounts; a real account's friend links are left alone.
  const requests = store.listFriendRequests(user.id);
  const others = [...store.listFriends(user.id), ...requests.incoming.map((entry) => entry.user), ...requests.outgoing.map((entry) => entry.user)];
  for (const other of others) if (seedIds.has(other.id)) store.removeFriendship(user.id, other.id);
}

export async function seedDevData(options: SeedOptions): Promise<SeedSummary> {
  const { store } = options;
  const now = options.now ?? Date.now();
  const seed = options.seed ?? DEFAULT_SEED;
  const log = options.log ?? (() => {});
  const transaction = options.transaction ?? ((work: () => void) => work());

  // Hash once up front (async), then do every write synchronously inside one transaction. Every
  // seed account shares the dev password, so you can sign in as any of them.
  const passwordHash = options.cleanOnly ? "" : await options.hasher.hash(TEST_USER.password);

  let removedUsers = 0;
  let createdUsers = 0;
  let refreshedUsers = 0;
  const skippedUsernames: string[] = [];
  let bestTimes = 0;
  let bestScores = 0;
  let dailyResults = 0;
  let dailyToday = 0;
  let games = 0;
  let sessions = 0;
  let events = 0;
  let eventsSkipped = false;
  let academyCards = 0;
  let academyDue = 0;
  const boardCounts = new Map<string, number>();
  let tester: SeedSummary["tester"] = null;
  let snippet: string | null = null;
  let friendsSummary: SeedSummary["friends"] = { accepted: 0, incoming: 0, outgoing: 0 };

  transaction(() => {
    if (options.reset || options.cleanOnly) {
      for (const user of findSeedUsers(store)) {
        if (store.deleteUser(user.id)) removedUsers += 1;
      }
      log(`Removed ${removedUsers} seed account(s).`);
    }
    if (options.cleanOnly) return;

    // 1. Accounts: create or refresh in place (ids are kept, so a signed-in tester stays signed in).
    const roster = buildRoster(seed);
    const existingSeedIds = new Set(findSeedUsers(store).map((user) => user.id));
    const players: { spec: PlayerSpec; user: StoredUser }[] = [];
    for (const spec of roster) {
      if (normalizeUsername(spec.username) !== spec.username) throw new Error(`Invalid seed username: ${spec.username}`);
      const byName = store.findUserByUsername(spec.username);
      let user = store.findUserByEmail(spec.email);
      if (byName && byName.id !== user?.id) {
        // A real account already uses this handle; leave it alone and skip the seed player.
        skippedUsernames.push(spec.username);
        continue;
      }
      if (user) {
        clearSeedData(store, user, existingSeedIds, spec.isTester);
        if (user.displayName !== spec.username) store.updateDisplayName(user.id, spec.username);
        refreshedUsers += 1;
      } else {
        const createdAt = localMidnight(now, spec.createdDaysAgo) + intBetween(rngFor(seed, `created:${spec.username}`), 8, 22) * HOUR_MS;
        user = store.createUser({ id: createUserId(), email: spec.email, displayName: spec.username, passwordHash, avatarUrl: null, createdAt: Math.min(createdAt, now - HOUR_MS) });
        createdUsers += 1;
      }
      store.updateAvatarEmoji(user.id, spec.avatar);
      players.push({ spec, user: store.findUserById(user.id)! });
    }
    if (skippedUsernames.length > 0) log(`Skipped seed player(s) whose username a real account already has: ${skippedUsernames.join(", ")}`);
    const testerEntry = players.find((p) => p.spec.isTester);
    if (!testerEntry) throw new Error(`The username "${TEST_USER.username}" belongs to a non-seed account; rename it or use a fresh DATABASE_PATH.`);
    const others = players.filter((p) => !p.spec.isTester);
    const byName = new Map(players.map((p) => [p.spec.username, p]));

    // 2. Leaderboards.
    for (const board of SEED_BOARDS) {
      const label = boardLabel(board);
      if (normalizeLeaderboardVariant(board.gameMode, board.variant) !== board.variant) throw new Error(`Invalid seed board ${label}`);
      const rng = rngFor(seed, `board:${label}`);
      const entrants: { user: StoredUser; timeMs: number; achievedAt: number; createdDaysAgo: number }[] = [];
      for (const { spec, user } of others) {
        const joins = spec.username === SUSPICIOUS_PLAYER ? label === "codes" : rng() < board.popularity * (0.4 + spec.activity * 0.6);
        const timeMs = spec.username === SUSPICIOUS_PLAYER ? intBetween(rng, 6_000, 9_500) : boardTime(rng, board, spec.skill);
        const daysAgo = intBetween(rng, 0, Math.min(spec.createdDaysAgo, 90));
        if (joins) entrants.push({ user, timeMs, achievedAt: momentOn(rng, now, daysAgo), createdDaysAgo: spec.createdDaysAgo });
      }
      if (!TESTER_SKIPS.has(label)) {
        let timeMs = boardTime(rng, board, testerEntry.spec.skill);
        if (label === TESTER_PODIUM_BOARD) {
          const sorted = entrants.map((e) => e.timeMs).sort((a, b) => a - b);
          const faster = sorted[TESTER_PODIUM_RANK - 2] ?? board.fastMs;
          const slower = sorted[TESTER_PODIUM_RANK - 1] ?? faster + 20_000;
          timeMs = Math.round((faster + slower) / 2);
        }
        entrants.push({ user: testerEntry.user, timeMs, achievedAt: momentOn(rng, now, intBetween(rng, 0, 20)), createdDaysAgo: testerEntry.spec.createdDaysAgo });
      }
      for (const entry of entrants) {
        const result = store.submitBestTime(entry.user.id, { gameMode: board.gameMode, variant: board.variant, timeMs: entry.timeMs, achievedAt: entry.achievedAt });
        if (result.accepted) bestTimes += 1;
      }
      boardCounts.set(label, entrants.length);
    }

    for (const board of SEED_SCORE_BOARDS) {
      const label = boardLabel(board);
      if (normalizeLeaderboardVariant(board.gameMode, board.variant) !== board.variant) throw new Error(`Invalid seed board ${label}`);
      const maxScore = seedMaxScore(board);
      const rng = rngFor(seed, `board:${label}`);
      const entrants: { user: StoredUser; score: number; achievedAt: number }[] = [];
      for (const { spec, user } of others) {
        // The too-good-to-be-true player posts a perfect MapTap, so admin has a score to flag.
        const suspicious = spec.username === SUSPICIOUS_PLAYER;
        const joins = suspicious ? board.gameMode === "map-tap" : rng() < board.popularity * (0.4 + spec.activity * 0.6);
        const score = suspicious ? maxScore : boardScore(rng, board, spec.skill);
        const daysAgo = intBetween(rng, 0, Math.min(spec.createdDaysAgo, 90));
        if (joins) entrants.push({ user, score, achievedAt: momentOn(rng, now, daysAgo) });
      }
      if (!TESTER_SKIPS.has(label)) {
        let score = boardScore(rng, board, testerEntry.spec.skill);
        if (label === TESTER_SCORE_PODIUM_BOARD) {
          const sorted = entrants.map((e) => e.score).sort((a, b) => b - a);
          const higher = sorted[TESTER_PODIUM_RANK - 2] ?? maxScore;
          const lower = sorted[TESTER_PODIUM_RANK - 1] ?? Math.max(0, higher - 1_000);
          score = Math.floor((higher + lower) / 2);
        }
        entrants.push({ user: testerEntry.user, score, achievedAt: momentOn(rng, now, intBetween(rng, 0, 20)) });
      }
      for (const entry of entrants) {
        const result = store.submitBestScore(entry.user.id, { gameMode: board.gameMode, variant: board.variant, score: entry.score, achievedAt: entry.achievedAt });
        if (result.accepted) bestScores += 1;
      }
      boardCounts.set(label, entrants.length);
    }

    // 3. Daily challenge: the last 14 local days.
    const forcedToday = new Set<string>([...ACCEPTED_FRIENDS.slice(0, 4), SUSPICIOUS_PLAYER]);
    for (const { spec, user } of players) {
      const rng = rngFor(seed, `daily:${spec.username}`);
      for (let daysAgo = 0; daysAgo < DAILY_DAYS; daysAgo += 1) {
        if (daysAgo > spec.createdDaysAgo) continue;
        const plays = spec.isTester ? TESTER_DAILY_DAYS.includes(daysAgo) : (daysAgo === 0 && forcedToday.has(spec.username)) || rng() < spec.activity * 0.85;
        if (!plays) continue;
        const date = localDayKey(localMidnight(now, daysAgo) + 12 * HOUR_MS);
        const result = dailyResult(rng, spec.skill, date, momentOn(rng, now, daysAgo), spec.username === SUSPICIOUS_PLAYER && daysAgo === 0);
        store.saveDailyResult(user.id, result);
        dailyResults += 1;
        if (daysAgo === 0) dailyToday += 1;
      }
    }

    // 4. Game history and logins over the last 60 days, busier recently so the admin deltas trend up.
    for (const { spec, user } of players) {
      const rng = rngFor(seed, `games:${spec.username}`);
      const count = spec.isTester ? 55 : Math.round(spec.activity * between(rng, 12, 60));
      const times: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const daysAgo = Math.min(Math.floor(HISTORY_DAYS * rng() ** 1.5), spec.createdDaysAgo);
        times.push(momentOn(rng, now, daysAgo));
      }
      times.sort((a, b) => a - b);
      for (const playedAt of times) {
        store.recordGame(user.id, gameResult(rng, spec.skill), playedAt);
        games += 1;
      }
      if (spec.isTester) continue;
      // Sign-ins: a session on a few of the days they played (the tester gets a real one on login).
      const loginDays = new Set(times.filter((t) => t > now - 29 * DAY_MS && rng() < 0.35).map((t) => localDayKey(t)));
      for (const day of loginDays) {
        const createdAt = times.find((t) => localDayKey(t) === day)! - intBetween(rng, 1, 20) * MINUTE_MS;
        store.createSession({ id: createSessionToken(), userId: user.id, createdAt, expiresAt: createdAt + SESSION_TTL_MS });
        sessions += 1;
      }
    }

    // 5. Friends of the tester.
    const testerId = testerEntry.user.id;
    ACCEPTED_FRIENDS.forEach((name, index) => {
      const friend = byName.get(name);
      if (!friend) return;
      // Alternate who asked, as happens for real.
      if (index % 2 === 0) {
        store.sendFriendRequest(testerId, friend.user.id, now - (20 - index) * DAY_MS);
        store.acceptFriendRequest(friend.user.id, testerId, now - (19 - index) * DAY_MS);
      } else {
        store.sendFriendRequest(friend.user.id, testerId, now - (20 - index) * DAY_MS);
        store.acceptFriendRequest(testerId, friend.user.id, now - (19 - index) * DAY_MS);
      }
    });
    const incoming = byName.get(INCOMING_REQUEST);
    if (incoming) store.sendFriendRequest(incoming.user.id, testerId, now - 5 * HOUR_MS);
    const outgoing = byName.get(OUTGOING_REQUEST);
    if (outgoing) store.sendFriendRequest(testerId, outgoing.user.id, now - 2 * DAY_MS);

    // 6. Academy progress (validated with the same rules the sync endpoint applies).
    const academy = validateAcademyProgress(testerAcademy(seed, now), now);
    if (!academy.ok) throw new Error(`Seed Academy progress is invalid: ${academy.error}`);
    store.saveAcademyProgress(testerId, JSON.stringify(academy.progress), academy.progress.updatedAt);
    academyCards = Object.keys(academy.progress.cards).length;
    academyDue = Object.values(academy.progress.cards).filter((card) => card.box > 0 && card.dueAt <= now).length;

    // 7. Admin event log. The store has no way to delete events, so they're written once per
    // database (the sentinel event marks it) rather than piling up on every re-run.
    const alreadyLogged = store.listEvents({ level: null, action: null, ip: SENTINEL_IP, userId: null, before: null, limit: 1 }).length > 0;
    if (alreadyLogged) {
      eventsSkipped = true;
    } else {
      for (const event of adminEvents(seed, now, players)) {
        store.recordEvent(event);
        events += 1;
      }
    }

    // Summary for the tester.
    const friendRequests = store.listFriendRequests(testerId);
    const ranks = [
      ...SEED_BOARDS.map((board) => ({ board, rank: store.getUserRank(testerId, board.gameMode, board.variant) })),
      ...SEED_SCORE_BOARDS.map((board) => ({ board, rank: store.getUserScoreRank(testerId, board.gameMode, board.variant) })),
    ].flatMap(({ board, rank }) => (rank ? [{ board: boardLabel(board), rank: rank.rank, of: boardCounts.get(boardLabel(board)) ?? 0 }] : []));
    const dailyDates = store.listDailyResults(testerId, DAILY_DAYS).map((r) => r.date);
    tester = {
      id: testerId,
      username: TEST_USER.username,
      email: TEST_USER.email,
      password: TEST_USER.password,
      ranks,
      dailyStreak: consecutiveFromToday(dailyDates, now),
      dailyDates,
    };
    snippet = achievementsSnippet(dailyDates);
    friendsSummary = { accepted: store.listFriends(testerId).length, incoming: friendRequests.incoming.length, outgoing: friendRequests.outgoing.length };
  });

  return {
    seed,
    removedUsers,
    createdUsers,
    refreshedUsers,
    skippedUsernames,
    bestTimes,
    bestScores,
    boards: [...boardCounts.entries()].map(([board, entries]) => ({ board, entries })),
    dailyResults,
    dailyToday,
    games,
    sessions,
    friends: friendsSummary,
    academyCards,
    academyDue,
    events,
    eventsSkipped,
    tester,
    achievementsSnippet: snippet,
  };
}
