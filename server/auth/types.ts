// Public-facing user (never includes the password hash).
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: number;
}

export interface StoredUser extends AuthUser {
  readonly passwordHash: string;
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

export interface CreateUserInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly createdAt: number;
}

export interface CreateSessionInput {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly createdAt: number;
}

// Persistence boundary. Kept synchronous (bun:sqlite is sync) and storage-agnostic so the
// auth logic can be unit-tested against an in-memory store without pulling in bun:sqlite.
export interface UserStore {
  createUser(input: CreateUserInput): StoredUser;
  findUserByEmail(email: string): StoredUser | null;
  findUserById(id: string): StoredUser | null;
  createSession(input: CreateSessionInput): Session;
  findSession(id: string): Session | null;
  deleteSession(id: string): void;
  deleteExpiredSessions(now: number): void;
  getStats(userId: string): UserStats;
  recordGame(userId: string, result: GameResult): UserStats;
}

// Hashing boundary. The real implementation uses Bun.password (argon2id); tests inject a fake.
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}
