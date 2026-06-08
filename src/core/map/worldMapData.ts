import type { WorldCountryFeature } from "./types";

const WORLD_MAP_ASSET_PATH = "assets/world-map.json";

export async function loadWorldCountryFeatures(fetcher: typeof fetch = fetch): Promise<readonly WorldCountryFeature[]> {
  const response = await fetcher(WORLD_MAP_ASSET_PATH);
  if (!response.ok) throw new Error(`Unable to load world map data: ${response.status}`);
  return (await response.json()) as readonly WorldCountryFeature[];
}
