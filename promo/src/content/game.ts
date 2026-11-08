// The game's data as the generator sees it (copied by `npm run locato:sync` into public/locato/), plus
// seeded randomness and country selection. No Node APIs: the host loads the JSON and passes it in.
import type {CountryList, CountryRef, Selection} from './types';

export type Tier = 1 | 2 | 3;
export type Country = {code: string; name: string; capital: string; continent: string; tier: Tier; flag: boolean; shape: boolean};
export type MapCountry = {code: string; name: string; bbox: number[]; main: number[]; c: [number, number]; ll: [number, number]};
export type Place = {id: string; name: string; category: string; difficulty: 'easy' | 'medium' | 'hard'; lat: number; lng: number; x: number; y: number; country: string | null};
export type Theme = {id: string; title: string; description: string; countryCodes: string[]};
export type LookalikeSet = {skill: string; codes: string[]; tip: string};

/** public/locato/data.json + map/world.json + map/extras.json */
export type GameData = {
  countries: Country[];
  lookalikes: LookalikeSet[];
  themes: Theme[];
  world: {width: number; height: number; countries: MapCountry[]};
  extras: {places: Place[]; population: Record<string, number>; borders: Record<string, string[]>};
};

export type Game = GameData & {byCode: Map<string, Country>; geo: Map<string, MapCountry>};
export const indexGame = (d: GameData): Game => ({...d, byCode: new Map(d.countries.map((c) => [c.code, c])), geo: new Map(d.world.countries.map((c) => [c.code, c]))});

// ---- seeded randomness (same seed → same video) ----------------------------------------------------------
export function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) (h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)), (h = (h << 13) | (h >>> 19));
  const rand = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const shuffle = <T,>(xs: readonly T[]) => {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  return {rand, shuffle};
}

/** Which daily theme the game shows on a date (same formula as the game's dailyThemeForDate). */
export const themeForDate = (themes: Theme[], date: string) => {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return themes[((day % themes.length) + themes.length) % themes.length];
};

// ---- choosing countries ------------------------------------------------------------------------------------
const LEVEL_TIER: Record<string, Tier> = {easy: 1, medium: 2, hard: 3};
const norm = (s: string) => s.trim().toLowerCase().replace(/[-_]+/g, ' ');

/** Turn one reference into a test. Throws on anything it doesn't recognise, with a hint. */
export function refMatcher(ref: CountryRef, game: Game, lists: CountryList[]): (c: Country) => boolean {
  const [kind, ...rest] = ref.split(':');
  const value = rest.join(':');
  if (ref === 'all') return () => true;
  if (!value) {
    const c = findCountry(ref, game);
    return (x) => x.code === c.code;
  }
  switch (kind) {
    case 'continent': {
      const want = norm(value);
      if (!game.countries.some((c) => norm(c.continent) === want)) throw new Error(`Unknown continent "${value}" (${[...new Set(game.countries.map((c) => c.continent))].join(', ')})`);
      return (c) => norm(c.continent) === want;
    }
    case 'theme': {
      const t = game.themes.find((t) => t.id === value) ?? (() => { throw new Error(`Unknown theme "${value}" (${game.themes.map((t) => t.id).join(', ')})`); })();
      const set = new Set(t.countryCodes);
      return (c) => set.has(c.code);
    }
    case 'level': {
      const tier = LEVEL_TIER[value] ?? (() => { throw new Error(`Unknown level "${value}" (easy, medium, hard)`); })();
      return (c) => c.tier === tier;
    }
    case 'list': {
      const l = lists.find((l) => l.id === value && !l.disabled) ?? (() => { throw new Error(`Unknown country list "${value}" (${lists.map((l) => l.id).join(', ') || 'none yet'})`); })();
      const set = new Set(l.codes);
      return (c) => set.has(c.code);
    }
    default:
      throw new Error(`Unknown country reference "${ref}" (use a code, a name, continent:, theme:, level:, list: or all)`);
  }
}

/** A country by ISO code or name (case-insensitive). */
export function findCountry(ref: string, game: Game): Country {
  const s = ref.trim();
  const c = game.byCode.get(s.toUpperCase()) ?? game.countries.find((c) => norm(c.name) === norm(s));
  if (c) return c;
  const close = game.countries.filter((c) => norm(c.name).includes(norm(s).slice(0, 4))).slice(0, 4).map((c) => c.name);
  throw new Error(`Unknown country "${ref}"${close.length ? ` (did you mean ${close.join(', ')}?)` : ''}`);
}

/** Refs of the same kind are alternatives (Asia or Europe); different kinds narrow each other (Asian and easy).
 *  Countries, themes and lists all count as one kind: "sets of countries". */
const groupOf = (ref: CountryRef) => {
  const k = ref.split(':')[0];
  return k === 'continent' || k === 'level' ? k : 'set';
};
const matchAll = (refs: CountryRef[] | undefined, game: Game, lists: CountryList[]) => {
  if (!refs?.length) return null;
  const groups = new Map<string, ((c: Country) => boolean)[]>();
  for (const r of refs) (groups.get(groupOf(r)) ?? groups.set(groupOf(r), []).get(groupOf(r))!).push(refMatcher(r, game, lists));
  return (c: Country) => [...groups.values()].every((ms) => ms.some((m) => m(c)));
};
const anyOf = (refs: CountryRef[] | undefined, game: Game, lists: CountryList[]) => {
  if (!refs?.length) return null;
  const ms = refs.map((r) => refMatcher(r, game, lists));
  return (c: Country) => ms.some((m) => m(c));
};

/** The selection as two tests: `allowed` (may be chosen) and `excluded` (must never appear anywhere). */
export function selector(game: Game, lists: CountryList[], ...sels: (Selection | undefined)[]) {
  const includes = sels.map((s) => matchAll(s?.include, game, lists)).filter(Boolean) as ((c: Country) => boolean)[];
  const excludes = sels.map((s) => anyOf(s?.exclude, game, lists)).filter(Boolean) as ((c: Country) => boolean)[];
  const require = sels.flatMap((s) => s?.require ?? []);
  const excludedCode = (code: string) => {
    const c = game.byCode.get(code);
    return !!c && excludes.some((x) => x(c));
  };
  return {
    allowed: (c: Country) => includes.every((m) => m(c)) && !excludes.some((x) => x(c)) && require.every((r) => c[r]),
    excluded: excludedCode,
  };
}
