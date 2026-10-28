// Post-build step: writes .br and .gz next to every compressible file in dist/ and a manifest
// (dist/.static-manifest.json) of content hashes and available encodings. The server reads the
// manifest at start-up, so it never compresses or hashes static files per request.
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, extname } from "node:path";
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";

const DIST = resolve(process.argv[2] ?? "dist");
const MANIFEST = ".static-manifest.json";
const COMPRESSIBLE = new Set([".js", ".mjs", ".css", ".html", ".json", ".svg", ".txt", ".xml", ".webmanifest", ".map", ".ico"]);
// Below this, compression isn't worth a second request header round of work.
const MIN_BYTES = 1024;
// Keep a compressed copy only if it saves at least this much.
const MIN_SAVING = 0.9;
const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && !/\.(br|gz)$/.test(entry.name) && entry.name !== MANIFEST && entry.name !== ".DS_Store") yield path;
  }
}

async function processFile(path) {
  const data = await readFile(path);
  const etag = `"${createHash("sha1").update(data).digest("base64url").slice(0, 22)}"`;
  const entry = { etag, size: data.length, encodings: [] };
  if (COMPRESSIBLE.has(extname(path).toLowerCase()) && data.length >= MIN_BYTES) {
    const [br, gzipped] = await Promise.all([
      brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
      gz(data, { level: 9 }),
    ]);
    if (br.length < data.length * MIN_SAVING) { await writeFile(`${path}.br`, br); entry.encodings.push("br"); }
    if (gzipped.length < data.length * MIN_SAVING) { await writeFile(`${path}.gz`, gzipped); entry.encodings.push("gzip"); }
    entry.compressed = { br: entry.encodings.includes("br") ? br.length : null, gzip: entry.encodings.includes("gzip") ? gzipped.length : null };
  }
  return [`/${relative(DIST, path).split("\\").join("/")}`, entry];
}

const started = Date.now();
await stat(DIST);
const paths = [];
for await (const path of walk(DIST)) paths.push(path);
// A small pool: brotli at quality 11 is CPU-bound, and libuv runs it on its thread pool.
const results = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < paths.length) results.push(await processFile(paths[next++]));
}));
const manifest = Object.fromEntries(results.sort(([a], [b]) => a.localeCompare(b)).map(([path, { compressed, ...entry }]) => [path, entry]));
await writeFile(join(DIST, MANIFEST), JSON.stringify(manifest));

const raw = results.reduce((sum, [, entry]) => sum + entry.size, 0);
const best = results.reduce((sum, [, entry]) => sum + Math.min(entry.size, entry.compressed?.br ?? Infinity, entry.compressed?.gzip ?? Infinity), 0);
console.log(`compress-dist: ${results.length} files, ${(raw / 1e6).toFixed(1)} MB → ${(best / 1e6).toFixed(1)} MB over the wire (brotli), ${((Date.now() - started) / 1000).toFixed(1)}s`);
