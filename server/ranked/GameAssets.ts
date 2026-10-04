import { randomBytes } from "node:crypto";
import type { StreetViewFrame } from "../../src/core/streetview";
import { gameArtwork, FlagReveal } from "./assets";
import { PNG } from "pngjs";

type Asset = { readonly expiresAt: number } & ({ readonly path: string } | { readonly frame: StreetViewFrame } | { readonly reveal: FlagReveal });
const entries = new Map<string, Asset>();
const images = new Map<string, { expiresAt: number; bytes: Promise<{ data: Uint8Array<ArrayBuffer>; type: string } | null> }>();

/** Remove EXIF/IPTC/comments so upstream image metadata cannot disclose a location. */
function stripJpegMetadata(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Invalid JPEG");
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) throw new Error("Invalid JPEG marker");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]!;
    if (marker === 0xda || marker === 0xd9) { parts.push(bytes.subarray(start)); break; }
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) throw new Error("Invalid JPEG segment");
    offset += length;
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) parts.push(bytes.subarray(start, offset));
  }
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let position = 0;
  for (const part of parts) { result.set(part, position); position += part.length; }
  return result;
}
export function issueGameAsset(value: { readonly path: string } | { readonly frame: StreetViewFrame } | { readonly reveal: FlagReveal }): string {
  const now = Date.now();
  for (const [token, asset] of entries) if (asset.expiresAt < now) entries.delete(token);
  const token = randomBytes(24).toString("hex");
  entries.set(token, { ...value, expiresAt: now + 2 * 60 * 60 * 1000 });
  if (entries.size > 8000) entries.delete(entries.keys().next().value!);
  return `/api/game-assets/${token}`;
}
export function revokeGameAsset(url: string): void { entries.delete(url.split("/").at(-1)!); }
export async function serveGameAsset(url: URL): Promise<Response> {
  const token = url.pathname.split("/").at(-1)!;
  const asset = entries.get(token);
  if (!asset || Date.now() > asset.expiresAt) return new Response("Not found", { status: 404 });
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if ("reveal" in asset) return new Response(asset.reveal.png(), { headers: { ...headers, "content-type": "image/png" } });
  if ("path" in asset) {
    return new Response(gameArtwork(asset.path), { headers: { ...headers, "content-type": "image/png" } });
  }
  return streetImage(asset.frame, url, headers);
}

/** Image bytes only: never redirect to Google or expose its request URL, key, or scoring coordinates. */
export async function streetImage(frame: StreetViewFrame, url: URL, headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" }): Promise<Response> {
  const key = process.env.GOOGLE_MAPS_STREETVIEW_STATIC_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_STREETVIEW_METADATA_API_KEY ?? "";
  if (!key) return new Response("Street View unavailable", { status: 503 });
  const turnRaw = Number(url.searchParams.get("turn") ?? 0);
  if (!Number.isFinite(turnRaw) || turnRaw % 90 !== 0) return new Response("Invalid view", { status: 400 });
  const turn = ((turnRaw % 360) + 360) % 360;
  const params = new URLSearchParams({ key, size: "640x480", location: `${frame.lat},${frame.lng}`, heading: String(frame.heading + turn), pitch: String(frame.pitch ?? 0), fov: String(frame.fov ?? 90), source: "outdoor", return_error_code: "true" });
  const now = Date.now();
  const cacheKey = params.toString();
  for (const [token, image] of images) if (image.expiresAt < now) images.delete(token);
  let image = images.get(cacheKey);
  if (!image) {
    const bytes = (async () => {
      try {
        const response = await fetch(`https://maps.googleapis.com/maps/api/streetview?${params}`, { signal: AbortSignal.timeout(10_000) });
        const type = response.headers.get("content-type")?.split(";")[0];
        if (!response.ok || (type !== "image/jpeg" && type !== "image/png")) return null;
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.length > 2_000_000) return null;
        return { data: type === "image/jpeg" ? stripJpegMetadata(data) : new Uint8Array(PNG.sync.write(PNG.sync.read(Buffer.from(data)))), type };
      } catch { return null; }
    })();
    image = { expiresAt: now + 60_000, bytes };
    images.set(cacheKey, image);
    if (images.size > 128) images.delete(images.keys().next().value!);
  }
  const result = await image.bytes;
  if (!result) { images.delete(cacheKey); return new Response("Street View unavailable", { status: 503 }); }
  return new Response(result.data, { headers: { ...headers, "content-type": result.type } });
}
