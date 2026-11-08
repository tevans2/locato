#!/usr/bin/env bun
// Content for the video generator: phrases (hooks, spoken lines, outros, captions), country lists, presets (saved
// recipes) and week plans. Defaults live in content/<kind>.json (in git); the promo service holds online additions and
// overrides (merged by id, "disabled": true hides a default), which the admin can edit too. Tools read the online items
// from a local cache (.cache/content), so making videos works offline; pull refreshes it.
//
//   npm run content                         what's loaded, per kind (default / online)
//   npm run content -- pull                 refresh the local copy of the online items
//   npm run content -- list <kind>          phrases | lists | presets | plans
//   npm run content -- show <kind> <id>
//   npm run content -- validate             schemas, references, and every preset/plan recipe compiles
//   npm run content -- export <kind>        print the merged items (a starting point for edits)
//   npm run content -- push <kind> <file>   save these items online (each one added or replaced by id)
//   npm run content -- rm <kind> <id>       remove an online item (a default with that id stays)
//   npm run content -- schema [recipe|<kind>]  JSON Schema (for editors and the admin's forms)
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {compile} from '../../src/content/compile';
import {validateItem} from '../../src/content/merge';
import {CONTENT_KINDS, Recipe, type ContentKind} from '../../src/content/types';
import {KINDS, api, assets, loadContent, loadGame, pullContent, readCache, readDefaults} from './env';

for (const ev of ['uncaughtException', 'unhandledRejection'] as const) process.on(ev, (e: any) => (console.error(`✗ ${e?.message ?? e}`), process.exit(1)));

const [cmd = 'summary', a1, a2] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const kindArg = (k?: string): ContentKind => {
  if (!k || !(KINDS as string[]).includes(k)) throw new Error(`Give a kind: ${KINDS.join(', ')}`);
  return k as ContentKind;
};
const describe = (kind: ContentKind, x: any) =>
  kind === 'phrases' ? `${x.slot.padEnd(8)} ${x.alias ? `(${x.alias}) ` : ''}${JSON.stringify(x.text)}${x.default ? '  [default]' : ''}` : kind === 'lists' ? `${x.name} · ${x.codes.length} countries` : `${x.name}`;

async function validate() {
  const content = loadContent({quiet: true});
  const problems = [...content.problems];
  const KNOWN = new Set(['n', 'score', 'theme', 'date', 'tags', 'answer', 'country', 'place', 'k', 'names', 'side', 'pct']);
  const seen = new Map<string, string>();
  for (const p of content.phrases) {
    if (p.alias) {
      const key = `${p.slot}:${p.alias}`;
      if (seen.has(key)) problems.push(`phrases: alias "${p.alias}" used by ${seen.get(key)} and ${p.id}`);
      seen.set(key, p.id);
    }
    for (const m of `${p.text} ${p.say ?? ''}`.matchAll(/\{(\w+)\}/g)) if (!KNOWN.has(m[1])) problems.push(`phrases: ${p.id} uses unknown {${m[1]}}`);
  }
  const game = loadGame();
  const recipes = [
    ...content.presets.map((p) => [`preset ${p.id}`, p.recipe] as const),
    ...content.plans.flatMap((pl) => pl.days.flatMap((day, d) => day.map((s, k) => [`plan ${pl.id} day ${d + 1} slot ${k + 1}`, 'preset' in s ? content.presets.find((p) => p.id === s.preset)?.recipe ?? null : s.recipe] as const))),
  ];
  for (const [where, recipe] of recipes) {
    if (!recipe) {
      problems.push(`${where}: unknown preset`);
      continue;
    }
    try {
      const c = compile(recipe, {game, content, seed: 'validate', assets, today: '2026-01-01'});
      c.warnings.forEach((w) => problems.push(`${where}: ${w}`));
    } catch (e) {
      problems.push(`${where}: ${(e as Error).message}`);
    }
  }
  console.log(problems.length ? `✗ ${problems.length} problem(s):\n  ${problems.join('\n  ')}` : `✓ content is valid (${KINDS.map((k) => `${content[k].length} ${k}`).join(', ')}; ${recipes.length} recipes compile)`);
  if (problems.length) process.exit(1);
}

if (cmd === 'summary') {
  const c = loadContent();
  const cache = readCache();
  for (const kind of KINDS) console.log(`${kind.padEnd(8)} ${String(c[kind].length).padStart(3)} loaded  (${readDefaults(kind).length} default, ${cache?.items[kind]?.length ?? 0} online)`);
  console.log(cache ? `Online copy from ${cache.fetchedAt} (refresh: npm run content -- pull)` : 'No online copy yet: npm run content -- pull');
} else if (cmd === 'pull') {
  const items = await pullContent();
  for (const kind of KINDS) console.log(`${kind.padEnd(8)} ${items[kind]?.length ?? 0} online item(s)`);
} else if (cmd === 'list') {
  const kind = kindArg(a1);
  const c = loadContent();
  for (const x of c[kind] as any[]) console.log(`${x.id.padEnd(26)} ${(c.sources[`${kind}:${x.id}`] ?? '').padEnd(15)} ${describe(kind, x)}`);
} else if (cmd === 'show') {
  const kind = kindArg(a1);
  const x = (loadContent()[kind] as any[]).find((y) => y.id === a2) ?? (() => { throw new Error(`No ${kind} "${a2}"`); })();
  console.log(JSON.stringify(x, null, 2));
} else if (cmd === 'export') {
  console.log(JSON.stringify(loadContent()[kindArg(a1)], null, 2));
} else if (cmd === 'validate') await validate();
else if (cmd === 'push') {
  const kind = kindArg(a1);
  if (!a2) throw new Error('Give the file to push');
  const raw = JSON.parse(readFileSync(resolve(a2), 'utf8'));
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  const bad = items.map((x, i) => [i, validateItem(kind, x)] as const).filter(([, r]) => !r.ok);
  if (bad.length) throw new Error(`Invalid items (nothing saved):\n  ${bad.map(([i, r]) => `[${i}] ${(r as any).error}`).join('\n  ')}`);
  for (const x of items as any[]) await api(`/content/${kind}/${x.id}`, {method: 'PUT', json: x});
  console.log(`✓ saved ${items.length} ${kind} item(s) online`);
  await pullContent();
} else if (cmd === 'rm') {
  const kind = kindArg(a1);
  const r = await api<{removed: number}>(`/content/${kind}/${a2}`, {method: 'DELETE'});
  console.log(r.removed ? `✓ removed online ${kind} "${a2}"` : `· no online ${kind} "${a2}" (defaults can only be hidden: push it with "disabled": true)`);
  await pullContent();
} else if (cmd === 'schema') console.log(JSON.stringify(z.toJSONSchema(!a1 || a1 === 'recipe' ? Recipe : z.array(CONTENT_KINDS[kindArg(a1)])), null, 2));
else throw new Error(`Unknown command "${cmd}" (summary, pull, list, show, validate, export, push, rm, schema)`);
