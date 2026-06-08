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
  private readonly ttlMs: number;

  constructor(
    private readonly store: UserStore,
    private readonly hasher: PasswordHasher,
    private readonly options: AuthServiceOptions,
  ) {
    this.clock = options.clock ?? (() => Date.now());
    this.ttlMs = options.sessionTtlMs;
  }

  get sessionMaxAgeSeconds(): number {
    return Math.floor(this.ttlMs / 1000);
  }

  async register(input: { email?: unknown; password?: unknown; displayName?: unknown }): Promise<AuthOutcome> {
    const email = normalizeEmail(input.email);
    if (!email) return { ok: false, status: 400, error: "A valid email address is required." };

    const password = typeof input.password === "string" ? input.password : "";
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return { ok: false, status: 400, error: `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters.` };
    }

    if (this.store.findUserByEmail(email)) return { ok: false, status: 409, error: "An account with that email already exists." };

    const displayName = normalizeDisplayName(input.displayName, email.split("@")[0] ?? "Player");
    const now = this.clock();
    const passwordHash = await this.hasher.hash(password);
    const user = this.store.createUser({ id: createUserId(), email, displayName, passwordHash, avatarUrl: null, createdAt: now });
    return { ok: true, user: this.toAuthUser(user), session: this.openSession(user.id, now) };
  }

  async login(input: { email?: unknown; password?: unknown }): Promise<AuthOutcome> {
    const invalid = { ok: false, status: 401, error: "Invalid email or password." } as const;
    const email = normalizeEmail(input.email);
    const password = typeof input.password === "string" ? input.password : "";
    if (!email || password.length === 0) return invalid;

    const user = this.store.findUserByEmail(email);
    if (!user) return invalid;
    if (user.passwordHash === null) return { ok: false, status: 401, error: "Sign in with your OAuth provider." };
    if (!(await this.hasher.verify(password, user.passwordHash))) return invalid;

    return { ok: true, user: this.toAuthUser(user), session: this.openSession(user.id, this.clock()) };
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
    return user ? this.toAuthUser(user) : null;
  }

  upsertOAuthUser(
    provider: string,
    providerId: string,
    profile: { email: string; displayName: string; avatarUrl?: string | null },
  ): AuthUser {
    const existing = this.store.findUserByOAuth(provider, providerId);
    if (existing) return this.toAuthUser(existing);

    const byEmail = this.store.findUserByEmail(profile.email);
    if (byEmail) {
      this.store.linkOAuthAccount(byEmail.id, provider, providerId);
      return this.toAuthUser(byEmail);
    }

    const now = this.clock();
    const user = this.store.createUser({
      id: createUserId(),
      email: profile.email,
      displayName: profile.displayName,
      passwordHash: null,
      avatarUrl: profile.avatarUrl ?? null,
      createdAt: now,
    });
    this.store.linkOAuthAccount(user.id, provider, providerId);
    return this.toAuthUser(user);
  }

  getStats(userId: string): UserStats {
    return this.store.getStats(userId);
  }

  recordGame(userId: string, result: GameResult): UserStats {
    return this.store.recordGame(userId, result);
  }

  updateAvatarEmoji(userId: string, emoji: string | null): void {
    this.store.updateAvatarEmoji(userId, emoji);
  }

  pruneExpiredSessions(): void {
    this.store.deleteExpiredSessions(this.clock());
  }

  // Public so OAuth callbacks can open a session for a user they just upserted.
  createSessionFor(userId: string): Session {
    return this.openSession(userId, this.clock());
  }

  private openSession(userId: string, now: number): Session {
    return this.store.createSession({ id: createSessionToken(), userId, expiresAt: now + this.ttlMs, createdAt: now });
  }

  private toAuthUser(user: StoredUser): AuthUser {
    return { id: user.id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, avatarEmoji: user.avatarEmoji, createdAt: user.createdAt };
  }
}
