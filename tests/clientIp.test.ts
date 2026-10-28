import { describe, expect, it } from "vitest";
import { clientIp, cloudflareCountry, isCloudflareIp } from "../server/clientIp";

const request = (headers: Record<string, string>) => new Request("https://locato.quest/", { headers });

describe("client IP behind Cloudflare", () => {
  it("recognises Cloudflare edge addresses, IPv4 and IPv6", () => {
    expect(isCloudflareIp("172.70.1.2")).toBe(true);
    expect(isCloudflareIp("104.16.0.1")).toBe(true);
    expect(isCloudflareIp("::ffff:162.158.10.1")).toBe(true);
    expect(isCloudflareIp("2a06:98c0:3600::103")).toBe(true);
    expect(isCloudflareIp("2606:4700:10::ac43:1")).toBe(true);
    expect(isCloudflareIp("41.76.35.247")).toBe(false);
    expect(isCloudflareIp("2001:db8::1")).toBe(false);
    expect(isCloudflareIp("not an ip")).toBe(false);
  });

  it("uses CF-Connecting-IP only when the connection came from Cloudflare", () => {
    expect(clientIp(request({ "fly-client-ip": "172.70.1.2", "cf-connecting-ip": "41.76.35.247" }))).toBe("41.76.35.247");
    // Straight to Fly: a forged header is ignored.
    expect(clientIp(request({ "fly-client-ip": "41.76.35.247", "cf-connecting-ip": "1.2.3.4" }))).toBe("41.76.35.247");
    expect(clientIp(request({ "fly-client-ip": "41.76.35.247" }))).toBe("41.76.35.247");
    expect(clientIp(request({ "x-forwarded-for": "10.0.0.1, 10.0.0.2" }))).toBe("10.0.0.1");
  });

  it("trusts CF-IPCountry only through Cloudflare", () => {
    expect(cloudflareCountry(request({ "fly-client-ip": "172.70.1.2", "cf-ipcountry": "ZA" }))).toBe("ZA");
    expect(cloudflareCountry(request({ "fly-client-ip": "41.76.35.247", "cf-ipcountry": "ZA" }))).toBeNull();
  });
});
