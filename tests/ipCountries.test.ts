import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdminService } from "../server/admin/AdminService";
import { createIpCountryRecorder } from "../server/admin/ipCountryRecorder";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { openDatabase, SqliteUserStore } from "../server/db/database";
import { SqliteAnalyticsStore } from "../server/analytics/sqliteStore";

// 172.70.x is a Cloudflare edge, so its forwarded visitor address and country are trusted.
function viaCloudflare(visitor: string, country: string): Request {
  return new Request("https://locato.test/", { headers: { "fly-client-ip": "172.70.1.2", "cf-connecting-ip": visitor, "cf-ipcountry": country } });
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("IP country recorder", () => {
  it("stores Cloudflare's country once per address, and again only when it changes", () => {
    const store = { recordIpCountry: vi.fn() };
    const record = createIpCountryRecorder(store, () => 1000);
    record(viaCloudflare("82.12.43.177", "gb"));
    record(viaCloudflare("82.12.43.177", "GB"));
    expect(store.recordIpCountry).toHaveBeenCalledTimes(1);
    expect(store.recordIpCountry).toHaveBeenCalledWith("82.12.43.177", "GB", 1000);
    record(viaCloudflare("82.12.43.177", "FR"));
    expect(store.recordIpCountry).toHaveBeenLastCalledWith("82.12.43.177", "FR", 1000);
  });

  it("ignores unknown countries and headers that didn't come through Cloudflare", () => {
    const store = { recordIpCountry: vi.fn() };
    const record = createIpCountryRecorder(store);
    record(viaCloudflare("82.12.43.177", "XX"));
    record(new Request("https://locato.test/", { headers: { "fly-client-ip": "41.76.35.247", "cf-ipcountry": "US" } }));
    expect(store.recordIpCountry).not.toHaveBeenCalled();
  });

  it("never throws into the request when the write fails", () => {
    const record = createIpCountryRecorder({ recordIpCountry: () => { throw new Error("disk full"); } });
    expect(() => record(viaCloudflare("82.12.43.177", "GB"))).not.toThrow();
  });
});

describe("IP country lookup", () => {
  it("uses Cloudflare's country, else guesses from the analytics country of the accounts that used the address", () => {
    const dir = mkdtempSync(join(tmpdir(), "locato-ipc-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "locato.db"));
    const store = new SqliteUserStore(db);
    new SqliteAnalyticsStore(db);
    db.query("INSERT INTO analytics_visitors (visitor_id, first_seen_at, first_day, last_seen_at, country, user_id) VALUES ('v1', 0, '2026-10-01', 0, 'CA', 'u1')").run();
    store.recordEvent({ time: 1, level: "info", action: "login.ok", ip: "2604:3d09::1", userId: "u1", details: {} });
    store.recordEvent({ time: 2, level: "info", action: "login.ok", ip: "82.12.43.177", userId: "u1", details: {} });
    store.recordIpCountry("82.12.43.177", "GB", 3);

    const byIp = new Map(store.findIpCountries(["2604:3d09::1", "82.12.43.177", "198.51.100.9"]).map((entry) => [entry.ip, entry]));
    expect(byIp.get("82.12.43.177")).toEqual({ ip: "82.12.43.177", country: "GB", source: "cloudflare" });
    expect(byIp.get("2604:3d09::1")).toEqual({ ip: "2604:3d09::1", country: "CA", source: "account" });
    expect(byIp.has("198.51.100.9")).toBe(false);
  });

  it("takes a comma-separated list in the admin service and skips anything that isn't an IP", () => {
    const store = createMemoryUserStore();
    store.recordIpCountry("82.12.43.177", "GB", 1);
    const admin = new AdminService(store);
    expect(admin.ipCountries(" 82.12.43.177 , not-an-ip,82.12.43.177")).toEqual([{ ip: "82.12.43.177", country: "GB", source: "cloudflare" }]);
    expect(admin.ipCountries(null)).toEqual([]);
  });
});
