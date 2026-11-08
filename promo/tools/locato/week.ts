#!/usr/bin/env bun
// A week of Locato shorts from a plan in content (content/plans.json + R2): one list per day, one recipe or
// preset per posting slot. The default plan follows the research: 14 videos, 2 a day, mostly play-along quizzes,
// look-alikes, One Life, a daily warm-up, and hooks rotating A/B/D (E "Beat my score" only when you really played it).
//   bun tools/locato/week.ts [--plan default] [--start YYYY-MM-DD] [--voice none] [--print]
// Then: npm run check -- videos/<date>-*.json   and   npm run render -- videos/<date>-*.json
import {compile} from '../../src/content/compile';
import type {Recipe} from '../../src/content/types';
import {assets, loadContent, loadGame, realDailyCodes, recentlyUsed, soundProps, writeCompiled} from './env';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const start = new Date(arg('start') ? `${arg('start')}T12:00:00Z` : Date.now());
const voice = arg('voice');
const print = process.argv.includes('--print');

const game = loadGame();
const content = loadContent();
const planId = arg('plan') ?? 'default';
const plan = content.plans.find((p) => p.id === planId);
if (!plan) throw new Error(`No plan "${planId}" (have: ${content.plans.map((p) => p.id).join(', ')})`);
console.log(`Plan: ${plan.name}`);

const SLOT_NAMES = ['am', 'pm', 'eve', 'late'];
let made = 0;
for (const [d, day] of plan.days.entries()) {
  const date = new Date(start.getTime() + d * 864e5).toISOString().slice(0, 10);
  for (const [s, slot] of day.entries()) {
    const label = `${date} ${SLOT_NAMES[s]?.toUpperCase() ?? s}`;
    try {
      const recipe: Recipe = structuredClone('preset' in slot ? content.presets.find((p) => p.id === slot.preset)?.recipe ?? (() => { throw new Error(`no preset "${slot.preset}"`); })() : slot.recipe);
      if (recipe.format === 'daily') recipe.date ??= date;
      if (voice) recipe.style = {...recipe.style, voice};
      const c = compile(recipe, {game, content, seed: `${date}:${s}`, avoid: recentlyUsed(), exclude: recipe.format === 'daily' ? await realDailyCodes(recipe.date!) : [], assets, today: date});
      const kind = c.template === 'quiz' ? String((c.props as any).meta.kind) : c.template;
      const name = `${date}-${SLOT_NAMES[s] ?? s}-${kind}${(c.props as any).mode === 'one-life' ? '-onelife' : ''}`;
      console.log(`\n${label}: ${name}${c.warnings.length ? `\n  ⚠ ${c.warnings.join('\n  ⚠ ')}` : ''}`);
      if (print) continue;
      writeCompiled(c, {name, seed: `${date}:${s}`, extraProps: soundProps(recipe.style), voice: recipe.style?.voice, intensity: recipe.style?.intensity, engine: recipe.style?.engine});
      made++;
    } catch (e) {
      console.warn(`\n${label}: skipped (${(e as Error).message})`);
    }
  }
}
console.log(`\n${print ? 'Plan only (--print): nothing written.' : `Made ${made} video(s).`} Versus and speedrun need your own recordings: npm run new -- versus/speedrun (see VIDEOS.md).`);
