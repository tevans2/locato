// The caller's address. On Fly the edge proxy sets Fly-Client-IP itself, so a client can't spoof
// it; the first X-Forwarded-For entry is whatever the client sent and is only a local-dev fallback.
//
// With Cloudflare's proxy in front, Fly-Client-IP is a Cloudflare edge address and the visitor's
// real one is in CF-Connecting-IP. That header is only trusted when the connection really comes
// from Cloudflare, otherwise anyone could set it to dodge a ban or a rate limit.

// https://www.cloudflare.com/ips/ (published ranges; they change rarely).
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
  "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

function parseV4(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

function parseV6(ip: string): bigint | null {
  const lower = ip.toLowerCase();
  // An IPv4-mapped IPv6 address (::ffff:1.2.3.4) is really the IPv4 one.
  if (lower.includes(".")) return null;
  const halves = lower.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

type Range = { readonly base: bigint; readonly mask: bigint; readonly v6: boolean };

function range(cidr: string, v6: boolean): Range {
  const [ip, bits] = cidr.split("/") as [string, string];
  const width = v6 ? 128n : 32n;
  const prefix = BigInt(bits);
  const mask = ((1n << width) - 1n) ^ ((1n << (width - prefix)) - 1n);
  return { base: (v6 ? parseV6(ip) : parseV4(ip))! & mask, mask, v6 };
}

const CLOUDFLARE_RANGES: readonly Range[] = [...CLOUDFLARE_V4.map((cidr) => range(cidr, false)), ...CLOUDFLARE_V6.map((cidr) => range(cidr, true))];

/** Whether `ip` is one of Cloudflare's edge addresses. */
export function isCloudflareIp(ip: string): boolean {
  const mapped = ip.toLowerCase().startsWith("::ffff:") ? ip.slice(7) : ip;
  const v4 = parseV4(mapped);
  const v6 = v4 === null ? parseV6(mapped) : null;
  if (v4 === null && v6 === null) return false;
  return CLOUDFLARE_RANGES.some((r) => (r.v6 ? v6 !== null && (v6 & r.mask) === r.base : v4 !== null && (v4 & r.mask) === r.base));
}

/** True when this request reached Fly through Cloudflare's proxy. */
export function viaCloudflare(request: Request): boolean {
  const edge = request.headers.get("fly-client-ip")?.trim();
  return Boolean(edge && isCloudflareIp(edge));
}

export function clientIp(request: Request): string {
  const flyIp = request.headers.get("fly-client-ip")?.trim();
  if (flyIp && isCloudflareIp(flyIp)) {
    const visitor = request.headers.get("cf-connecting-ip")?.trim();
    if (visitor) return visitor;
  }
  return flyIp || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Cloudflare's country for the visitor, only when the request really came through Cloudflare. */
export function cloudflareCountry(request: Request): string | null {
  return viaCloudflare(request) ? request.headers.get("cf-ipcountry") : null;
}
