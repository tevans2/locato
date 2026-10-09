import { readFile } from 'node:fs/promises';
import { assetPath } from '../ranked/assets';
import { decodeGeoCountry, GEO_LOCATION_CATALOGUE } from '../../src/core/geoguessr/catalogue';
import type { GeoGuessrCandidate } from '../../src/core/geoguessr';
import { geoGameMap, locationInGeoMap } from '../../src/core/geoguessr/maps';
let catalogue: Promise<readonly GeoGuessrCandidate[]> | null = null;
/** Read the checked-in metadata once. There is no runtime dependency on dataset hosts. */
export async function importedGeoLocations(mapId = ''): Promise<readonly GeoGuessrCandidate[]> {
  const map = geoGameMap(mapId);
  if (!map) throw new Error('Unknown GeoGuessr map.');
  catalogue ??= Promise.all(Object.entries(GEO_LOCATION_CATALOGUE.countries).map(async ([code, entry]) => decodeGeoCountry(code, JSON.parse(await readFile(assetPath(`assets/geoguessr/locations/${entry.file}`), 'utf8'))))).then(countries => countries.flat());
  try { return (await catalogue).filter(location => locationInGeoMap(location, map)); }
  catch (error) { catalogue = null; throw error; }
}
