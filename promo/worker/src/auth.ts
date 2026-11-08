// Who's calling. Two kinds of credentials:
//   service token   "Bearer <PROMO_SERVICE_TOKEN>"            the Mac tools (npm run stage / queue / content / voices)
//   admin token     "Bearer adm.<payload>.<signature>"        minted by the game's admin for a signed-in admin, short-lived
// Admin token = "adm." + base64url(JSON {sub, name, exp}) + "." + base64url(HMAC-SHA256(PROMO_ADMIN_SECRET, <payload part>)).
// The game signs with the same secret (server/admin/promoToken.ts); that shared secret is the only link between the two.
export type Who = {kind: 'service' | 'admin'; name: string};

const enc = new TextEncoder();
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
}

export async function authenticate(req: Request, env: {PROMO_SERVICE_TOKEN?: string; PROMO_ADMIN_SECRET?: string}): Promise<Who | null> {
  const t = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!t) return null;
  if (t.startsWith('adm.')) {
    const [, payload, sig] = t.split('.');
    if (!payload || !sig || !env.PROMO_ADMIN_SECRET) return null;
    let ok = false;
    try {
      ok = await crypto.subtle.verify('HMAC', await hmacKey(env.PROMO_ADMIN_SECRET), fromB64url(sig), enc.encode(payload));
    } catch {
      return null;
    }
    if (!ok) return null;
    try {
      const p = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as {sub?: string; name?: string; exp?: number};
      if (!p.exp || p.exp * 1000 < Date.now()) return null;
      return {kind: 'admin', name: `admin:${p.name ?? p.sub ?? '?'}`};
    } catch {
      return null;
    }
  }
  const want = env.PROMO_SERVICE_TOKEN ?? '';
  const a = enc.encode(t), b = enc.encode(want);
  if (!want || a.length !== b.length) return null;
  // constant-time compare (a Workers extension to SubtleCrypto)
  return (crypto.subtle as unknown as {timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean}).timingSafeEqual(a, b) ? {kind: 'service', name: 'service'} : null;
}
