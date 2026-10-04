import type { RunFlag, RunOutcome, RunTimeline, RunVerdict } from "../../src/core/runAudit";

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly avatarEmoji: string | null;
  readonly createdAt: number;
}

// Public-safe projection of a user — never carries email or password hash.
export interface PublicUser {
  readonly id: string;
  readonly username: string;
  readonly avatarEmoji: string | null;
}

export interface FriendRequestEntry {
  readonly user: PublicUser;
  readonly createdAt: number;
}

export interface FriendRequestLists {
  readonly incoming: readonly FriendRequestEntry[];
  readonly outgoing: readonly FriendRequestEntry[];
}

export type SendFriendRequestResult = "requested" | "accepted" | "exists" | "not-found" | "self";

export interface StoredUser extends AuthUser {
  readonly passwordHash: string | null;
}

export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly createdAt: number;
}

// Submitted at the end of every game (solo, multiplayer, or world-map).
export interface GameResult {
  readonly mode: "solo" | "multiplayer" | "world-map";
  readonly categoryIds: readonly string[];
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly score: number;
  readonly bestStreak: number;
  readonly rank?: number;        // multiplayer: 1 = win
  readonly totalPlayers?: number;
  // world-map only:
  readonly durationMs?: number;  // completed timed run time; absent/0 otherwise
  readonly completed?: boolean;  // whether the run reached its target
  readonly countriesFound?: number;
  readonly countriesTotal?: number;
  readonly playMode?: string;    // "name-all" | "click-country" | "puzzle"
}

export interface CategoryStats {
  readonly categoryId: string;
  readonly correct: number;
  readonly wrong: number;
}

export interface GameRecord {
  readonly id: string;
  readonly mode: "solo" | "multiplayer" | "world-map";
  readonly categoryIds: readonly string[];
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly score: number;
  readonly bestStreak: number;
  readonly rank: number | null;
  readonly totalPlayers: number | null;
  readonly playedAt: number;
  // world-map only (null for solo/multiplayer rows):
  readonly durationMs: number | null;
  readonly completed: boolean | null;
  readonly countriesFound: number | null;
  readonly countriesTotal: number | null;
  readonly playMode: string | null;
}

export type DailyRoundMark = "correct" | "hint" | "miss";

export interface DailyChallengeResult {
  readonly date: string;
  readonly seed: string;
  readonly score: number;
  readonly timeMs: number;
  readonly hintsUsed: number;
  readonly marks: readonly DailyRoundMark[];
  readonly shareText: string;
  readonly completedAt: number;
  readonly challengeVersion?: 2;
  readonly rounds?: readonly import("../../src/core/dailyChallenge").DailyRoundResult[];
}

export interface DailyFriendResult {
  readonly user: PublicUser;
  readonly result: DailyChallengeResult;
}

export interface DailyLeaderboardEntry {
  readonly rank: number;
  readonly user: PublicUser;
  readonly result: DailyChallengeResult;
}

export interface DailySummary {
  readonly history: readonly DailyChallengeResult[];
  readonly streak: number;
  readonly best: DailyChallengeResult | null;
  readonly friendsToday: readonly DailyFriendResult[];
}

// Flat aggregate returned by /auth/me (fast, no joins).
export interface UserStats {
  readonly totalGames: number;
  readonly totalCorrect: number;
  readonly totalWrong: number;
  readonly bestStreak: number;
  readonly soloGames: number;
  readonly soloCorrect: number;
  readonly soloWrong: number;
  readonly soloBestStreak: number;
  readonly multiplayerGames: number;
  readonly multiplayerWins: number;
  readonly multiplayerCorrect: number;
  readonly multiplayerWrong: number;
  readonly multiplayerBestStreak: number;
  readonly worldMapGames: number;
  readonly worldMapCompletions: number;
  readonly worldBestTimeMs: number;   // 0 = no completed timed run yet
  readonly worldBestCountries: number; // max countries found in a single full-world run
}

// Richer object returned by /api/stats — includes per-category + history.
export interface FullStats extends UserStats {
  readonly categories: readonly CategoryStats[];
  readonly recentGames: readonly GameRecord[];
}

export interface SubmitBestTimeInput {
  readonly gameMode: string;
  readonly variant: string;
  readonly timeMs: number;
  readonly achievedAt: number;
}

export interface SubmitBestTimeResult {
  readonly accepted: boolean;
  readonly isPersonalBest: boolean;
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarEmoji: string | null;
  readonly timeMs: number;
  readonly achievedAt: number;
}

// Score boards (highest score wins; ties go to whoever got there first).
export interface SubmitBestScoreInput {
  readonly gameMode: string;
  readonly variant: string;
  readonly score: number;
  readonly achievedAt: number;
}

export interface LeaderboardScoreEntry {
  readonly rank: number;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarEmoji: string | null;
  readonly score: number;
  readonly achievedAt: number;
}

export interface UserLeaderboardScoreRank {
  readonly rank: number;
  readonly score: number;
}

export interface LeaderboardQuery {
  readonly gameMode: string;
  readonly variant: string;
  readonly limit: number;
  readonly offset: number;
}

export interface UserLeaderboardRank {
  readonly rank: number;
  readonly timeMs: number;
}

/** Where a time would sit on a board: `rank` is 1 + the number of strictly faster best times. */
export interface LeaderboardTimePlacement {
  readonly rank: number;
  /** Players with a time on this board. */
  readonly total: number;
}

// Admin account controls. Never carries password hashes.
export interface AdminUserSummary {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarEmoji: string | null;
  readonly hasPassword: boolean;
  readonly providers: readonly string[];
  readonly createdAt: number;
  readonly games: number;
  readonly dailies: number;
  // Latest game, daily, or login; null when the account has never been used since signup.
  readonly lastActiveAt: number | null;
  readonly admin: AdminAccess;
  readonly banned: boolean;
}

/** An account ban. Banned accounts can't sign in and drop off every leaderboard; nothing is deleted. */
export interface UserBan {
  readonly bannedAt: number;
  readonly reason: string | null;
  /** The admin who banned them. */
  readonly bannedBy: string | null;
}

export interface BannedUser extends UserBan {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

/** Requests from this address get a 403 on sign-in, sign-up, the API and multiplayer. */
export interface IpBan {
  readonly ip: string;
  readonly reason: string | null;
  readonly createdAt: number;
  /** null = until lifted. */
  readonly expiresAt: number | null;
  readonly createdBy: string | null;
}

// Why an account can use the admin console: listed in ADMIN_EMAILS ("config", can't be revoked
// from the console) or granted by another admin ("granted"). null = not an admin.
export type AdminAccess = "config" | "granted" | null;

// Session tokens are credentials, so admin views only ever see their timestamps.
export interface AdminSessionInfo {
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface AdminBestTime {
  readonly gameMode: string;
  readonly variant: string;
  readonly timeMs: number;
  readonly achievedAt: number;
}

export interface AdminBestScore {
  readonly gameMode: string;
  readonly variant: string;
  readonly score: number;
  readonly achievedAt: number;
}

// Raw activity rows since a cutoff; the service aggregates them into the overview.
export interface AdminActivityRows {
  readonly signups: readonly { readonly userId: string; readonly at: number }[];
  readonly games: readonly { readonly userId: string; readonly mode: string; readonly playMode: string | null; readonly at: number }[];
  readonly dailies: readonly { readonly userId: string; readonly at: number }[];
  readonly logins: readonly { readonly userId: string; readonly at: number }[];
}

export interface AdminTotals {
  readonly users: number;
  readonly games: number;
  readonly dailies: number;
  readonly bestTimes: number;
  readonly bestScores: number;
  readonly activeSessions: number;
  readonly friendships: number;
}

export type AdminEventLevel = "info" | "warn";

export interface AdminEvent {
  readonly id: number;
  readonly time: number;
  readonly level: AdminEventLevel;
  readonly action: string;
  readonly ip: string | null;
  readonly userId: string | null;
  readonly details: Record<string, unknown>;
}

export interface AdminEventInput {
  readonly time: number;
  readonly level: AdminEventLevel;
  readonly action: string;
  readonly ip: string | null;
  readonly userId: string | null;
  readonly details: Record<string, unknown>;
}

export interface AdminEventQuery {
  readonly level: AdminEventLevel | null;
  // Prefix match, so "admin." or "oauth" narrows to a family of actions.
  readonly action: string | null;
  readonly ip: string | null;
  readonly userId: string | null;
  readonly before: number | null;
  readonly limit: number;
}

export interface AdminUserListQuery {
  readonly query: string | null;
  readonly limit: number;
  readonly offset: number;
}

export interface AdminUserList {
  readonly users: readonly AdminUserSummary[];
  readonly total: number;
}

export interface CreateUserInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string | null;
  readonly avatarUrl: string | null;
  readonly createdAt: number;
}

export interface CreateSessionInput {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly createdAt: number;
}

// Academy training progress as stored: the validated AcademyProgress JSON plus its merged updatedAt.
export interface StoredAcademyProgress {
  readonly progress: string;
  readonly updatedAt: number;
}

// A run the server issued a ticket for (or saw posted without one): how it was played, the
// checks it raised, and whether it reached the board. See src/core/runAudit.
export interface StoredRun {
  readonly id: string;
  readonly userId: string;
  readonly gameMode: string;
  readonly variant: string;
  readonly timed: boolean;
  /** Server time the ticket was issued (the run's first move). */
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly outcome: RunOutcome | null;
  readonly claimedMs: number | null;
  readonly countries: number;
  readonly timeline: RunTimeline | null;
  readonly flags: readonly RunFlag[];
  readonly verdict: RunVerdict | null;
  /** Posted to the leaderboard (accepted or refused). */
  readonly posted: boolean;
  /** The post was refused because the run failed a hard check. */
  readonly refused: boolean;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface CreateRunInput {
  readonly id: string;
  readonly userId: string;
  readonly gameMode: string;
  readonly variant: string;
  readonly timed: boolean;
  readonly startedAt: number;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface FinishRunInput {
  readonly finishedAt: number;
  readonly outcome: RunOutcome;
  readonly claimedMs: number | null;
  readonly countries: number;
  readonly timeline: RunTimeline | null;
  readonly flags: readonly RunFlag[];
  readonly verdict: RunVerdict;
  readonly posted: boolean;
  readonly refused: boolean;
}

export interface UserStore {
  createUser(input: CreateUserInput): StoredUser;
  findUserByEmail(email: string): StoredUser | null;
  findUserByUsername(username: string): StoredUser | null;
  findUserById(id: string): StoredUser | null;
  findUserByOAuth(provider: string, providerId: string): StoredUser | null;
  linkOAuthAccount(userId: string, provider: string, providerId: string): void;
  updateAvatarEmoji(userId: string, emoji: string | null): void;
  createSession(input: CreateSessionInput): Session;
  findSession(id: string): Session | null;
  deleteSession(id: string): void;
  deleteExpiredSessions(now: number): void;
  getStats(userId: string): UserStats;
  getFullStats(userId: string): FullStats;
  recordGame(userId: string, result: GameResult, now: number): UserStats;
  getDailyResult(userId: string, date: string): DailyChallengeResult | null;
  listDailyResults(userId: string, limit: number): readonly DailyChallengeResult[];
  listDailyResultsForUsers(userIds: readonly string[], date: string): readonly { readonly userId: string; readonly result: DailyChallengeResult }[];
  listDailyResultsForDate(date: string): readonly { readonly userId: string; readonly result: DailyChallengeResult }[];
  saveDailyResult(userId: string, result: DailyChallengeResult): DailyChallengeResult;
  submitBestTime(userId: string, input: SubmitBestTimeInput): SubmitBestTimeResult;
  getLeaderboard(query: LeaderboardQuery): readonly LeaderboardEntry[];
  getUserRank(userId: string, gameMode: string, variant: string): UserLeaderboardRank | null;
  getTimePlacement(gameMode: string, variant: string, timeMs: number): LeaderboardTimePlacement;
  // Score boards: one best (highest) score per user per mode + variant.
  submitBestScore(userId: string, input: SubmitBestScoreInput): SubmitBestTimeResult;
  getScoreLeaderboard(query: LeaderboardQuery): readonly LeaderboardScoreEntry[];
  getUserScoreRank(userId: string, gameMode: string, variant: string): UserLeaderboardScoreRank | null;
  /** `rank` is 1 + the number of strictly higher best scores. */
  getScorePlacement(gameMode: string, variant: string, score: number): LeaderboardTimePlacement;
  // Admin account controls.
  listUsers(query: AdminUserListQuery): AdminUserList;
  /** The admin flag granted from the console (ADMIN_EMAILS is applied on top, in AdminService). */
  isAdmin(userId: string): boolean;
  setAdmin(userId: string, admin: boolean): void;
  // Bans.
  getUserBan(userId: string): UserBan | null;
  setUserBan(userId: string, ban: UserBan | null): void;
  listBannedUsers(): readonly BannedUser[];
  /** The ban covering this address right now (expired bans don't count). */
  findIpBan(ip: string, now: number): IpBan | null;
  listIpBans(now: number): readonly IpBan[];
  saveIpBan(ban: IpBan): void;
  deleteIpBan(ip: string): boolean;
  deleteUser(id: string): boolean;
  deleteUserSessions(userId: string): number;
  updateDisplayName(userId: string, displayName: string): void;
  listUserSessions(userId: string, now: number): readonly AdminSessionInfo[];
  listUserProviders(userId: string): readonly string[];
  listUserBestTimes(userId: string): readonly AdminBestTime[];
  deleteBestTime(userId: string, gameMode: string, variant: string): boolean;
  listUserBestScores(userId: string): readonly AdminBestScore[];
  deleteBestScore(userId: string, gameMode: string, variant: string): boolean;
  deleteDailyResult(userId: string, date: string): boolean;
  // Clears game history, per-category stats, and aggregates; leaderboards, dailies and Academy
  // progress are untouched.
  resetUserStats(userId: string): void;
  getAdminTotals(now: number): AdminTotals;
  listActivitySince(since: number): AdminActivityRows;
  // Admin event log (durable audit trail of the structured server log).
  recordEvent(event: AdminEventInput): void;
  listEvents(query: AdminEventQuery): readonly AdminEvent[];
  pruneEvents(before: number): number;
  // Friends.
  sendFriendRequest(requesterId: string, addresseeId: string, now: number): SendFriendRequestResult;
  acceptFriendRequest(userId: string, requesterId: string, now: number): boolean;
  removeFriendship(userId: string, otherId: string): boolean;
  listFriends(userId: string): readonly PublicUser[];
  listFriendRequests(userId: string): FriendRequestLists;
  areFriends(a: string, b: string): boolean;
  friendIds(userId: string): readonly string[];
  searchUsers(query: string, excludeId: string, limit: number): readonly PublicUser[];
  // Run audit trail (src/core/runAudit); deleted with the user.
  createRun(input: CreateRunInput): void;
  findRun(id: string): StoredRun | null;
  finishRun(id: string, input: FinishRunInput): void;
  listUserRuns(userId: string, limit: number): readonly StoredRun[];
  /** Finished runs that raised a flag, newest first. */
  listFlaggedRuns(limit: number): readonly StoredRun[];
  /** Did another of the user's runs start before `startedAt` and finish after it? */
  hasOverlappingRun(userId: string, runId: string, startedAt: number): boolean;
  // Academy (training) progress, one JSON blob per user; deleted with the user.
  getAcademyProgress(userId: string): StoredAcademyProgress | null;
  saveAcademyProgress(userId: string, progress: string, updatedAt: number): void;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}
