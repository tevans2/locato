#!/usr/bin/env bun
// The voice library, through the promo service: clips are made on the Mac (npm run voice: Chatterbox / Kokoro) or
// recorded by a person, then uploaded here. The service stores the audio in R2 and the record in D1, so the admin can
// pick it the moment it's uploaded. Nothing is generated on a server.
//
//   npm run voices                                      every voice and how many lines it has
//   npm run voices -- create <id> --name "Tate" [--engine human|chatterbox|kokoro|other] [--description "…"]
//   npm run voices -- add <voice> "That's Kenya!" kenya.wav [--source recorded|uploaded|generated] [--replace]
//   npm run voices -- import <voice> lines.csv          batch: a CSV with columns text,file (file paths relative to the CSV)
//   npm run voices -- from-spec <voice> videos/*.json   upload the clips `npm run voice` already made for these videos
//   npm run voices -- missing <voice> videos/*.json [--csv sheet.csv]   lines these videos need that the voice doesn't have
//   npm run voices -- apply <voice> videos/*.json [--partial]           point the videos' voice at the library clips
//   npm run voices -- ls <voice> [--search kenya]
//   npm run voices -- rm <voice> "<text>"|<key>    ·    npm run voices -- hide <voice>
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {clipKey, coverage, voiceLines, type ClipInfo, type VoiceInfo, type VoiceLine} from '../../src/content/voice';
import {ROOT, api} from './env';

for (const ev of ['uncaughtException', 'unhandledRejection'] as const) process.on(ev, (e: any) => (console.error(`✗ ${e?.message ?? e}`), process.exit(1)));

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['name', 'engine', 'description', 'source', 'search', 'csv'];
const flagVal = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const has = (k: string) => argv.includes(`--${k}`);
const pos = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1]?.startsWith('--') && VALUE_FLAGS.includes(argv[i - 1].slice(2))));
const [cmd = 'list', ...args] = pos;

type Voice = {voice: VoiceInfo; clips: Record<string, ClipInfo>};
const getVoice = (id: string) => api<Voice>(`/voices/${id}`);
const TYPES: Record<string, string> = {'.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg'};

function durationOf(file: string) {
  if (extname(file).toLowerCase() === '.wav') {
    const b = readFileSync(file);
    let off = 12, rate = 0, block = 0;
    while (off + 8 <= b.length) {
      const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
      if (id === 'fmt ') (rate = b.readUInt32LE(off + 8 + 4)), (block = b.readUInt16LE(off + 8 + 12));
      if (id === 'data') return size / (rate * block);
      off += 8 + size + (size % 2);
    }
    throw new Error(`${file}: not a readable WAV`);
  }
  const d = Number(execFileSync('npx', ['remotion', 'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {cwd: ROOT}).toString().trim());
  if (!(d > 0)) throw new Error(`${file}: couldn't read its length`);
  return d;
}

async function addClip(voice: string, text: string, file: string, source: ClipInfo['source'], opts: {replace?: boolean; duration?: number} = {}) {
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`${file}: use ${Object.keys(TYPES).join(', ')}`);
  const duration = opts.duration ?? durationOf(file);
  const q = new URLSearchParams({text, duration: duration.toFixed(3), source, ...(opts.replace ? {replace: '1'} : {})});
  return api<{key: string; skipped?: boolean; clip?: ClipInfo}>(`/voices/${voice}/clips?${q}`, {method: 'PUT', body: Bun.file(file), headers: {'content-type': type}});
}

const specs = (files: string[]) =>
  files.map((f) => {
    if (!f.endsWith('.json')) throw new Error(`Not a video spec: ${f}`);
    return {f, spec: JSON.parse(readFileSync(f, 'utf8'))};
  });

if (cmd === 'list') {
  const {voices} = await api<{voices: (VoiceInfo & {count: number})[]}>('/voices');
  if (!voices.length) console.log('No voices yet. Create one: npm run voices -- create <id> --name "…"');
  for (const v of voices) console.log(`${v.id.padEnd(22)} ${String(v.count).padStart(5)} lines  ${v.engine.padEnd(10)} ${v.name}`);
} else if (cmd === 'create') {
  const [id] = args;
  if (!id) throw new Error('Usage: npm run voices -- create <id> --name "…"');
  const r = await api<{created: boolean}>(`/voices/${id}`, {method: 'PUT', json: {name: flagVal('name') ?? id, engine: flagVal('engine') ?? 'human', ...(flagVal('description') ? {description: flagVal('description')} : {})}});
  console.log(`✓ ${r.created ? 'created' : 'updated'} voice "${id}". Add lines: npm run voices -- add ${id} "That's Kenya!" kenya.wav`);
} else if (cmd === 'add') {
  const [voice, text, file] = args;
  if (!voice || !text || !file) throw new Error('Usage: npm run voices -- add <voice> "<text>" <file>');
  const r = await addClip(voice, text, resolve(file), (flagVal('source') as ClipInfo['source']) ?? 'uploaded', {replace: has('replace')});
  console.log(r.skipped ? `· "${text}" is already in ${voice} (use --replace for a new take)` : `✓ ${voice}: "${text}" (${r.clip!.duration}s) → ${r.clip!.url}`);
} else if (cmd === 'import') {
  const [voice, csv] = args;
  const rows = readFileSync(csv, 'utf8').split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const head = rows.shift()!.map((h) => h.toLowerCase());
  const ti = head.indexOf('text'), fi = head.indexOf('file');
  if (ti < 0 || fi < 0) throw new Error('The CSV needs columns "text" and "file"');
  let added = 0, skipped = 0, missing = 0;
  for (const row of rows) {
    const file = resolve(dirname(csv), row[fi] ?? '');
    if (!row[fi] || !existsSync(file)) {
      missing++;
      continue;
    }
    const r = await addClip(voice, row[ti], file, (flagVal('source') as ClipInfo['source']) ?? 'recorded', {replace: has('replace')});
    r.skipped ? skipped++ : added++;
  }
  console.log(`✓ ${voice}: ${added} added, ${skipped} already there${missing ? `, ${missing} row(s) without a file yet` : ''}`);
} else if (cmd === 'from-spec') {
  const [voice, ...files] = args;
  let ensured = false, added = 0, skipped = 0;
  for (const {f, spec} of specs(files)) {
    const v = spec.props?.voice;
    if (!v) {
      console.warn(`· ${basename(f)}: no voice yet (npm run voice -- ${f})`);
      continue;
    }
    if (!ensured) {
      const exists = await getVoice(voice).then(() => true, () => false);
      if (!exists) {
        const s = spec.voiceSettings ?? {};
        await api(`/voices/${voice}`, {method: 'PUT', json: {name: flagVal('name') ?? `${s.engine ?? 'voice'} ${s.voice ?? ''} ${s.intensity ?? ''}`.replace(/\s+/g, ' ').trim(), engine: ['chatterbox', 'kokoro'].includes(s.engine) ? s.engine : 'other', settings: s}});
        console.log(`✓ created voice "${voice}" from ${basename(f)}'s settings`);
      }
      ensured = true;
    }
    for (const c of Object.values(v).flat() as {src: string; duration: number; text: string}[]) {
      if (/^https?:/.test(c.src)) continue; // already a library clip
      const r = await addClip(voice, c.text, join(ROOT, 'public', c.src), 'generated', {replace: has('replace'), duration: c.duration});
      r.skipped ? skipped++ : added++;
    }
  }
  console.log(`✓ ${voice}: ${added} line(s) uploaded, ${skipped} already there`);
} else if (cmd === 'missing') {
  const [voice, ...files] = args;
  const v = await getVoice(voice);
  const all = new Map<string, VoiceLine>();
  for (const {spec} of specs(files)) for (const l of voiceLines(spec.template, spec.props)) all.set(clipKey(l.text), l);
  const {missing} = coverage(v, [...all.values()]);
  console.log(`${voice}: ${all.size - missing.length}/${all.size} lines recorded${missing.length ? ', missing:' : ''}`);
  for (const l of missing) console.log(`  ${l.text}`);
  const out = flagVal('csv');
  if (out && missing.length) {
    writeFileSync(out, 'text,file\n' + missing.map((l) => `${csvCell(l.text)},${clipKey(l.text)}.wav`).join('\n') + '\n');
    console.log(`Recording sheet: ${out} (record each line into the named file next to it, then: npm run voices -- import ${voice} ${out})`);
  }
} else if (cmd === 'apply') {
  const [voice, ...files] = args;
  const v = await getVoice(voice);
  for (const {f, spec} of specs(files)) {
    const {have, missing} = coverage(v, voiceLines(spec.template, spec.props));
    if (missing.length && !has('partial')) {
      console.warn(`✗ ${basename(f)}: ${voice} is missing ${missing.length} line(s): ${missing.map((l) => `"${l.text}"`).join(', ')} (record them, or --partial to keep the old clips for those)`);
      continue;
    }
    const voiceProp: any = {...(has('partial') ? spec.props.voice ?? {} : {})};
    for (const l of have) {
      const clip = {src: l.clip.url!, duration: l.clip.duration, text: l.text};
      if (l.slot === 'answers') (voiceProp.answers ??= [])[l.index!] = clip;
      else voiceProp[l.slot] = clip;
    }
    spec.props.voice = voiceProp;
    spec.voiceSettings = {library: voice};
    writeFileSync(f, JSON.stringify(spec, null, 2) + '\n');
    console.log(`✓ ${basename(f)}: ${have.length} line(s) from ${voice}${missing.length ? `, ${missing.length} kept from before` : ''}`);
  }
} else if (cmd === 'ls') {
  const [voice] = args;
  const v = await getVoice(voice);
  const q = flagVal('search')?.toLowerCase();
  const clips = Object.values(v.clips).filter((c) => !q || c.text.toLowerCase().includes(q)).sort((a, b) => a.text.localeCompare(b.text));
  for (const c of clips) console.log(`${c.duration.toFixed(2).padStart(6)}s  ${c.source.padEnd(9)} ${c.text}`);
  console.log(`${clips.length} line(s)`);
} else if (cmd === 'rm') {
  const [voice, what] = args;
  const key = /^[0-9a-f]{14}$/.test(what) ? what : clipKey(what);
  const r = await api<{removed: number}>(`/voices/${voice}/clips/${key}`, {method: 'DELETE'});
  console.log(r.removed ? `✓ removed "${what}" from ${voice} (the audio file stays in R2)` : `· "${what}" isn't in ${voice}`);
} else if (cmd === 'hide') {
  const [voice] = args;
  await api(`/voices/${voice}`, {method: 'DELETE'});
  console.log(`✓ hid voice "${voice}" (clips kept; npm run voices -- create ${voice} … brings it back)`);
} else {
  throw new Error(`Unknown command "${cmd}" (list, create, add, import, from-spec, missing, apply, ls, rm, hide)`);
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') out.push(cur), (cur = '');
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
function csvCell(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
