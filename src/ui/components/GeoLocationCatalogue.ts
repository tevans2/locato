import { decodeGeoCountry, GEO_LOCATION_CATALOGUE, sampleGeoCatalogue } from '../../core/geoguessr/catalogue';
import type { GeoGuessrCandidate } from '../../core/geoguessr';

const countries = new Map<string, Promise<readonly GeoGuessrCandidate[]>>();
function loadCountry(code: string): Promise<readonly GeoGuessrCandidate[]> {
  const existing = countries.get(code);
  if (existing) return existing;
  const entry = GEO_LOCATION_CATALOGUE.countries[code as keyof typeof GEO_LOCATION_CATALOGUE.countries];
  if (!entry) return Promise.resolve([]);
  const request = (async () => {
    const response = await fetch(`/assets/geoguessr/locations/${entry.file}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Location catalogue unavailable.');
    return decodeGeoCountry(code, await response.json());
  })();
  countries.set(code, request);
  void request.catch(() => { if (countries.get(code) === request) countries.delete(code); });
  return request;
}
export async function loadGeoCatalogueLocations(signal: AbortSignal, mapId: string): Promise<GeoGuessrCandidate[]> {
  if (signal.aborted) return [];
  const result = await sampleGeoCatalogue(`trip:${Date.now()}:${Math.random()}`, mapId, loadCountry);
  return signal.aborted ? [] : result;
}
