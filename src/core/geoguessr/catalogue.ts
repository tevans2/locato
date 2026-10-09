import manifest from './catalogueManifest.json';
import { createSeededRandom, shuffle } from '../game';
import { sampleGeoLocations, type GeoGuessrCandidate } from './index';
import { geoGameMap } from './maps';

export const GEO_LOCATION_CATALOGUE = manifest;
export type GeoCatalogueTuple = readonly [panoId: string] | readonly [panoId: string, lat: number, lng: number, heading: number];
export type GeoCountryLoader = (code: string) => Promise<readonly GeoGuessrCandidate[]>;
export function decodeGeoCountry(code: string, value: unknown): GeoGuessrCandidate[] {
  if (!Array.isArray(value)) throw new Error('Invalid panorama catalogue.');
  return value.map((row: unknown) => {
    if (!Array.isArray(row) || (row.length !== 1 && row.length !== 4) || typeof row[0] !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(row[0])) throw new Error('Invalid panorama reference.');
    const base = { panoId: row[0], countryCode: code, label: 'Mystery location', heading: 0, pitch: 0, fov: 90 };
    if (row.length === 1) return base;
    if (!row.slice(1).every(n => typeof n === 'number' && Number.isFinite(n)) || Math.abs(row[1]) > 90 || Math.abs(row[2]) > 180 || row[3] < 0 || row[3] >= 360) throw new Error('Invalid panorama coordinates.');
    return { ...base, lat: row[1] as number, lng: row[2] as number, heading: row[3] as number };
  });
}
export function geoCatalogueCount(mapId = ''): number {
  const map = geoGameMap(mapId);
  if (!map) return 0;
  return Object.entries(manifest.countries).reduce((total, [code, entry]) => total + (!map.countryCodes || map.countryCodes.includes(code) ? entry.count : 0), 0);
}
/** Choose countries before loading their files: a World trip needn't download 115k records. */
export async function sampleGeoCatalogue(seed: string, mapId: string, loadCountry: GeoCountryLoader, count = 20): Promise<GeoGuessrCandidate[]> {
  const map = geoGameMap(mapId);
  if (!map) throw new Error('Unknown GeoGuessr map.');
  if (count <= 0) return [];
  const codes = shuffle(Object.keys(manifest.countries).filter(code => !map.countryCodes || map.countryCodes.includes(code)), createSeededRandom(seed)).slice(0, count);
  const countries = await Promise.allSettled(codes.map(code => loadCountry(code)));
  const pool = countries.flatMap(result => result.status === 'fulfilled' ? [...result.value] : []);
  return sampleGeoLocations(seed, pool, count);
}
