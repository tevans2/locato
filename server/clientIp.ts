// The caller's address. On Fly the edge proxy sets Fly-Client-IP itself, so a client can't spoof
// it; the first X-Forwarded-For entry is whatever the client sent and is only a local-dev fallback.
export function clientIp(request: Request): string {
  return request.headers.get("fly-client-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
