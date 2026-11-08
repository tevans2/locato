// The only promo code in the game: lets a signed-in admin use the promo service (a separate Cloudflare Worker,
// promo/worker) from the admin page. The game mints a short-lived token signed with a secret the promo service
// shares; the browser then calls the promo service directly. The game never calls the promo service itself.
//   token = "adm." + base64url(JSON {sub, name, exp}) + "." + base64url(HMAC-SHA256(secret, <payload part>))
import { createHmac } from "node:crypto";

export interface PromoConfig {
  readonly apiUrl: string;
  readonly secret: string;
}

export const PROMO_TOKEN_TTL_SECONDS = 15 * 60;

/** Both PROMO_API_URL and PROMO_ADMIN_SECRET must be set; otherwise the Promo tab says it isn't configured. */
export function promoConfigFromEnv(env: Record<string, string | undefined> = process.env): PromoConfig | null {
  const apiUrl = env.PROMO_API_URL?.trim().replace(/\/$/, "");
  const secret = env.PROMO_ADMIN_SECRET?.trim();
  return apiUrl && secret ? { apiUrl, secret } : null;
}

export function mintPromoToken(secret: string, admin: { readonly id: string; readonly displayName: string }, now = Date.now(), ttlSeconds = PROMO_TOKEN_TTL_SECONDS): { token: string; expiresAt: number } {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ sub: admin.id, name: admin.displayName, exp })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `adm.${payload}.${signature}`, expiresAt: exp * 1000 };
}
