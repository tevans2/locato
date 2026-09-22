import type { WorldCountryFeature } from "./types";

const WORLD_MAP_ASSET_PATH = "assets/world-map.json";

async function fetchFeatures(fetcher: typeof fetch): Promise<readonly WorldCountryFeature[]> {
  const response = await fetcher(WORLD_MAP_ASSET_PATH);
  if (!response.ok) throw new Error(`Unable to load world map data: ${response.status}`);
  return (await response.json()) as readonly WorldCountryFeature[];
}

let sharedFeatures: Promise<readonly WorldCountryFeature[]> | null = null;

/** Reuse immutable map data between modes; failed requests remain retryable. */
export function loadWorldCountryFeatures(fetcher?: typeof fetch): Promise<readonly WorldCountryFeature[]> {
  if (fetcher) return fetchFeatures(fetcher);
  sharedFeatures ??= fetchFeatures(fetch).catch((error: unknown) => {
    sharedFeatures = null;
    throw error;
  });
  return sharedFeatures;
}
