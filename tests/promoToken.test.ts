import { describe, expect, it } from "vitest";
import { mintPromoToken, promoConfigFromEnv } from "../server/admin/promoToken";
// The promo service's own check: the token format is a contract between the two, so test them together.
import { authenticate } from "../promo/worker/src/auth";

const SECRET = "test-secret-for-promo-tokens";
const admin = { id: "u1", displayName: "Tate" };
const request = (token: string) => new Request("https://promo.example/me", { headers: { authorization: `Bearer ${token}` } });

describe("promo admin tokens", () => {
  it("are accepted by the promo service while fresh", async () => {
    const { token, expiresAt } = mintPromoToken(SECRET, admin);
    expect(token.startsWith("adm.")).toBe(true);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(await authenticate(request(token), { PROMO_ADMIN_SECRET: SECRET })).toEqual({ kind: "admin", name: "admin:Tate" });
  });

  it("are refused once expired, when tampered with, or signed with another secret", async () => {
    const expired = mintPromoToken(SECRET, admin, Date.now() - 3_600_000).token;
    expect(await authenticate(request(expired), { PROMO_ADMIN_SECRET: SECRET })).toBeNull();
    const { token } = mintPromoToken(SECRET, admin);
    const [, payload = "", sig = ""] = token.split(".");
    const forged = `adm.${Buffer.from(JSON.stringify({ sub: "u1", name: "Tate", exp: 9_999_999_999 })).toString("base64url")}.${sig}`;
    expect(await authenticate(request(forged), { PROMO_ADMIN_SECRET: SECRET })).toBeNull();
    expect(await authenticate(request(`adm.${payload}.${sig.slice(0, -2)}xx`), { PROMO_ADMIN_SECRET: SECRET })).toBeNull();
    expect(await authenticate(request(token), { PROMO_ADMIN_SECRET: "another-secret" })).toBeNull();
  });

  it("need both settings to be configured", () => {
    expect(promoConfigFromEnv({})).toBeNull();
    expect(promoConfigFromEnv({ PROMO_API_URL: "https://promo.locato.quest/" })).toBeNull();
    expect(promoConfigFromEnv({ PROMO_API_URL: "https://promo.locato.quest/", PROMO_ADMIN_SECRET: "s" })).toEqual({ apiUrl: "https://promo.locato.quest", secret: "s" });
  });
});
