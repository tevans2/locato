export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly avatarEmoji: string | null;
  readonly createdAt: number;
}

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

export interface UserStore {
  createUser(input: CreateUserInput): StoredUser;
  findUserByEmail(email: string): StoredUser | null;
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
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}
