/** Import metadata only; never download or redistribute Street View imagery.
 * Usage: node scripts/import-geo-locations.mjs /path/to/g3 /path/to/WanderBench /path/to/caption_metadata.txt
 * g3 directory: train.csv, val.csv, test.csv, countries.json (pseudo labels), guidebook.json.
 * Pinned sources and licenses: public/assets/geoguessr/locations/SOURCES.md.
 */
import { readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import countryData from 'world-countries';
const [g3, wander, captions] = process.argv.slice(2);
if (!g3 || !wander || !captions) throw new Error('Provide G3 metadata directory, WanderBench directory, and caption_metadata.txt.');
const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
let previous;
try { previous = await json(new URL("src/core/geoguessr/catalogueManifest.json", root)); } catch {}
const world = await json(new URL('public/assets/world-map.json', root));
const codes = new Set(world.map(c => c.code));
const iso3 = new Map(countryData.map(c => [c.cca3, c.cca2]));
const names = new Map(countryData.flatMap(c => [c.name.common, c.name.official, ...c.altSpellings].map(n => [n, c.cca2])));
const polygons = world.flatMap(c => (c.geometry.type === 'Polygon' ? [c.geometry.coordinates] : c.geometry.coordinates).map(rings => {
  const wrap = Math.max(...rings[0].map(p => p[0])) - Math.min(...rings[0].map(p => p[0])) > 180;
  rings = rings.map(r => r.map(([x,y]) => [wrap && x < 0 ? x + 360 : x, y]));
  return { code: c.code, rings, wrap, minX: Math.min(...rings[0].map(p => p[0])), maxX: Math.max(...rings[0].map(p => p[0])), minY: Math.min(...rings[0].map(p => p[1])), maxY: Math.max(...rings[0].map(p => p[1])) };
}));
function inRing(x,y,r) { let inside=false; for(let i=0,j=r.length-1;i<r.length;j=i++) { const a=r[i],b=r[j]; if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside=!inside; } return inside; }
function locate(lat,lng) { for(const p of polygons) { const x=p.wrap&&lng<0?lng+360:lng; if(x>=p.minX&&x<=p.maxX&&lat>=p.minY&&lat<=p.maxY&&inRing(x,lat,p.rings[0])&&!p.rings.slice(1).some(r=>inRing(x,lat,r))) return p.code; } return null; }
const entries = new Map(), sourceCounts = {}, excluded = {};
function add(code, tuple, source) {
  if (!codes.has(code) || !/^[A-Za-z0-9_-]{22}$/.test(tuple[0])) { excluded[source] = (excluded[source] ?? 0) + 1; return; }
  if (tuple.length > 1 && (!Number.isFinite(tuple[1]) || Math.abs(tuple[1])>90 || !Number.isFinite(tuple[2]) || Math.abs(tuple[2])>180)) throw new Error('Invalid coordinates');
  if (entries.has(tuple[0])) return;
  entries.set(tuple[0], { code, tuple }); sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
}
// Prefer original GPS records. Wander graph views often repeat the same panorama.
for (const file of (await readdir(wander)).filter(f=>f.endsWith('.json')).sort()) {
  const graph = await json(`${wander}/${file}`);
  for (const node of graph.nodes ?? []) {
    const c=node.coordinate, code=locate(c.lat,c.lon);
    add(code, [node.pano_id, +c.lat.toFixed(7), +c.lon.toFixed(7), (+(((c.heading*180/Math.PI)%360+360)%360).toFixed(1))%360], 'WanderBench');
  }
}
for (const [name, files] of Object.entries((await json(captions)).countries)) for(const file of files) {
  const m=/^\d+_([A-Za-z0-9_-]{22})_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)\.jpg$/.exec(file);
  if (!m) throw new Error(`Unrecognized metadata filename: ${file}`);
  const lat=+m[2],lng=+m[3];
  add(locate(lat,lng) ?? names.get(name), [m[1],lat,lng,0], 'StreetView360AtoZ');
}
const book=await json(`${g3}/guidebook.json`), labels=await json(`${g3}/countries.json`), assignments=new Map();
// Only use unambiguous country labels: all associated clues must share exactly
// one ISO3 country. Malformed/ambiguous upstream labels are excluded, not guessed.
const labelCountries = new Map();
for(const [image, values] of Object.entries(labels)) {
  const ids=values[0], labelGroup=ids.join(',');
  if(!labelCountries.has(labelGroup)) {
    const sets=ids.map(i=>new Set(book[i].geoparsed.map(g=>g.ISO3)));
    const intersection=sets.length ? [...sets[0]].filter(c=>sets.every(s=>s.has(c))) : [];
    labelCountries.set(labelGroup, intersection.length===1 ? iso3.get(intersection[0]) : null);
  }
  const pano=image.replace(/_[0-3]\.png$/, ''), code=labelCountries.get(labelGroup);
  if(assignments.has(pano)&&assignments.get(pano)!==code) throw new Error('Conflicting panorama country labels');
  assignments.set(pano,code);
}
for(const split of ['train','val','test']) {
  const lines=(await readFile(`${g3}/${split}.csv`,'utf8')).trim().split(/\r?\n/).slice(1);
  for(const image of lines) { const pano=image.replace(/_[0-3]\.png$/, ''); add(assignments.get(pano), [pano], 'G3'); }
}
const countries={};for(const {code,tuple} of entries.values()) (countries[code]??=[]).push(tuple);
const manifest={ version:1, total:entries.size, withCoordinates:[...entries.values()].filter(e=>e.tuple.length>1).length, sources:sourceCounts, countries:{} };
const directory=new URL('public/assets/geoguessr/locations/',root);await mkdir(directory,{recursive:true});
for(const code of Object.keys(countries).sort()) {
  // One panorama tuple per line keeps unrelated IDs out of the same scanner context.
  // IDs are public Google references, including any that happen to contain "pwd".
  const tuples=countries[code].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0), content='[\n'+tuples.map(tuple=>JSON.stringify(tuple)).join(',\n')+'\n]\n', hash=createHash('sha256').update(content).digest('hex').slice(0,12);
  const file=`${code.toLowerCase()}-${hash}.json`;await writeFile(new URL(file,directory),content);
  manifest.countries[code]={count:tuples.length,file};
}
await writeFile(new URL('src/core/geoguessr/catalogueManifest.json',root),JSON.stringify(manifest,null,2)+'\n');
const currentFiles=new Set(Object.values(manifest.countries).map(e=>e.file));
for(const entry of Object.values(previous?.countries ?? {})) if(!currentFiles.has(entry.file) && /^[a-z]{2}-[0-9a-f]{12}\.json$/.test(entry.file)) await unlink(new URL(entry.file,directory));
console.log(JSON.stringify({ ...manifest, countries:Object.keys(countries).length, excluded },null,2));
