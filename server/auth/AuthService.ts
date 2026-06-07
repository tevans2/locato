import { createSessionToken, createUserId } from "./tokens";
import type { AuthUser, GameResult, PasswordHasher, Session, StoredUser, UserStats, UserStore } from "./types";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const MAX_DISPLAY_NAME_LENGTH = 32;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthServiceOptions {
  readonly sessionTtlMs: number;
  readonly clock?: () => number;
}

export type AuthOutcome =
  | { readonly ok: true; readonly user: AuthUser; readonly session: Session }
  | { readonly ok: false; readonly status: number; readonly error: string };

function toAuthUser(user: StoredUser): AuthUser {
  return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt };
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email) ? email : null;
}

function normalizeDisplayName(value: unknown, fallback: string): string {
  const name = (typeof value === "string" ? value.trim() : "") || fallback;
  return name.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

export class AuthService {
  private readonly clock: () => number;

  constructor(
    private readonly store: UserStore,
    private readonly hasher: PasswordHasher,
    private readonly options: AuthServiceOptions,
  ) {
    this.clock = options.clock ?? (() => Date.now());
  }

  get sessionMaxAgeSeconds(): number {
    return Math.floor(this.options.sessionTtlMs / 1000);
  }

  async register(input: { email?: unknown; password?: unknown; displayName?: unknown }): Promise<AuthOutcome> {
    const email = normalizeEmail(input.email);
    if (!email) return { ok: false, status: 400, error: "A valid email address is required." };

    const password = typeof input.password === "string" ? input.password : "";
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return { ok: false, status: 400, error: `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.` };
    }

    if (this.store.findUserByEmail(email)) return { ok: false, status: 409, error: "An account with that email already exists." };

    const displayName = normalizeDisplayName(input.displayName, email.split("@")[0] ?? "Player");
    const now = this.clock();
    const passwordHash = await this.hasher.hash(password);
    const user = this.store.createUser({ id: createUserId(), email, displayName, passwordHash, createdAt: now });
    return { ok: true, user: toAuthUser(user), session: this.openSession(user.id, now) };
  }

  async login(input: { email?: unknown; password?: unknown }): Promise<AuthOutcome> {
    const invalid = { ok: false, status: 401, error: "Invalid email or password." } as const;
    const email = normalizeEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    if (!email || password.length === 0) return invalid;

    const user = this.store.findUserByEmail(email);
    if (!user) return invalid;
    if (!(await this.hasher.verify(password, user.passwordHash))) return invalid;

    return { ok: true, user: toAuthUser(user), session: this.openSession(user.id, this.clock()) };
  }

  logout(token: string | null): void {
    if (token) this.store.deleteSession(token);
  }

  authenticate(token: string | null): AuthUser | null {
    if (!token) return null;
    const session = this.store.findSession(token);
    if (!session) return null;
    if (session.expiresAt <= this.clock()) {
      this.store.deleteSession(token);
      return null;
    }
    const user = this.store.findUserById(session.userId);
    return user ? toAuthUser(user) : null;
  }

  getStats(userId: string): UserStats {
    return this.store.getStats(userId);
  }

  recordGame(userId: string, result: GameResult): UserStats {
    return this.store.recordGame(userId, result);
  }

  pruneExpiredSessions(): void {
    this.store.deleteExpiredSessions(this.clock());
  }

  private openSession(userId: string, now: number): Session {
    return this.store.createSession({ id: createSessionToken(), userId, expiresAt: now + this.options.sessionTtlMs, createdAt: now });
  }
}
