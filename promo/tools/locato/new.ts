#!/usr/bin/env bun
// Make a new Locato video spec (videos/<name>.json) from the game's own data, then render it with
// npm run render -- videos/<name>.json. Quiz, daily and look-alike videos are built from a *recipe*
// (src/content/types.ts) using the content in content/*.json + R2 (phrases, country lists, presets).
//
//   bun tools/locato/new.ts quiz        [--kind flags|shapes|capitals|capital-of|codes|colours|which|spot|find|pin|route|split|mix]
//                                       [--modes flag,shape,route] [--mode score|one-life] [--hook a|b|c|d|e|f|<phrase id>|"text"]
//                                       [--count 5] [--seconds 2] [--score 4 (hook e)] [--answer <phrase>] [--caption <phrase>|"text"]
//   bun tools/locato/new.ts daily       [--date today|tomorrow|YYYY-MM-DD] [--count 5] [--modes flag,capital,shape]
//   bun tools/locato/new.ts lookalikes  [--skill flag|shape] [--count 3] [--seconds 4]
//     choosing countries: [--continent Europe] [--from continent:asia,theme:islands,level:easy,list:<id>,JP] [--list <id>]
//                         [--exclude FR,list:<id>] [--pick "chad, romania"] [--boss liechtenstein] [--no-fresh]
//     from saved recipes: [--preset <id>] [--recipe file.json] (other flags override them)   [--print: show, don't write]
//   bun tools/locato/new.ts speedrun    --video rec.mp4 --title "..." [--start s] [--stop s] [--trim-start s] [--trim-end s]
//                                       [--speed 1] [--callout "12=No hints"]... [--zoom "3-7@0.5,0.4x1.5"]...
//   bun tools/locato/new.ts versus      --top a.mp4 --top-name Alex --bottom b.mp4 --bottom-name Sam [--winner top|bottom]
//                                       [--top-emoji 🌋] [--top-result "4:29"] [--bottom-emoji …] [--bottom-result …] [--title "..."]
//   bun tools/locato/new.ts leaderboard --mode flags [--variant ""] [--limit 10] [--hide name1,name2] [--anon]
// Every command also takes --seed (same seed = same picks), --name (file name), --title, --badge, --question, --cta,
// --music none|<name in public/locato/music>|track.mp3 [--music-volume 0.5], --effects off,
// --intensity calm|lively|hype, --voice default|am_michael|bm_george|…|none, --engine chatterbox|kokoro.
import {copyFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {basename, extname, join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {compile} from '../../src/content/compile';
import {modeByName} from '../../src/content/modes';
import {findPhrase} from '../../src/content/phrases';
import {Recipe, type Style} from '../../src/content/types';
import {ROOT, assets, loadContent, loadGame, realDailyCodes, recentlyUsed, soundProps, writeCompiled, writeSpec} from './env';

const LOCATO = resolve(process.env.LOCATO_DIR ?? join(ROOT, '..'));

// ---- args ----------------------------------------------------------------------
const [cmd, ...rest] = process.argv.slice(2);
const opts: Record<string, string[]> = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const next = rest[i + 1];
  const val = next === undefined || next.startsWith('--') ? 'true' : (i++, next);
  (opts[key] ??= []).push(val);
}
const opt = (k: string, d?: string) => opts[k]?.at(-1) ?? d;
const num = (k: string, d: number) => (opt(k) !== undefined ? Number(opt(k)) : d);
const numOr = (k: string) => (opt(k) !== undefined ? Number(opt(k)) : undefined);
const many = (k: string) => opts[k] ?? [];
const list = (k: string) => many(k).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(readFileSync(import.meta.path, 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 21).map((l) => l.slice(3)).join('\n'));
  process.exit(0);
}

const seed = opt('seed', String(Date.now()))!;
const today = () => new Date().toISOString().slice(0, 10);
const stamp = () => today().replace(/-/g, '');
const style: Style = {
  ...(opt('music') ? {music: opt('music')} : {}),
  ...(numOr('music-volume') !== undefined ? {musicVolume: numOr('music-volume')} : {}),
  ...(opt('effects') === 'off' || opt('effects') === 'false' ? {effects: false} : {}),
  ...(opt('voice') ? {voice: opt('voice')} : {}),
  ...(opt('intensity') ? {intensity: opt('intensity') as Style['intensity']} : {}),
  ...(opt('engine') ? {engine: opt('engine') as Style['engine']} : {}),
};
const voiceOpts = (s: Style = style) => ({voice: s.voice, intensity: s.intensity, engine: s.engine, speed: opt('speed')});

// ---- recipe formats: quiz, daily, lookalikes -----------------------------------------------------------------
const RECIPE_FORMATS = ['quiz', 'daily', 'lookalikes'];
if (RECIPE_FORMATS.includes(cmd)) {
  const game = loadGame();
  const content = loadContent();
  const drop = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length) && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length))) as Partial<T>;

  // base: a preset or a recipe file; flags override
  let base: any = {format: cmd};
  if (opt('preset')) base = structuredClone((content.presets.find((p) => p.id === opt('preset')) ?? die(`No preset "${opt('preset')}" (have: ${content.presets.map((p) => p.id).join(', ') || 'none yet'})`)).recipe);
  if (opt('recipe')) base = JSON.parse(readFileSync(resolve(opt('recipe')!), 'utf8'));
  if (base.format !== cmd) die(`That ${opt('preset') ? 'preset' : 'recipe'} is a ${base.format} recipe; run: npm run new -- ${base.format} …`);

  // --hook: a phrase (alias or id) or literal title text
  const hookFlag = opt('hook');
  let hook: string | false | undefined, title = opt('title');
  if (hookFlag !== undefined) {
    try {
      hook = findPhrase(content.phrases, 'hook', hookFlag).id;
    } catch {
      title ??= hookFlag; // not a phrase: use it as the title text
    }
  }
  const phraseOrText = (slot: 'caption' | 'answer' | 'question' | 'cta', v?: string) => {
    if (v === undefined) return undefined;
    try {
      return findPhrase(content.phrases, slot, v).id;
    } catch {
      return {text: v};
    }
  };
  const include = [...(opt('continent') ? [`continent:${opt('continent')}`] : []), ...list('from'), ...list('list').map((l) => `list:${l}`)];
  const flags: any = drop({
    count: numOr('count'),
    countries: drop({include, exclude: list('exclude')}),
    copy: drop({hook, title, badge: opt('badge'), question: phraseOrText('question', opt('question')), cta: phraseOrText('cta', opt('cta')), caption: phraseOrText('caption', opt('caption')), answer: phraseOrText('answer', opt('answer'))}),
    style: drop(style),
    vars: drop({score: numOr('score')}),
    ...(opt('no-fresh') === 'true' ? {fresh: false} : {}),
  });
  if (cmd === 'quiz') {
    const kind = opt('kind');
    const modes = list('modes');
    if (kind === 'mix') flags.modes = 'mix';
    else if (kind) flags.modes = [modeByName(kind).id];
    if (modes.length) flags.modes = modes.map((m) => modeByName(m).id);
    if (!base.modes && !base.rounds && !flags.modes) flags.modes = ['flag'];
    flags.picks = list('pick').length ? list('pick') : undefined;
    flags.boss = opt('boss');
    flags.rules = drop({...base.rules, mode: opt('mode'), baseSeconds: numOr('seconds')});
  } else if (cmd === 'daily') {
    const d = opt('date');
    flags.date = d === undefined ? undefined : d === 'today' ? today() : d === 'tomorrow' ? new Date(Date.now() + 864e5).toISOString().slice(0, 10) : d;
    flags.date ??= base.date ?? today();
    if (list('modes').length) flags.modes = list('modes').map((m) => modeByName(m).id);
    flags.seconds = numOr('seconds');
  } else {
    flags.skill = opt('skill');
    flags.seconds = numOr('seconds');
  }
  const merged = drop({
    ...base,
    ...drop(flags),
    copy: drop({...base.copy, ...flags.copy}),
    countries: drop({...base.countries, ...flags.countries, include: [...(base.countries?.include ?? []), ...(flags.countries?.include ?? [])], exclude: [...(base.countries?.exclude ?? []), ...(flags.countries?.exclude ?? [])]}),
    style: drop({...base.style, ...flags.style}),
    vars: drop({...base.vars, ...flags.vars}),
  });
  const parsed = Recipe.safeParse(merged);
  if (!parsed.success) die(`Recipe problems:\n  ${parsed.error.issues.map((e) => `${e.path.join('.') || '(recipe)'}: ${e.message}`).join('\n  ')}`);
  const recipe = parsed.data!;
  const exclude = recipe.format === 'daily' ? await realDailyCodes(recipe.date!) : [];
  let c;
  try {
    c = compile(recipe, {game, content, seed, avoid: recentlyUsed(), exclude, assets, today: today()});
  } catch (e) {
    die(`Can't make that video: ${(e as Error).message}`);
  }
  for (const w of c!.warnings) console.warn(`  ⚠ ${w}`);
  if (opt('print') === 'true') {
    const p: any = c!.props;
    console.log(`${c!.name}  (${c!.template})\n  title: ${p.title || '(no hook)'}  ·  badge: ${p.badge}`);
    (p.rounds ?? p.sets ?? []).forEach((r: any, i: number) => console.log(`  ${i + 1}. ${r.type ?? r.skill}: ${r.answer ?? r.items.map((x: any) => x.name).join(' / ')}${r.boss ? '  (boss)' : ''}${r.seconds ? `  ${r.seconds}s` : ''}`));
    console.log(`  outro: ${p.outro.question} · ${p.outro.cta}\n  caption: ${c!.caption}`);
    process.exit(0);
  }
  writeCompiled(c!, {name: opt('name'), seed, extraProps: soundProps(recipe.style), ...voiceOpts(recipe.style ?? {})});
  if (exclude.length) console.log(`  (left out ${recipe.format === 'daily' ? recipe.date : ''}'s Daily countries: ${exclude.join(', ')})`);
  process.exit(0);
}

// ---- recording/API formats: speedrun, versus, leaderboard (not recipes: they need your own input) ---------------
const outro = (question: string, cta?: string) => ({question: opt('question', question), ...(opt('cta', cta) ? {cta: opt('cta', cta)} : {})});
const write = (template: string, props: object, defaultName: string) => writeSpec(template, {...props, ...soundProps(style)}, opt('name') ?? defaultName, {seed, voice: voiceOpts()});

if (cmd === 'speedrun' || cmd === 'clip') {
  const clip = importClip(opt('video') ?? die('--video <file.mp4> is required'));
  const zooms = many('zoom').map((z) => {
    const m = z.match(/^([\d.]+)-([\d.]+)@([\d.]+),([\d.]+)x([\d.]+)$/) ?? die(`Bad --zoom "${z}" (use start-end@x,yxscale, e.g. 3-7@0.5,0.4x1.5)`);
    return {start: +m![1], end: +m![2], x: +m![3], y: +m![4], scale: +m![5]};
  });
  const callouts = many('callout').map((c) => {
    const [at, ...text] = c.split('=');
    return {at: Number(at), text: text.join('=')};
  });
  const start = opt('start'), stop = opt('stop');
  write('speedrun', {
    title: opt('title') ?? die('--title is required, e.g. --title "Every flag in Africa"'),
    badge: opt('badge', 'Speedrun'),
    clip,
    ...(start !== undefined || stop !== undefined ? {timer: {start: Number(start ?? 0), stop: Number(stop ?? clipSeconds(clip)), label: opt('timer-label', 'TIME')}} : {}),
    ...(callouts.length ? {callouts} : {}),
    ...(zooms.length ? {zooms} : {}),
    outro: outro('Can you beat it?', 'Try a timed run. Free, in your browser.'),
  }, `speedrun-${basename(clip.src, '.mp4')}`);
} else if (cmd === 'versus') {
  const player = (k: 'top' | 'bottom') => ({
    name: opt(`${k}-name`) ?? die(`--${k}-name is required`),
    ...(opt(`${k}-emoji`) ? {emoji: opt(`${k}-emoji`)} : {}),
    ...(opt(`${k}-result`) ? {result: opt(`${k}-result`)} : {}),
    clip: importClip(opt(k) ?? die(`--${k} <file.mp4> is required`)),
  });
  const top = player('top'), bottom = player('bottom');
  write('versus', {
    title: opt('title', `${top.name} vs ${bottom.name}`),
    badge: opt('badge', '1v1 race'),
    top,
    bottom,
    ...(opt('winner') ? {winner: opt('winner')} : {}),
    outro: outro('Who would you beat?', 'Race your friends live. No download.'),
  }, `versus-${top.name}-${bottom.name}-${stamp()}`);
} else if (cmd === 'leaderboard') {
  const mode = opt('mode') ?? die('--mode is required (e.g. flags, capitals, shapes, name-all, map-tap)');
  const variant = opt('variant', '')!;
  const limit = num('limit', 10);
  const base = opt('base', 'https://locato.quest');
  const res = await fetch(`${base}/api/leaderboard?mode=${encodeURIComponent(mode)}&variant=${encodeURIComponent(variant)}&limit=${limit}`);
  const body = (await res.json()) as any;
  if (!res.ok) die(`Leaderboard API: ${body.error ?? res.status}`);
  let label = mode, maxScore: number | undefined;
  try {
    const {gameModeOptions} = await import(join(LOCATO, 'src/core/gameModes.ts'));
    const {LEADERBOARD_MODES} = await import(join(LOCATO, 'src/core/leaderboards.ts'));
    label = gameModeOptions.find((m: any) => m.id === mode)?.label ?? mode;
    maxScore = LEADERBOARD_MODES.find((m: any) => m.mode === mode)?.maxScore;
  } catch {}
  const hide = new Set(many('hide').flatMap((s) => s.split(',')).map((s) => s.trim().toLowerCase()));
  const anon = opt('anon') === 'true';
  const flagged: string[] = [];
  const entries = (body.entries as any[]).map((e) => {
    const bad = isOffensive(e.displayName) || hide.has(String(e.displayName).toLowerCase());
    if (bad) flagged.push(e.displayName);
    return {rank: e.rank, name: anon || bad ? `Player ${e.rank}` : e.displayName, emoji: e.avatarEmoji ?? null, value: body.metric === 'time' ? e.timeMs : e.score ?? e.timeMs};
  });
  if (!entries.length) die(`The ${mode} board is empty.`);
  write('leaderboard', {
    title: opt('title', `Top ${entries.length}: ${label}${variant ? ` (${variant})` : ''}`),
    badge: opt('badge', 'Leaderboard'),
    metric: body.metric,
    ...(maxScore && body.metric === 'score' ? {maxScore} : {}),
    entries,
    outro: outro(entries.length >= 3 ? 'Could you make the podium?' : 'Could you beat that?', 'Try a ranked run. Free, in your browser.'),
  }, `leaderboard-${mode}${variant ? `-${variant}` : ''}-${stamp()}`);
  if (flagged.length) console.log(`  ⚠ replaced ${flagged.length} name(s) with "Player N": ${flagged.map((n) => JSON.stringify(n)).join(', ')}`);
  console.log('  Check every name in the spec before posting; edit or use --hide / --anon.');
} else {
  die(`Unknown command "${cmd}". Try: quiz, lookalikes, daily, speedrun, versus, leaderboard (or --help).`);
}


// ---- helpers --------------------------------------------------------------------------------

/** Copy a recording into public/locato/clips and read its size and length. */
function importClip(path: string) {
  const src = resolve(path);
  if (!existsSync(src)) die(`No such file: ${path}`);
  const dir = join(ROOT, 'public/locato/clips');
  mkdirSync(dir, {recursive: true});
  const name = basename(src, extname(src)).toLowerCase().replace(/[^a-z0-9-]+/g, '-') + extname(src).toLowerCase();
  const dest = join(dir, name);
  if (src !== dest) copyFileSync(src, dest);
  const probe = JSON.parse(
    execFileSync('npx', ['remotion', 'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation:format=duration', '-of', 'json', dest], {cwd: ROOT}).toString(),
  );
  const s = probe.streams?.[0] ?? die(`No video stream in ${path}`);
  const rotated = Math.abs(Number(s.side_data_list?.[0]?.rotation ?? 0)) === 90;
  return {
    src: `locato/clips/${name}`,
    width: rotated ? s.height : s.width,
    height: rotated ? s.width : s.height,
    duration: Number(probe.format.duration),
    ...(opt('trim-start') ? {trimStart: Number(opt('trim-start'))} : {}),
    ...(opt('trim-end') ? {trimEnd: Number(opt('trim-end'))} : {}),
    ...(opt('speed') ? {playbackRate: Number(opt('speed'))} : {}),
    muted: opt('sound') !== 'true',
  };
}

function clipSeconds(c: {duration: number; trimStart?: number; trimEnd?: number}) {
  return c.duration - (c.trimStart ?? 0) - (c.trimEnd ?? 0);
}

/** A small blocklist for public videos. Not perfect: always read the names before posting. */
function isOffensive(name: string) {
  const s = String(name).toLowerCase().replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[4]/g, 'a').replace(/[$5]/g, 's').replace(/[^a-z]/g, '');
  return /(fuck|fuk|shit|cunt|bitch|dick|cock|pussy|nigg|fag|slut|whore|rape|nazi|hitler|poes|kaffir|porn|sex|penis|vagina|asshole|wank|twat|retard)/.test(s);
}
