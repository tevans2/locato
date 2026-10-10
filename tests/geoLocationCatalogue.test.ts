import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { GEO_LOCATION_CATALOGUE, decodeGeoCountry, geoCatalogueCount, sampleGeoCatalogue } from '../src/core/geoguessr/catalogue';
import { hasGeoCoordinates, sampleGeoLocations } from '../src/core/geoguessr';
import { GEO_GAME_MAPS, locationInGeoMap } from '../src/core/geoguessr/maps';
import { importedGeoLocations } from '../server/streetview/GeoLocationCatalogue';
import { panoramaResolver } from '../server/ranked/panoramas';
import { RankedGames } from '../server/ranked/RankedGames';
import { rankedWorld } from '../server/ranked/assets';
import { privateChallenge, stateOf } from './helpers/privateGame';
const pano = 'abcdefghijklmnopqrstuv';
afterEach(() => vi.unstubAllGlobals());

describe('real panorama catalogue', () => {
  it('ships over 100k unique references with intact file hashes and honest GPS counts', async () => {
    const all = await importedGeoLocations();
    expect(all).toHaveLength(115271);
    expect(new Set(all.map(c => c.panoId)).size).toBe(all.length);
    expect(new Set(all.map(c => c.countryCode)).size).toBe(97);
    expect(all.filter(hasGeoCoordinates)).toHaveLength(GEO_LOCATION_CATALOGUE.withCoordinates);
    expect(all.filter(c => !hasGeoCoordinates(c)).every(c => c.lat === undefined && c.lng === undefined)).toBe(true);
    for (const entry of Object.values(GEO_LOCATION_CATALOGUE.countries)) {
      const bytes = await readFile(`public/assets/geoguessr/locations/${entry.file}`);
      expect(createHash('sha256').update(bytes).digest('hex').slice(0,12)).toBe(entry.file.split('-')[1]!.slice(0,12));
      expect(JSON.parse(bytes.toString())).toHaveLength(entry.count);
      // Keep scanner context confined to one public panorama reference at a time.
      // Random public IDs can contain password-like substrings; they are not credentials.
      const lines = bytes.toString().trim().split('\n');
      expect(lines).toHaveLength(entry.count + 2);
      expect(lines[0]).toBe('[');
      expect(lines.at(-1)).toBe(']');
      expect(lines.slice(1, -1).every(line => Array.isArray(JSON.parse(line.replace(/,$/, ''))))).toBe(true);
    }
    expect(geoCatalogueCount()).toBe(all.length);
    for (const map of GEO_GAME_MAPS) {
      const pool = all.filter(c => locationInGeoMap(c,map));
      expect(pool.length, map.name).toBe(geoCatalogueCount(map.id));
      const trip = sampleGeoLocations(`actual:${map.id}`,pool);
      expect(trip,map.name).toHaveLength(5);
      expect(new Set(trip.map(c=>c.panoId)).size).toBe(5);
    }
    expect(geoCatalogueCount('nonsense')).toBe(0);
  });
  it('loads only one country for a country trip and a small subset for World', async () => {
    const all=await importedGeoLocations();
    const load=vi.fn(async(code:string)=>all.filter(c=>c.countryCode===code));
    const france=await sampleGeoCatalogue('fr','france',load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('FR');
    expect(france).toHaveLength(20);
    expect(france.every(c=>c.countryCode==='FR')).toBe(true);
    load.mockClear();
    const world=await sampleGeoCatalogue('world','',load);
    expect(load).toHaveBeenCalledTimes(20);
    expect(world).toHaveLength(20);
    expect(new Set(world.slice(0,5).map(c=>c.countryCode)).size).toBe(5);
    expect(await sampleGeoCatalogue('world','',load)).toEqual(world);
  });
  it('rejects malformed entries and does not count camera headings as different panoramas', () => {
    expect(()=>decodeGeoCountry('FR',[[pano,0]])).toThrow();
    expect(()=>decodeGeoCountry('FR',[[pano,200,0,0]])).toThrow();
    const refs=decodeGeoCountry('FR',[[pano],[pano,48,2,0]]);
    expect(sampleGeoLocations('dedup',refs)).toHaveLength(1);
  });
});

describe('current Google origins', () => {
  it('resolves a reference by pano ID without inventing coordinates', async () => {
    const fetcher=vi.fn(async(_url:string)=>new Response(JSON.stringify({status:'OK',pano_id:pano,location:{lat:48.1,lng:2.1}})));
    vi.stubGlobal('fetch',fetcher);
    const resolve=panoramaResolver('test-key');
    const candidate=decodeGeoCountry('FR',[[pano]])[0]!;
    expect(await resolve(candidate)).toEqual({panoId:pano,lat:48.1,lng:2.1});
    const url=new URL(fetcher.mock.calls[0]![0] as unknown as string);
    expect(url.searchParams.get('pano')).toBe(pano);
    expect(url.searchParams.has('location')).toBe(false);
    await resolve(candidate);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recovers replaced IDs only when original GPS exists and leaves failed references retryable', async () => {
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({status:'ZERO_RESULTS'}))).mockResolvedValueOnce(new Response(JSON.stringify({status:'OK',pano_id:'replacement',location:{lat:48.2,lng:2.2}})));
    vi.stubGlobal('fetch',fetcher);
    const resolve=panoramaResolver('test-key');
    expect(await resolve({panoId:pano,lat:48,lng:2,heading:0,label:'GPS'})).toMatchObject({lat:48.2,lng:2.2});
    expect(new URL(fetcher.mock.calls[1]![0]).searchParams.get('location')).toBe('48,2');
    fetcher.mockResolvedValue(new Response(JSON.stringify({status:'ZERO_RESULTS'})));
    const onlyId=decodeGeoCountry('FR',[['abcdefghijklmnopqrstuX']])[0]!;
    await expect(resolve(onlyId)).rejects.toThrow();
    await expect(resolve(onlyId)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('uses the resolved GPS for ranked scoring, recovers dead IDs, and never mutates source references', async () => {
    const originals=decodeGeoCountry('FR',['a','b','c','d','e','f','g','h'].map(letter=>[letter.repeat(22)]));
    const snapshot=JSON.stringify(originals);
    const resolver=vi.fn(async(candidate:typeof originals[number])=>{
      if(candidate.panoId==='a'.repeat(22)) throw new Error('removed');
      return {panoId:candidate.panoId!,lat:48,lng:2+candidate.panoId!.charCodeAt(0)/100};
    });
    const games=new RankedGames({world:rankedWorld(),geoLocations:async()=>originals,resolveGeoPanorama:resolver});
    let state=stateOf(await games.start('traveller',{gameMode:'geoguessr',variant:'france'}));
    const ids=new Set();
    for(let i=0;i<5;i++) {
      const target=privateChallenge(games,state).geo!;
      expect(target.lat).toBe(48);expect(target.countryCode).toBe('FR');ids.add(target.panoId);
      expect(JSON.stringify(state.question)).not.toContain(target.panoId);
      state=stateOf(await games.action('traveller',{runId:state.runId,questionId:state.question!.id,type:'pin',lat:target.lat,lng:target.lng}));
    }
    expect(state.score).toBe(25000);expect(ids.size).toBe(5);
    expect(JSON.stringify(originals)).toBe(snapshot);
  });
});
