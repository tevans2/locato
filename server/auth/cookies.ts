export const SESSION_COOKIE_NAME = "locato_session";

export interface CookieOptions {
  readonly secure: boolean;
}

export function parseCookieHeader(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function readSessionToken(request: Request): string | null {
  return parseCookieHeader(request.headers.get("cookie"))[SESSION_COOKIE_NAME] ?? null;
}

export function serializeSessionCookie(token: string, maxAgeSeconds: number, options: CookieOptions): string {
  const attributes = [`${SESSION_COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function serializeClearCookie(options: CookieOptions): string {
  const attributes = [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}
