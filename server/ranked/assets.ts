import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";
import type { WorldCountryFeature } from "../../src/core/map";
import { buildFlyoverCountries, type FlyoverCountry } from "../../src/core/flyover";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function assetPath(path: string): string {
  const paths = [resolve(root, "dist", path), resolve(root, "public", path)];
  const found = paths.find((p) => existsSync(p));
  if (!found) throw new Error("Game artwork is unavailable.");
  return found;
}
let world: readonly WorldCountryFeature[] | null = null;
export function rankedWorld(): readonly WorldCountryFeature[] {
  return world ??= JSON.parse(readFileSync(assetPath("assets/world-map.json"), "utf8"));
}
let outlines: readonly FlyoverCountry[] | null = null;
export function countryOutline(code: string) {
  const country = (outlines ??= buildFlyoverCountries(rankedWorld())).find((c) => c.code === code);
  return country?.polygons.flatMap((polygon) => polygon) ?? [];
}

/** A bounded raster cache, kept exclusively on the server. No hidden target pixels go to the browser. */
const flags = new Map<string, Buffer>();
function pixels(path: string): Buffer {
  const cached = flags.get(path);
  if (cached) return cached;
  const result = (() => {
    const svg = readFileSync(assetPath(path));
    const png = PNG.sync.read(new Resvg(svg, { fitTo: { mode: "width", value: 300 }, font: { loadSystemFonts: false } }).render().asPng());
    const result = Buffer.alloc(300 * 200 * 4);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 300; x++) {
      const source = (Math.floor(y / 200 * png.height) * png.width + Math.floor(x / 300 * png.width)) * 4;
      png.data.copy(result, (y * 300 + x) * 4, source, source + 4);
    }
    return result;
  })();
  flags.set(path, result);
  if (flags.size > 64) flags.delete(flags.keys().next().value!);
  return result;
}

export class FlagReveal {
  private readonly shown = Buffer.alloc(300 * 200 * 4);
  constructor(private readonly target: string) {}
  guess(path: string): void {
    const target = pixels(this.target), guess = pixels(path);
    for (let i = 0; i < target.length; i += 4) {
      if (target[i + 3]! < 24 || guess[i + 3]! < 24) continue;
      const distance = (target[i]! - guess[i]!) ** 2 + (target[i + 1]! - guess[i + 1]!) ** 2 + (target[i + 2]! - guess[i + 2]!) ** 2;
      if (distance <= 82 ** 2) target.copy(this.shown, i, i, i + 4);
    }
  }
  png(): Uint8Array<ArrayBuffer> {
    const png = new PNG({ width: 300, height: 200 });
    this.shown.copy(png.data);
    return new Uint8Array(PNG.sync.write(png));
  }
}

const artwork = new Map<string, Uint8Array<ArrayBuffer>>();
/** Rasterize visible clues so SVG IDs, editor metadata and embedded titles cannot leak names. */
export function gameArtwork(path: string): Uint8Array<ArrayBuffer> {
  const cached = artwork.get(path);
  if (cached) return cached;
  const svg = readFileSync(assetPath(path), "utf8");
  const bytes = new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: 600 }, font: { loadSystemFonts: false } }).render().asPng());
  artwork.set(path, bytes);
  if (artwork.size > 64) artwork.delete(artwork.keys().next().value!);
  return bytes;
}
