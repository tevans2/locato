import type { StreetViewFrame } from "../../src/core/streetview";

/** Resolve the scoring origin on the server; panorama IDs and coordinates stay private. */
export function panoramaResolver(key: string) {
  const cache = new Map<string, Promise<{ panoId: string; lat: number; lng: number }>>();
  return async (frame: StreetViewFrame) => {
    if (!key) throw new Error("Server Street View metadata key is not configured.");
    const location = `${frame.lat},${frame.lng}`;
    const cached = cache.get(location);
    if (cached) return cached;
    const task = (async () => {
      const params = new URLSearchParams({ key, location, radius: "1000", source: "outdoor" });
      const response = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params}`, { signal: AbortSignal.timeout(10_000) });
      const data = await response.json() as { status?: string; pano_id?: string; location?: { lat?: number; lng?: number } };
      if (!response.ok || data.status !== "OK" || !data.pano_id || typeof data.location?.lat !== "number" || typeof data.location?.lng !== "number") throw new Error("No panorama available.");
      return { panoId: data.pano_id, lat: data.location.lat, lng: data.location.lng };
    })();
    cache.set(location, task);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    try { return await task; } catch (error) { cache.delete(location); throw error; }
  };
}
