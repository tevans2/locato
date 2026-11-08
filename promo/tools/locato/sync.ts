#!/usr/bin/env bun
// Pull Locato's assets and game data into this video project.
// Re-run whenever the game's flags, outlines or country data change.
//   bun tools/locato/sync.ts            (LOCATO_DIR defaults to the Locato repo this folder lives in)
import {cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const LOCATO = resolve(process.env.LOCATO_DIR ?? join(ROOT, '..'));
const OUT = join(ROOT, 'public/locato');
if (!existsSync(join(LOCATO, 'src/core'))) {
  console.error(`Locato repo not found at ${LOCATO}. Set LOCATO_DIR.`);
  process.exit(1);
}

const core = (p: string) => import(join(LOCATO, 'src/core', p));
const {rawCountries} = await core('countries/countries.ts');
const {fameTier} = await core('countries/fame.ts');
const {LOOKALIKES} = await core('academy/lookalikes.ts');
const {DAILY_THEMES} = await core('dailyThemes.ts');

// assets
mkdirSync(OUT, {recursive: true});
for (const [from, to] of [
  ['public/assets/flags', 'flags'],
  ['public/assets/country-shapes', 'shapes'],
]) {
  cpSync(join(LOCATO, from), join(OUT, to), {recursive: true});
}
cpSync(join(LOCATO, 'logo.svg'), join(OUT, 'logo.svg'));

const flags = new Set(readdirSync(join(OUT, 'flags')).map((f) => f.replace('.svg', '')));
const shapes = new Set(readdirSync(join(OUT, 'shapes')).map((f) => f.replace('.svg', '')));

const countries = (rawCountries as any[])
  .filter((c) => !c.allowedCategoryIds) // sovereign countries only (territories are flag-only extras)
  .map((c) => {
    const code = String(c.code).toLowerCase();
    return {
      code: c.code,
      name: c.name,
      capital: c.capital,
      continent: c.continent,
      tier: fameTier(c.code),
      flag: flags.has(code),
      shape: shapes.has(code),
    };
  });

const data = {
  syncedAt: new Date().toISOString(),
  countries,
  lookalikes: LOOKALIKES,
  themes: (DAILY_THEMES as any[]).map(({id, title, description, countryCodes}) => ({id, title, description, countryCodes})),
};
writeFileSync(join(OUT, 'data.json'), JSON.stringify(data, null, 1));

// ---- map: Locato's world map projected once into SVG paths (Natural Earth projection) -------------
const {geoNaturalEarth1, geoPath, geoArea, geoCentroid, geoContains} = await import('d3-geo');
const world = JSON.parse(readFileSync(join(LOCATO, 'public/assets/world-map.json'), 'utf8')) as {name: string; code: string; continent: string; geometry: any}[];
// d3 wants clockwise outer rings; if a shape covers more than a hemisphere its winding is reversed.
const fixWinding = (g: any) => {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    const area = geoArea({type: 'Polygon', coordinates: poly} as any);
    if (area > 2 * Math.PI) for (const ring of poly) ring.reverse();
  }
  return g;
};
const features = world.map((c) => ({type: 'Feature', properties: {code: c.code, name: c.name, continent: c.continent}, geometry: fixWinding(c.geometry)}));
const MAP_W = 3000, MAP_H = 1560;
const projection = geoNaturalEarth1().fitExtent([[10, 10], [MAP_W - 10, MAP_H - 10]], {type: 'FeatureCollection', features} as any);
const path = geoPath(projection).digits(1);
const mapCountries = features.map((f: any) => {
  const [[x0, y0], [x1, y1]] = path.bounds(f);
  const [cx, cy] = path.centroid(f);
  // The mainland: the largest piece (France without French Guiana, the US without Alaska, Russia without the far-east tip).
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const main = {type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: polys.reduce((a: any, b: any) => (geoArea({type: 'Polygon', coordinates: b} as any) > geoArea({type: 'Polygon', coordinates: a} as any) ? b : a))}};
  const [[m0, n0], [m1, n1]] = path.bounds(main as any);
  const [mx, my] = path.centroid(main as any);
  const [lng, lat] = geoCentroid(main as any);
  return {code: f.properties.code, name: f.properties.name, continent: f.properties.continent, d: path(f), bbox: [x0, y0, x1, y1].map((v) => +v.toFixed(1)), main: [m0, n0, m1, n1].map((v) => +v.toFixed(1)), c: [+mx.toFixed(1), +my.toFixed(1)], ll: [+lng.toFixed(3), +lat.toFixed(3)]};
});
mkdirSync(join(OUT, 'map'), {recursive: true});
writeFileSync(join(OUT, 'map/world.json'), JSON.stringify({width: MAP_W, height: MAP_H, projection: {scale: projection.scale(), translate: projection.translate()}, countries: mapCountries}));

// MapTap places (projected, with the country they're in), borders, population
const {MAP_TAP_LOCATIONS} = await core('maptap/locations.ts');
const places = (MAP_TAP_LOCATIONS as any[]).map((p) => {
  const [x, y] = projection([p.lng, p.lat])!;
  const inside = features.find((f: any) => geoContains(f, [p.lng, p.lat]));
  return {id: p.id, name: p.name, category: p.category, difficulty: p.difficulty, lat: p.lat, lng: p.lng, x: +x.toFixed(1), y: +y.toFixed(1), country: inside?.properties.code ?? null};
});
const {WORLD_SPLIT_POPULATION_MILLIONS} = await core('worldsplit/population.ts');
const borders = await core('countries/borders.data.ts');
const bordersMap = Object.values(borders).find((v: any) => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(Array.isArray));
writeFileSync(join(OUT, 'map/extras.json'), JSON.stringify({places, population: WORLD_SPLIT_POPULATION_MILLIONS, borders: bordersMap ?? {}}));
console.log(`  map: ${mapCountries.length} countries, ${places.length} MapTap places, ${Object.keys(bordersMap ?? {}).length} border lists`);
console.log(`Synced from ${LOCATO}`);
console.log(`  ${countries.length} countries (${countries.filter((c) => c.shape).length} with outlines), ${LOOKALIKES.length} look-alike sets, ${data.themes.length} daily themes`);
console.log(`  assets -> ${OUT}`);
