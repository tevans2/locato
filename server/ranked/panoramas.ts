import type { StreetViewFrame } from '../../src/core/streetview';
import type { GeoPanoramaReference } from '../../src/core/geoguessr';

/** Resolve the scoring origin on the server; only Google's current GPS is authoritative. */
export function panoramaResolver(key: string) {
  const cache = new Map<string, Promise<{ panoId: string; lat: number; lng: number }>>();
  return async (frame: StreetViewFrame | GeoPanoramaReference) => {
    if (!key) throw new Error('Server Street View metadata key is not configured.');
    const id = frame.panoId ?? `${frame.lat},${frame.lng}`;
    const cached = cache.get(id);
    if (cached) return cached;
    const lookup = async (usePano: boolean) => {
      const params = new URLSearchParams({ key });
      if (usePano) params.set('pano', frame.panoId!);
      else { params.set('location', `${frame.lat},${frame.lng}`); params.set('radius', '1000'); params.set('source', 'outdoor'); }
      const response = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params}`, { signal: AbortSignal.timeout(5_000) });
      const data = await response.json() as { status?: string; pano_id?: string; location?: { lat?: number; lng?: number } };
      if (!response.ok || data.status !== 'OK' || !data.pano_id || !Number.isFinite(data.location?.lat) || !Number.isFinite(data.location?.lng)) {
        if (usePano && data.status === 'ZERO_RESULTS' && frame.lat !== undefined && frame.lng !== undefined) return lookup(false);
        throw new Error('No panorama available.');
      }
      return { panoId: data.pano_id, lat: data.location!.lat!, lng: data.location!.lng! };
    };
    const task = lookup(Boolean(frame.panoId));
    cache.set(id, task);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    try { return await task; } catch (error) { cache.delete(id); throw error; }
  };
}
