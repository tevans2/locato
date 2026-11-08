// Phrases: every hook, spoken answer, closing question, note, call to action and caption is data
// (content/phrases.json + R2). A recipe names one by id (or alias), writes its own text, or takes the default.
import type {Phrase, PhraseRef} from './types';

export type Vars = Record<string, string | number | undefined>;
export type PhraseCtx = {format: 'quiz' | 'daily' | 'lookalikes'; rules?: 'score' | 'one-life'; skill?: 'flag' | 'shape'};
export type Line = {id: string | null; text: string; say: string | null};

export const fill = (template: string, vars: Vars) =>
  template.replace(/\{(\w+)\}/g, (all, k) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`Missing value for {${k}} in "${template}"`);
    return String(v);
  });

const suits = (p: Phrase, ctx: PhraseCtx) =>
  (!p.suits?.format || p.suits.format.includes(ctx.format)) &&
  (!p.suits?.rules || !ctx.rules || p.suits.rules.includes(ctx.rules)) &&
  (!p.suits?.skill || !ctx.skill || p.suits.skill.includes(ctx.skill));

/** Find a phrase by id or alias within a slot. */
export function findPhrase(phrases: Phrase[], slot: Phrase['slot'], ref: string) {
  const live = phrases.filter((p) => !p.disabled && p.slot === slot);
  const p = live.find((p) => p.id === ref) ?? live.find((p) => p.alias === ref) ?? live.find((p) => p.id === `${slot}.${ref}`);
  if (!p) throw new Error(`No ${slot} phrase "${ref}" (have: ${live.map((p) => p.alias ? `${p.id} (${p.alias})` : p.id).join(', ')})`);
  return p;
}

/**
 * Resolve a slot to text. `ref` may be a phrase id/alias, inline {text, say}, or undefined (the default for this
 * context). Returns warnings for choices that don't suit (e.g. "Miss one and you're out" on a score video).
 */
export function resolveLine(phrases: Phrase[], slot: Phrase['slot'], ref: PhraseRef | undefined, ctx: PhraseCtx, vars: Vars, warn: (s: string) => void): Line {
  if (ref && typeof ref === 'object') return {id: null, text: fill(ref.text, vars), say: ref.say ? fill(ref.say, vars) : null};
  let p: Phrase | undefined;
  if (ref) {
    p = findPhrase(phrases, slot, ref);
    if (!suits(p, ctx)) warn(`${slot} "${p.id}" is meant for ${JSON.stringify(p.suits)}, not this ${ctx.format}${ctx.rules ? ` (${ctx.rules})` : ''} video`);
  } else {
    p = phrases.find((x) => !x.disabled && x.slot === slot && x.default && suits(x, ctx));
    if (!p) throw new Error(`No default ${slot} phrase for a ${ctx.format}${ctx.rules ? ` ${ctx.rules}` : ''} video; add one to content/phrases.json or choose one`);
  }
  for (const k of p.needs ?? []) if (vars[k] === undefined) throw new Error(`${slot} "${p.id}" needs a value for {${k}} (pass it in recipe.vars${k === 'score' ? ', e.g. --score 4, and only a score you really got' : ''})`);
  return {id: p.id, text: fill(p.text, vars), say: p.say ? fill(p.say, vars) : null};
}

/** How a title sounds as a spoken hook: questions stay questions, statements end with a full stop. */
export const spokenHook = (title: string) => {
  const t = title.trim();
  if (/[?.!]$/.test(t)) return t;
  if (/^name these/i.test(t)) return `Can you n${t.slice(1)}?`;
  return `${t}.`;
};

/** Spoken version of an on-screen note ("Comment your score 👇" → "Comment your score"). */
export const spokenText = (s: string) => s.replace(/[^\p{L}\p{N}\s'’!?.,]/gu, '').trim();
