import { gunzipSync, brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cacheControlFor, compressBody, DAILY, etagMatches, IMMUTABLE, NO_CACHE, pickEncoding } from "../server/staticFiles";

describe("static file caching", () => {
  it("caches hashed bundles for good, other files for a day, and the shell not at all", () => {
    expect(cacheControlFor("/assets/main-CcKlYg1E.js")).toBe(IMMUTABLE);
    expect(cacheControlFor("/assets/fraunces-latin-wght-normal-ukD16Tqj.woff2")).toBe(IMMUTABLE);
    expect(cacheControlFor("/assets/world-map.json")).toBe(DAILY);
    expect(cacheControlFor("/assets/flags/za.svg")).toBe(DAILY);
    expect(cacheControlFor("/og-image.png")).toBe(DAILY);
    expect(cacheControlFor("/index.html")).toBe(NO_CACHE);
  });

  it("matches ETags in lists, weak or strong", () => {
    expect(etagMatches(`"abc"`, `"abc"`)).toBe(true);
    expect(etagMatches(`W/"x", "abc"`, `"abc"`)).toBe(true);
    expect(etagMatches(`"abc"`, `W/"abc"`)).toBe(true);
    expect(etagMatches("*", `"abc"`)).toBe(true);
    expect(etagMatches(`"abd"`, `"abc"`)).toBe(false);
    expect(etagMatches(null, `"abc"`)).toBe(false);
  });
});

describe("compression", () => {
  it("prefers brotli, then gzip, and respects q=0", () => {
    expect(pickEncoding("gzip, deflate, br", ["br", "gzip"])).toBe("br");
    expect(pickEncoding("gzip, deflate", ["br", "gzip"])).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip", ["br", "gzip"])).toBe("gzip");
    expect(pickEncoding("*", ["gzip"])).toBe("gzip");
    expect(pickEncoding("identity", ["br", "gzip"])).toBeNull();
    expect(pickEncoding(null, ["br"])).toBeNull();
    expect(pickEncoding("br", [])).toBeNull();
  });

  it("compresses a dynamic body so it round-trips", () => {
    const html = `<!doctype html><title>Locato</title>${"<p>geography</p>".repeat(200)}`;
    const br = compressBody(html, "br, gzip");
    expect(br.encoding).toBe("br");
    expect(brotliDecompressSync(Buffer.from(br.body as ArrayBuffer)).toString()).toBe(html);
    const gz = compressBody(html, "gzip");
    expect(gunzipSync(Buffer.from(gz.body as ArrayBuffer)).toString()).toBe(html);
    expect(compressBody(html, null)).toEqual({ body: html, encoding: null });
  });
});
