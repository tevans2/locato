import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

// Static files from dist/: precompressed variants and content-hash ETags from the manifest
// scripts/compress-dist.mjs writes at build time, and cache lifetimes by kind of file.

export type Encoding = "br" | "gzip";

export interface ManifestEntry {
  readonly etag: string;
  readonly size: number;
  readonly encodings: readonly Encoding[];
}

const MANIFEST_FILE = ".static-manifest.json";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

// Vite names its output `name-<8 char hash>.ext`: those never change, so cache them for good.
const HASHED_ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
export const IMMUTABLE = "public, max-age=31536000, immutable";
// Unhashed files (flags, shapes, the world map, logos) rarely change; a day, then revalidate.
export const DAILY = "public, max-age=86400, stale-while-revalidate=604800";
// The app shell must pick up a deploy at once, so browsers revalidate it every time.
export const NO_CACHE = "no-cache";

export function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function cacheControlFor(pathname: string): string {
  if (HASHED_ASSET.test(pathname)) return IMMUTABLE;
  if (pathname.endsWith(".html")) return NO_CACHE;
  return DAILY;
}

/** The best encoding both sides have: brotli, then gzip, else none. Honours q=0. */
export function pickEncoding(acceptEncoding: string | null, available: readonly Encoding[]): Encoding | null {
  if (!acceptEncoding || available.length === 0) return null;
  const accepted = new Map<string, number>();
  for (const part of acceptEncoding.toLowerCase().split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (!name) continue;
    const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    accepted.set(name, q ? Number(q.slice(2)) || 0 : 1);
  }
  const ok = (name: Encoding) => available.includes(name) && ((accepted.get(name) ?? accepted.get("*") ?? 0) > 0);
  if (ok("br")) return "br";
  if (ok("gzip")) return "gzip";
  return null;
}

/** If-None-Match against our ETag (a list, weak or strong, or `*`). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  const bare = etag.replace(/^W\//, "");
  return ifNoneMatch.split(",").some((tag) => tag.trim().replace(/^W\//, "") === bare);
}

/** Compresses a small dynamic text body (the app shell) for this request, if the client accepts it. */
export function compressBody(body: string, acceptEncoding: string | null): { readonly body: ArrayBuffer | string; readonly encoding: Encoding | null } {
  const encoding = pickEncoding(acceptEncoding, ["br", "gzip"]);
  if (!encoding) return { body, encoding: null };
  const out = encoding === "br" ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : gzipSync(body, { level: 6 });
  return { body: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer, encoding };
}

/** A weak ETag for a dynamic body. */
export function weakEtag(body: string): string {
  return `W/"${createHash("sha1").update(body).digest("base64url").slice(0, 22)}"`;
}

export interface StaticFiles {
  /** A dist/ file, or null when there's none at that path (the caller falls back to the app shell). */
  serve(request: Request, pathname: string): Response | null;
  /** The app shell's HTML, read once. */
  indexHtml(): string | null;
}

export function createStaticFiles(distDir: string): StaticFiles {
  let manifest: ReadonlyMap<string, ManifestEntry> | null = null;
  try {
    manifest = new Map(Object.entries(JSON.parse(readFileSync(join(distDir, MANIFEST_FILE), "utf8")) as Record<string, ManifestEntry>));
  } catch {
    // No manifest (a plain `vite build`): serve files uncompressed, without ETags.
    manifest = null;
  }

  function resolvePath(pathname: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (manifest) return manifest.has(decoded) && decoded !== `/${MANIFEST_FILE}` ? decoded : null;
    const full = join(distDir, decoded);
    if (!full.startsWith(distDir) || decoded.endsWith(MANIFEST_FILE)) return null;
    try {
      return existsSync(full) && statSync(full).isFile() ? decoded : null;
    } catch {
      return null;
    }
  }

  let shell: string | null | undefined;

  return {
    serve(request, pathname) {
      const path = resolvePath(pathname);
      if (!path) return null;
      const entry = manifest?.get(path);
      const headers = new Headers({ "content-type": contentType(path), "cache-control": cacheControlFor(path) });
      if (entry) {
        headers.set("etag", entry.etag);
        if (entry.encodings.length > 0) headers.set("vary", "Accept-Encoding");
        if (etagMatches(request.headers.get("if-none-match"), entry.etag)) return new Response(null, { status: 304, headers });
      }
      const encoding = entry ? pickEncoding(request.headers.get("accept-encoding"), entry.encodings) : null;
      const file = join(distDir, encoding === "br" ? `${path}.br` : encoding === "gzip" ? `${path}.gz` : path);
      if (encoding) headers.set("content-encoding", encoding);
      return new Response(Bun.file(file), { headers });
    },
    indexHtml() {
      if (shell === undefined) {
        try {
          shell = readFileSync(join(distDir, "index.html"), "utf8");
        } catch {
          shell = null;
        }
      }
      return shell;
    },
  };
}
