#!/usr/bin/env node
// Render videos from JSON specs (or any composition id), bundling once.
//   node tools/render.mjs videos/quiz-flags-hard.json [more.json ...]   -> out/<name>.mp4
//   node tools/render.mjs videos/*.json --check                           -> stills + contact sheet per video
//   node tools/render.mjs LocatoAvatar                                    -> any composition by id
// Flags: --check (stills every 0.5s, no mp4)   --guides (draw safe areas on stills)   --open (open mp4s when done)
// Only one mp4 render runs at a time across all processes (see tools/lock.mjs); others wait their turn.
import {bundle} from '@remotion/bundler';
import {rmSync} from 'node:fs';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withLock} from './lock.mjs';

const TEMPLATES = {
  quiz: 'LocatoQuiz',
  daily: 'LocatoQuiz',
  lookalikes: 'LocatoLookalikes',
  clip: 'LocatoClip',
  speedrun: 'LocatoClip',
  versus: 'LocatoVersus',
  leaderboard: 'LocatoLeaderboard',
};

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) {
  console.error('Usage: node tools/render.mjs <spec.json | CompositionId> ... [--check] [--guides] [--open]');
  process.exit(2);
}

const jobs = [];
for (const t of targets) {
  if (t.endsWith('.json')) {
    const spec = JSON.parse(await readFile(t, 'utf8'));
    const id = TEMPLATES[spec.template];
    if (!id) throw new Error(`${t}: unknown template "${spec.template}" (use ${Object.keys(TEMPLATES).join(', ')})`);
    jobs.push({name: basename(t, '.json'), id, props: spec.props});
  } else {
    jobs.push({name: t, id: t, props: {}});
  }
}

// Library voice clips (https URLs in R2) are rendered from a local copy, exactly like locally made clips:
// Remotion mixes remote audio slightly differently, and a local copy makes renders repeatable offline.
const CACHE = resolve('public/locato/voice-cache');
async function localise(voice) {
  if (!voice) return voice;
  const one = async (c) => {
    if (!c || !/^https?:\/\//.test(c.src)) return c;
    const name = c.src.split('?')[0].split('/').pop();
    const file = join(CACHE, name);
    if (!existsSync(file)) {
      const r = await fetch(c.src);
      if (!r.ok) throw new Error(`Voice clip ${c.src}: HTTP ${r.status}`);
      await mkdir(CACHE, {recursive: true});
      await writeFile(file, Buffer.from(await r.arrayBuffer()));
    }
    return {...c, src: `locato/voice-cache/${name}`};
  };
  const out = {};
  for (const [k, v] of Object.entries(voice)) out[k] = Array.isArray(v) ? await Promise.all(v.map(one)) : await one(v);
  return out;
}
for (const job of jobs) if (job.props?.voice) job.props = {...job.props, voice: await localise(job.props.voice)};

console.log('Bundling…');
const serveUrl = await bundle({entryPoint: resolve('src/index.ts')});
// Each bundle is ~160 MB in the temp folder; always delete ours on exit (even on errors or Ctrl-C).
const dropBundle = () => rmSync(serveUrl, {recursive: true, force: true});
process.on('exit', dropBundle);
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => process.exit(130));
const outputs = [];
for (const job of jobs) {
  const inputProps = {...job.props, ...(flags.has('--guides') ? {guides: true, showGuides: true} : {})};
  const composition = await selectComposition({serveUrl, id: job.id, inputProps});
  const secs = composition.durationInFrames / composition.fps;
  if (flags.has('--check')) {
    const dir = resolve('out/check', job.name);
    await mkdir(dir, {recursive: true});
    const every = Number(args.find((a) => a.startsWith('--every='))?.slice(8) ?? 0.5);
    for (let s = 0; s < secs; s += every) {
      const frame = Math.min(composition.durationInFrames - 1, Math.round(s * composition.fps));
      await renderStill({serveUrl, composition, frame, inputProps, output: join(dir, `f${String(frame).padStart(4, '0')}.png`), scale: 0.5});
    }
    execFileSync('python3', [resolve('tools/remotion/contact.py'), dir, join(dir, 'sheets')], {stdio: 'inherit'});
    console.log(`✓ ${job.name}: ${secs.toFixed(1)}s, check sheets in ${join(dir, 'sheets')}`);
  } else {
    const output = resolve('out', `${job.name}.mp4`);
    let last = -1;
    await withLock('render', () => renderMedia({
      serveUrl, composition, inputProps, codec: 'h264', crf: 18, outputLocation: output,
      onProgress: ({progress}) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== last) { last = pct; process.stdout.write(`\r  ${job.name}: ${pct}%`); }
      },
    }));
    process.stdout.write('\n');
    console.log(`✓ ${output} (${secs.toFixed(1)}s)`);
    outputs.push(output);
  }
}
if (flags.has('--open') && outputs.length) execFileSync('open', outputs);
