import { useEffect, useState } from "react";
import type { IpCountry } from "../../server/auth/types";

// One lookup for every address on screen: tags ask, and the next tick sends them all at once.
// Answers (including "unknown") are kept for the page's lifetime.
const known = new Map<string, IpCountry | null>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  flushTimer = null;
  const ips = [...waiting];
  waiting.clear();
  for (let start = 0; start < ips.length; start += 200) {
    const chunk = ips.slice(start, start + 200);
    try {
      const response = await fetch(`/api/admin/ip-countries?ips=${encodeURIComponent(chunk.join(","))}`, { credentials: "same-origin" });
      const data = response.ok ? ((await response.json()) as { countries: IpCountry[] }) : { countries: [] };
      for (const ip of chunk) known.set(ip, null);
      for (const entry of data.countries) known.set(entry.ip, entry);
    } catch {
      // Offline: leave them unasked so a later render tries again.
    }
  }
  for (const listener of [...listeners]) listener();
}

function request(ip: string): void {
  if (known.has(ip) || waiting.has(ip)) return;
  waiting.add(ip);
  flushTimer ??= setTimeout(() => void flush(), 0);
}

function useIpCountry(ip: string | null | undefined): IpCountry | null {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!ip || ip === "unknown") return;
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    request(ip);
    return () => { listeners.delete(listener); };
  }, [ip]);
  return ip ? known.get(ip) ?? null : null;
}

const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

export function countryName(code: string): string {
  if (code === "T1") return "Tor network";
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/**
 * The country beside an IP: Cloudflare's when the address has been seen since that was recorded,
 * else a "~" guess from the analytics country of the accounts that used it. Nothing when unknown.
 */
export function IpCountryTag({ ip }: { ip: string | null | undefined }) {
  const entry = useIpCountry(ip);
  if (!entry) return null;
  const guessed = entry.source === "account";
  const name = countryName(entry.country);
  return (
    <span
      className={`adm-ip-country${guessed ? " is-guess" : ""}`}
      title={guessed ? `Probably ${name}: guessed from the country of the account that used this address` : `${name} (Cloudflare)`}
    >
      <span aria-hidden>{flag(entry.country)}</span> {guessed ? "~" : ""}{entry.country}
      <span className="adm-sr-only">{guessed ? `, probably ${name}` : `, ${name}`}</span>
    </span>
  );
}
