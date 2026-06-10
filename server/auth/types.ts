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

export interface UserStats {
  readonly games: number;
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly bestStreak: number;
}

export interface GameResult {
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly bestStreak: number;
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

// Admin account controls. Never carries password hashes.
export interface AdminUserSummary {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarEmoji: string | null;
  readonly hasPassword: boolean;
  readonly createdAt: number;
  readonly games: number;
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

// Persistence boundary — synchronous (bun:sqlite is sync) and storage-agnostic so auth logic
// can be unit-tested against an in-memory store without importing bun:sqlite.
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
  recordGame(userId: string, result: GameResult): UserStats;
  submitBestTime(userId: string, input: SubmitBestTimeInput): SubmitBestTimeResult;
  getLeaderboard(query: LeaderboardQuery): readonly LeaderboardEntry[];
  getUserRank(userId: string, gameMode: string, variant: string): UserLeaderboardRank | null;
  // Admin account controls.
  listUsers(query: AdminUserListQuery): AdminUserList;
  deleteUser(id: string): boolean;
  deleteUserSessions(userId: string): number;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}
