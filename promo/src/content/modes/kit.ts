// Shared tools for mode builders: the difficulty ladder, picking countries, map framing.
import type {Box, QuizRound} from '../../locato/schema';
import type {Country, Game, Tier} from '../game';
import type {Vars} from '../phrases';
import type {ModeId, RoundRecipe} from '../types';

/** Host-provided file access, so builders stay free of Node APIs. */
export type Assets = {
  /** The game's flag SVG source for a country code. */
  flagSvg: (code: string) => string;
};

export type Kit = {
  game: Game;
  rand: () => number;
  shuffle: <T>(xs: readonly T[]) => T[];
  /** Codes (and "pin:<id>", "split:<angle>" keys) already used in this video. */
  used: Set<string>;
  /** Codes used in recent videos: avoided when possible. */
  avoid: Set<string>;
  assets: Assets;
  /** Write a generated file under public/ (e.g. flag-colour stages); returns its public path. */
  emit: (path: string, contents: string) => string;
};

export type RoundCtx = {
  i: number;
  n: number;
  /** Difficulty for this round (from the ladder or the round's `level`). */
  tier: Tier;
  /** May this country be chosen (recipe + round selection)? */
  allowed: (c: Country) => boolean;
  /** Must this code never appear (recipe + round exclusions)? */
  excluded: (code: string) => boolean;
  /** The round's fixed country, if it has one. */
  pick?: Country;
  recipe: RoundRecipe;
};

export type ModeDef = {
  id: ModeId;
  /** Badge text, named after the Locato mode. */
  label: string;
  /** Caption hashtags. */
  tags: string;
  /** CLI names (`--kind flags`). */
  aliases?: string[];
  /** Ladder thinking time starts here (seconds) and grows by 2s to the boss. */
  baseSeconds: number;
  /** Default phrase for the spoken reveal. Recipes can swap the generic one ("answer.thats"). */
  answer: string;
  /** Map modes draw the world map (longer base timers in mixes). */
  map?: boolean;
  /** Supports a fixed `pick`. */
  pick?: boolean;
  build: (k: Kit, r: RoundCtx) => {round: QuizRound; vars: Vars};
};

// ---- the difficulty ladder ----------------------------------------------------------------------------
/** Fame tier for round i of n: 1, 1, 2, 3, 3 (the boss always comes from the hardest pool). */
export const ladderTier = (i: number, n: number): Tier => (i === n - 1 ? 3 : ([1, 1, 2, 3] as const)[Math.min(3, Math.floor((i * 4) / Math.max(1, n - 1)))]);
/** Easy, medium, hard thirds. */
export const thirdsTier = (i: number, n: number): Tier => ([1, 2, 3] as const)[Math.min(2, Math.floor((i * 3) / n))];
/** Thinking time grows with difficulty: easy rounds are quick, the boss gets the most. */
export const ladderSeconds = (i: number, n: number, base: number) => +(base + (i / Math.max(1, n - 1)) * 2).toFixed(2);

/** One country of a tier that passes `ok`, preferring ones not used recently; a fixed pick wins. */
export function pickCountry(k: Kit, r: RoundCtx, ok: (c: Country) => boolean) {
  if (r.pick) {
    if (!ok(r.pick) || !k.game.geo.has(r.pick.code) || !r.pick.flag) throw new Error(`${r.pick.name} doesn't fit round ${r.i + 1} (${r.recipe.mode})`);
    if (k.used.has(r.pick.code)) throw new Error(`${r.pick.name} is already in this video`);
    k.used.add(r.pick.code);
    return r.pick;
  }
  const pool = k.game.countries.filter((c) => c.flag && k.game.geo.has(c.code) && !k.used.has(c.code) && ok(c));
  const choose = (xs: Country[]) => k.shuffle(xs)[0];
  const c = choose(pool.filter((c) => c.tier === r.tier && !k.avoid.has(c.code))) ?? choose(pool.filter((c) => c.tier === r.tier)) ?? choose(pool);
  if (!c) throw new Error(`Not enough countries match round ${r.i + 1} (${r.recipe.mode}); widen the selection`);
  k.used.add(c.code);
  return c;
}

// ---- map framing: a view with the quiz stage's aspect (1000×760) --------------------------------------------
const ASPECT = 1000 / 760; // the quiz stage (src/locato/templates/Quiz.tsx STAGE)
export const fit = (b: number[], pad = 1.25, minW = 160): Box => {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  let w = Math.max((b[2] - b[0]) * pad, minW), h = Math.max((b[3] - b[1]) * pad, minW / ASPECT);
  if (w / h < ASPECT) w = h * ASPECT;
  else h = w / ASPECT;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2].map((v) => +v.toFixed(1)) as Box;
};
export const union = (k: Kit, codes: string[]) => {
  const bs = codes.map((c) => k.game.geo.get(c)!.main);
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
};
