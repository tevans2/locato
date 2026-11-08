// Node-side plumbing for the pure content code (src/content): load the game data and the content
// (defaults in content/*.json + the promo service's online items, cached in .cache/content), give builders file access,
// and write finished specs (+ caption, + generated files, + voiceover).
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {indexGame, type Game, type GameData} from '../../src/content/game';
import type {Assets} from '../../src/content/modes/kit';
import type {Compiled} from '../../src/content/compile';
import {KINDS as KIND_LIST, mergeContent, type Merged} from '../../src/content/merge';
import type {ContentKind, Style} from '../../src/content/types';

export const ROOT = resolve(import.meta.dir, '../..');
export const VIDEOS = join(ROOT, 'videos');
const PUB = join(ROOT, 'public');
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

// ---- game data ------------------------------------------------------------------------------------------------
export function loadGame(): Game {
  const data = join(PUB, 'locato/data.json');
  if (!existsSync(data)) throw new Error('No public/locato/data.json yet. Run: npm run locato:sync');
  const d = json(data);
  const game: GameData = {countries: d.countries, lookalikes: d.lookalikes, themes: d.themes, world: json(join(PUB, 'locato/map/world.json')), extras: json(join(PUB, 'locato/map/extras.json'))};
  return indexGame(game);
}

export const assets: Assets = {flagSvg: (code) => readFileSync(join(PUB, 'locato/flags', `${code.toLowerCase()}.svg`), 'utf8')};

// ---- the promo service (promo.locato.quest) -----------------------------------------------------------------------
// Every record and upload goes through its API with the service token; the Mac needs no Cloudflare keys.
export const API_URL = (process.env.PROMO_API_URL ?? 'https://promo.locato.quest').replace(/\/$/, '');
export class ApiError extends Error {}
export async function api<T = any>(path: string, init: RequestInit & {json?: unknown} = {}): Promise<T> {
  const token = process.env.PROMO_SERVICE_TOKEN;
  if (!token) throw new ApiError('PROMO_SERVICE_TOKEN is not set (promo/.env; infra/secrets makes it)');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) (body = JSON.stringify(init.json)), headers.set('content-type', 'application/json');
  let r: Response;
  try {
    r = await fetch(`${API_URL}${path}`, {...init, headers, body});
  } catch (e) {
    throw new ApiError(`Can't reach the promo service at ${API_URL} (${(e as Error).message})`);
  }
  const text = await r.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!r.ok) throw new ApiError(`${init.method ?? 'GET'} ${path}: ${(data as any)?.error ?? r.status}`);
  return data as T;
}

// ---- content: defaults (git) + online items (promo service, cached in .cache/content) ------------------------------------
export const KINDS = KIND_LIST;
export const CACHE = join(ROOT, '.cache/content');
const CACHE_FILE = join(CACHE, 'online.json');
export type Cached = {fetchedAt: string; items: Partial<Record<ContentKind, unknown[]>>};

export const readDefaults = (kind: ContentKind): unknown[] => {
  const f = join(ROOT, 'content', `${kind}.json`);
  return existsSync(f) ? json(f) : [];
};
export const readCache = (): Cached | null => (existsSync(CACHE_FILE) ? json(CACHE_FILE) : null);

/** Fetch the online content into the local cache (tools work offline from the cache). */
export async function pullContent() {
  const items = await api<Record<ContentKind, unknown[]>>('/content/online');
  mkdirSync(CACHE, {recursive: true});
  writeFileSync(CACHE_FILE, JSON.stringify({fetchedAt: new Date().toISOString(), items}, null, 2) + '\n');
  return items;
}

/** Defaults + the cached online items, merged by id (see src/content/merge.ts). */
export function loadContent(opts: {quiet?: boolean} = {}): Merged {
  const defaults = Object.fromEntries(KINDS.map((k) => [k, readDefaults(k)]));
  const m = mergeContent(defaults, readCache()?.items ?? {});
  if (m.problems.length && !opts.quiet) console.warn(`⚠ content problems (skipped):\n  ${m.problems.join('\n  ')}`);
  return m;
}

// ---- recently used countries --------------------------------------------------------------------------------------
/** Codes in existing specs, so new videos prefer fresh countries. */
export function recentlyUsed() {
  const used = new Set<string>();
  if (!existsSync(VIDEOS)) return used;
  for (const f of readdirSync(VIDEOS).filter((f) => f.endsWith('.json'))) for (const m of readFileSync(join(VIDEOS, f), 'utf8').matchAll(/"code":\s*"([A-Z]{2})"/g)) used.add(m[1]);
  return used;
}

// ---- writing a spec ---------------------------------------------------------------------------------------------
export type WriteOpts = {name?: string; seed: string; voice?: string; intensity?: string; engine?: string; speed?: string; extraProps?: Record<string, unknown>; quiet?: boolean};
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');

/** videos/<name>.json (+ .caption.txt) from a compiled recipe, generated files under public/, then the voiceover. */
export function writeCompiled(c: Compiled, o: WriteOpts) {
  for (const [path, contents] of Object.entries(c.files)) {
    mkdirSync(dirname(join(PUB, path)), {recursive: true});
    writeFileSync(join(PUB, path), contents);
  }
  return writeSpec(c.template, {...c.props, ...o.extraProps}, o.name ?? c.name, {caption: c.caption, seed: o.seed, recipe: c.recipe, voice: o});
}

/** Write any template's spec (also used by the non-recipe commands: speedrun, versus, leaderboard). */
export function writeSpec(template: string, props: object, name: string, extra: {caption?: string; seed: string; recipe?: unknown; voice?: Partial<WriteOpts>}) {
  mkdirSync(VIDEOS, {recursive: true});
  const n = slug(name);
  const file = join(VIDEOS, `${n}.json`);
  const ref = n.replace(/[^a-z0-9]+/g, '').slice(0, 24);
  const link = `https://locato.quest/?ref=${ref}`;
  writeFileSync(file, JSON.stringify({template, seed: extra.seed, createdAt: new Date().toISOString(), link, ...(extra.recipe ? {recipe: extra.recipe} : {}), props}, null, 2) + '\n');
  // ready-to-paste caption (short, 3 hashtags, per the research) with this video's tracking link
  writeFileSync(file.replace(/\.json$/, '.caption.txt'), `${extra.caption ?? 'Can you beat it? 🌍 #geography #quiz #locato'}\n\nPlay: ${link}\n`);
  const rel = file.replace(ROOT + '/', '');
  console.log(`✓ wrote ${rel}`);
  const v = extra.voice ?? {};
  if (v.voice !== 'none' && v.voice !== 'off') {
    const pass = (k: 'voice' | 'intensity' | 'engine' | 'speed') => (v[k] ? [`--${k}`, String(v[k])] : []);
    const r = spawnSync('node', [join(ROOT, 'tools/voice/voice.mjs'), file, ...pass('voice'), ...pass('intensity'), ...pass('engine'), ...pass('speed')], {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
    const out = (r.stdout ?? '').split('\n').filter((l) => /✓|s {2}/.test(l));
    if (r.status === 0) console.log(`  voice: ${out[0]?.replace(/.*: /, '') ?? 'added'} (${v.intensity ?? 'lively'}${v.voice ? `, ${v.voice}` : ''})`);
    else console.warn(`  voice failed, video will be silent apart from music:\n${r.stderr}`);
  }
  console.log(`  check:  npm run check -- ${rel}`);
  console.log(`  render: npm run render -- ${rel}`);
  return file;
}

// ---- sound + the real Daily -------------------------------------------------------------------------------------

/** recipe.style → template props: music (library name, "none", or a file to copy in) and effects. */
export function soundProps(style: Style | undefined) {
  const out: Record<string, unknown> = {};
  const m = style?.music;
  const library = join(PUB, 'locato/music');
  if (m === 'none' || m === 'off') out.music = false;
  else if (m && existsSync(join(library, `${m}.m4a`))) out.music = {src: `locato/music/${m}.m4a`, volume: style?.musicVolume ?? 0.5};
  else if (m) {
    const src = resolve(m);
    if (!existsSync(src)) throw new Error(`No such music: ${m} (a name in public/locato/music, "none", or a file)`);
    mkdirSync(library, {recursive: true});
    const name = basename(src, extname(src)).toLowerCase().replace(/[^a-z0-9.-]+/g, '-') + extname(src).toLowerCase();
    if (src !== join(library, name)) copyFileSync(src, join(library, name));
    out.music = {src: `locato/music/${name}`, volume: style?.musicVolume ?? 0.5};
  }
  if (style?.effects === false) out.effects = false;
  return out;
}

/** The game's real Daily countries for a date, so a warm-up never spoils it. Empty (with a warning) if it can't load. */
export async function realDailyCodes(date: string): Promise<string[]> {
  const LOCATO = resolve(process.env.LOCATO_DIR ?? join(ROOT, '..'));
  try {
    const {indexCountries} = await import(join(LOCATO, 'src/core/countries/index.ts'));
    const {rawCountries} = await import(join(LOCATO, 'src/core/countries/countries.ts'));
    const {createDailyChallenge} = await import(join(LOCATO, 'src/core/dailyChallenge.ts'));
    const index = indexCountries(rawCountries);
    const ch = createDailyChallenge(index, date);
    return ch.countryIds.map((id: any) => index.countries[id]?.code ?? index.byId?.get?.(id)?.code).filter(Boolean);
  } catch (e) {
    console.warn(`(could not load Locato's daily for ${date}; continuing without the spoiler filter: ${(e as Error).message})`);
    return [];
  }
}
