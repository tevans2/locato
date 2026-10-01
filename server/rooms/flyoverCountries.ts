import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFlyoverCountries, type FlyoverCountry } from "../../src/core/flyover";
import type { WorldCountryFeature } from "../../src/core/map";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// The built app ships the map in dist/ (production has no public/); dev runs from the source copy.
const CANDIDATES = [resolve(PROJECT_ROOT, "dist/assets/world-map.json"), resolve(PROJECT_ROOT, "public/assets/world-map.json")];

let cached: readonly FlyoverCountry[] | null = null;

/** The same country shapes the browser flies over, so the server can check claimed reaches. */
export function loadFlyoverCountries(): readonly FlyoverCountry[] {
  if (cached) return cached;
  const path = CANDIDATES.find((candidate) => existsSync(candidate));
  if (!path) throw new Error("world-map.json not found: Flyover rooms need the map to check reaches.");
  cached = buildFlyoverCountries(JSON.parse(readFileSync(path, "utf8")) as WorldCountryFeature[]);
  return cached;
}
