import { createOAuthState } from "./tokens";

export const OAUTH_PROVIDERS: ReadonlySet<string> = new Set(["github", "google"]);

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthStateEntry {
  provider: string;
  expiresAt: number;
}

const stateStore = new Map<string, OAuthStateEntry>();

export function saveOAuthState(state: string, provider: string, now: number): void {
  stateStore.set(state, { provider, expiresAt: now + OAUTH_STATE_TTL_MS });
}

export function consumeOAuthState(state: string, now: number): string | null {
  const entry = stateStore.get(state);
  stateStore.delete(state);
  if (!entry || entry.expiresAt < now) return null;
  return entry.provider;
}

export function buildAuthUrl(
  provider: "github" | "google",
  state: string,
  baseUrl: string,
): string {
  if (provider === "github") {
    const clientId = process.env.GITHUB_CLIENT_ID ?? "";
    return (
      `https://github.com/login/oauth/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&scope=read:user+user:email` +
      `&state=${encodeURIComponent(state)}`
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const redirectUri = `${baseUrl}/auth/google/callback`;
  return (
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&scope=openid+email+profile` +
    `&state=${encodeURIComponent(state)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`
  );
}

export async function exchangeOAuthCode(
  provider: "github" | "google",
  code: string,
  baseUrl: string,
): Promise<{ id: string; email: string; displayName: string; avatarUrl: string | null }> {
  if (provider === "github") {
    return exchangeGitHub(code);
  }
  return exchangeGoogle(code, baseUrl);
}

async function exchangeGitHub(
  code: string,
): Promise<{ id: string; email: string; displayName: string; avatarUrl: string | null }> {
  const clientId = process.env.GITHUB_CLIENT_ID ?? "";
  const clientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenData.access_token;
  if (!accessToken) throw new Error("GitHub OAuth: no access_token in response");

  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    }),
    fetch("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    }),
  ]);

  const user = (await userRes.json()) as {
    id: number;
    login: string;
    name?: string | null;
    avatar_url?: string | null;
  };

  const emails = (await emailsRes.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;

  const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
  if (!primary) throw new Error("GitHub OAuth: no verified email");

  return {
    id: String(user.id),
    email: primary.email,
    displayName: user.name || user.login,
    avatarUrl: user.avatar_url ?? null,
  };
}

async function exchangeGoogle(
  code: string,
  baseUrl: string,
): Promise<{ id: string; email: string; displayName: string; avatarUrl: string | null }> {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = `${baseUrl}/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  const tokenData = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenData.access_token;
  if (!accessToken) throw new Error("Google OAuth: no access_token in response");

  const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const info = (await infoRes.json()) as {
    id: string;
    email: string;
    name?: string;
    picture?: string | null;
  };

  return {
    id: info.id,
    email: info.email,
    displayName: info.name ?? info.email,
    avatarUrl: info.picture ?? null,
  };
}
