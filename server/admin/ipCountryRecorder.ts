import { clientIp, cloudflareCountry } from "../clientIp";
import type { UserStore } from "../auth/types";

// Cloudflare's codes: two letters, or T1 for Tor. XX means it doesn't know.
const COUNTRY = /^[A-Z][A-Z0-9]$/;
const MAX_REMEMBERED = 20_000;

/**
 * Remembers Cloudflare's country for each client address, so the admin console can label IPs.
 * Called on every request; it only writes when an address is new or its country changed, and
 * never throws into the request it's watching.
 */
export function createIpCountryRecorder(store: Pick<UserStore, "recordIpCountry">, clock: () => number = Date.now): (request: Request) => void {
  const written = new Map<string, string>();
  return (request) => {
    const country = cloudflareCountry(request)?.trim().toUpperCase();
    if (!country || country === "XX" || !COUNTRY.test(country)) return;
    const ip = clientIp(request);
    if (ip === "unknown" || written.get(ip) === country) return;
    if (written.size >= MAX_REMEMBERED) written.clear();
    written.set(ip, country);
    try {
      store.recordIpCountry(ip, country, clock());
    } catch {
      written.delete(ip);
    }
  };
}
