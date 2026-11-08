#!/usr/bin/env node
// Add a spoken voiceover to Locato video specs, locally and for free.
//   node tools/voice/voice.mjs videos/a.json [b.json ...] [--intensity calm|lively|hype] [--voice default|am_michael|…]
//                              [--engine chatterbox|kokoro] [--speed 1.08] [--check] [--lines: show what's said, generate nothing]
// Engines: chatterbox (default; expressive, MIT, runs on the Mac GPU) or kokoro (fast, calmer, Apache-2.0).
// --voice: chatterbox "default", or any Kokoro voice name (af_heart, am_michael, bm_george, …), whose timbre
//          chatterbox clones from a short Kokoro sample. --intensity sets chatterbox's exaggeration.
// Chatterbox lines are checked with local Whisper and regenerated if a word comes out wrong.
// Writes clips to public/locato/voice/<spec>/ and the timings into the spec's props.voice.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const PY = join(ROOT, 'tools/voice/.venv/bin/python');
const args = process.argv.slice(2);
const flag = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const files = args.filter((a, i) => a.endsWith('.json') && !args[i - 1]?.startsWith('--'));
if (!files.length) {
  console.error('Usage: node tools/voice/voice.mjs videos/<spec>.json ... [--intensity lively] [--voice default] [--engine chatterbox|kokoro] [--check]');
  process.exit(2);
}

const INTENSITY = {calm: {exaggeration: 0.5, cfg: 0.5}, lively: {exaggeration: 0.9, cfg: 0.35}, hype: {exaggeration: 1.3, cfg: 0.3}};
const engine = flag('engine', existsSync(PY) ? 'chatterbox' : 'kokoro');
const intensity = flag('intensity', 'lively');
if (!INTENSITY[intensity]) throw new Error(`--intensity must be one of ${Object.keys(INTENSITY).join(', ')}`);
const voiceName = flag('voice', engine === 'kokoro' ? 'af_heart' : 'default');
const speed = Number(flag('speed', '1.08'));

// Names the models tend to get wrong, respelled the way they're said.
const SAY = {
  "Cote d'Ivoire": 'Coat dee-vwahr',
  "Côte d'Ivoire": 'Coat dee-vwahr',
  Niger: 'Nee-zhair',
  Qatar: 'Kuh-tar',
  Lesotho: 'Leh-soo-too',
  Djibouti: 'Jih-boo-tee',
  Eswatini: 'Eh-swah-tee-nee',
  Ljubljana: 'Lyoob-lyah-nah',
  'locato.quest': 'locato dot quest',
};
const speakable = (s) => Object.entries(SAY).reduce((t, [a, b]) => t.replaceAll(a, b), s).replace(/\bvs\.?(?=\s)/g, 'versus').replace(/(\d+)\s*\/\s*(\d+)/g, '$1 out of $2').replace(/#(\d+)/g, 'number $1').replace(/(\d+):(\d\d)\.(\d)/g, '$1 minutes $2 point $3 seconds');

const hookFrom = (title) => {
  const t = title.trim();
  if (/[?.!]$/.test(t)) return t;
  if (/^name these/i.test(t)) return `Can you n${t.slice(1)}?`;
  return `${t}.`;
};
const CTA = 'Play it free at locato.quest!';
/** Answers sound like a host and give the model context ("That's Uruguay!"); bare one-word lines come out garbled more often. */
const reveal = (r) => r.say ?? `That's ${r.answer}!`;

/** What gets said, per template. Override any line with props.voiceText. */
function linesFor(template, p) {
  const o = p.voiceText ?? {};
  const spokenNote = {quiz: p.mode === 'one-life' ? 'Comment your round!' : 'Comment your score!', daily: 'Comment your score!', lookalikes: 'Comment your score!', speedrun: 'Comment your best time!', clip: 'Comment your best time!', versus: "Tag who you'd race!", leaderboard: p.metric === 'time' ? 'Comment your best time!' : 'Comment your best score!'}[template];
  const note = p.outro?.note ? p.outro.note.replace(/[^\p{L}\p{N}\s'’!?.,]/gu, '').trim() : spokenNote;
  const outro = p.outro?.question ? `${p.outro.question} ${note}` : undefined;
  const base = {hook: o.hook ?? (p.title?.trim() ? hookFrom(p.title) : undefined), outro: o.outro ?? outro, cta: o.cta ?? CTA};
  switch (template) {
    case 'quiz': {
      const n = p.rounds.length;
      const cta = p.mode === 'one-life' ? 'Made it to the end? Prove it at locato.quest!' : `Got ${n} out of ${n}? Prove it at locato.quest!`;
      return {...base, answers: p.rounds.map(reveal), cta: o.cta ?? cta};
    }
    case 'daily':
      return {...base, hook: o.hook ?? `Warm up for today's Daily: ${p.badge}!`, answers: p.rounds.map(reveal), cta: o.cta ?? "Play today's Daily for free at locato.quest!"};
    case 'lookalikes':
      return {...base, answers: p.sets.map((s) => s.items.map((i) => i.name).join('. ') + '.')};
    case 'speedrun':
    case 'clip':
      return {...base, cta: o.cta ?? 'Think you can beat it? Play it free at locato.quest!'};
    case 'versus':
      return {...base, result: o.result ?? (p.winner ? `${p[p.winner].name} wins!` : undefined)};
    case 'leaderboard': {
      const m = /^Top (\d+): (.+)$/.exec(p.title.trim());
      if (m && !o.hook) base.hook = `The top ${m[1]} on the ${m[2]} leaderboard.`;
      return {...base, result: o.result ?? (p.entries[0] ? `${p.entries[0].name} takes first place!` : undefined)};
    }
    default:
      throw new Error(`Unknown template ${template}`);
  }
}

// ---- wav helpers ------------------------------------------------------------------------
const readWav = (file) => {
  const b = readFileSync(file);
  let off = 12, fmt, data;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = {ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22)};
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  const n = data.length / (fmt.bits / 8) / fmt.ch;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = fmt.bits === 32 ? data.readFloatLE(i * 4 * fmt.ch) : data.readInt16LE(i * 2 * fmt.ch) / 32768;
  return {x, sr: fmt.sr};
};
/** Trim silence (keep 40ms either side), peak-normalise, write 16-bit mono WAV. */
const writeClean = (file, x, sr) => {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const th = peak * 0.02;
  let a = 0, b = x.length - 1;
  while (a < b && Math.abs(x[a]) < th) a++;
  while (b > a && Math.abs(x[b]) < th) b--;
  x = x.subarray(Math.max(0, a - Math.round(0.04 * sr)), Math.min(x.length, b + Math.round(0.04 * sr)));
  const g = 0.89 / (peak || 1);
  const pcm = Buffer.alloc(44 + x.length * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + x.length * 2, 4); pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(sr, 24);
  pcm.writeUInt32LE(sr * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * g * 32767))), 44 + i * 2);
  writeFileSync(file, pcm);
};
const durationOf = (file) => {
  const b = readFileSync(file);
  return (b.length - 44) / 2 / b.readUInt32LE(24);
};

// ---- engines --------------------------------------------------------------------------------
let kokoro;
const loadKokoro = async () => {
  if (!kokoro) {
    const {KokoroTTS} = await import('kokoro-js');
    kokoro = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {dtype: 'q8', device: 'cpu'});
  }
  return kokoro;
};

/** Chatterbox clones a timbre from a reference clip; make one from a Kokoro voice if asked. */
async function referenceFor(name) {
  if (name === 'default') return null;
  if (existsSync(name)) return resolve(name);
  const file = join(ROOT, 'tools/voice/refs', `${name}.wav`);
  if (!existsSync(file)) {
    const tts = await loadKokoro();
    if (!tts.voices[name]) throw new Error(`Unknown voice "${name}". Use default, a .wav path, or one of: ${Object.keys(tts.voices).join(' ')}`);
    mkdirSync(join(ROOT, 'tools/voice/refs'), {recursive: true});
    const a = await tts.generate(
      "Welcome back! Today we're travelling the world, one flag at a time. Some of these are easy, and some of them are really tricky. Ready? Let's see how many you can get.",
      {voice: name, speed: 1.05},
    );
    writeClean(file, a.audio, a.sampling_rate);
  }
  return file;
}

function chatterbox(jobs, ref) {
  if (!jobs.length) return;
  const spec = join(ROOT, `tools/voice/.jobs-${process.pid}.json`);
  writeFileSync(spec, JSON.stringify({...INTENSITY[intensity], ref, jobs}));
  process.stdout.write(`  chatterbox: ${jobs.length} line(s)…`);
  const r = spawnSync(PY, [join(ROOT, 'tools/voice/chatterbox_batch.py'), spec], {encoding: 'utf8', maxBuffer: 64 << 20});
  rmSync(spec, {force: true});
  if (r.status !== 0) throw new Error(`chatterbox failed:\n${(r.stderr ?? '').split('\n').slice(-15).join('\n')}`);
  process.stdout.write(' done\n');
}

// ---- checking with local Whisper ---------------------------------------------------------------
let asr;
const NUM = {0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 12: 'twelve'};
const words = (s) => s.toLowerCase().replace(/\bvs\.?(?=\s)/g, 'versus').replace(/\d+/g, (d) => NUM[d] ?? d).replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const lev = (a, b) => {
  const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
/** Share of written words heard (fuzzy), 0–1. Compares the joined letters too, so "Kyrgyz stan" still counts. */
const match = (wrote, heard) => {
  const w = words(wrote), h = words(heard);
  if (!w.length) return 1;
  const hit = w.filter((x) => h.some((y) => lev(x, y) <= Math.max(1, Math.floor(x.length / 4)))).length / w.length;
  const joined = 1 - lev(w.join(''), h.join('')) / Math.max(w.join('').length, 1);
  return hit >= 0.8 ? hit : joined >= 0.9 ? joined : Math.min(hit, joined); // joined only rescues split words ("Kyrgyz stan")
};
async function transcribe(file) {
  if (!asr) {
    const {pipeline} = await import('@huggingface/transformers');
    asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', {dtype: 'q8'});
  }
  const {x, sr} = readWav(file);
  const r = sr / 16000, m = Math.floor(x.length / r), y = new Float32Array(m);
  for (let i = 0; i < m; i++) y[i] = x[Math.floor(i * r)];
  return (await asr(y)).text.trim();
}

// ---- main ----------------------------------------------------------------------------------------
const settings = engine === 'kokoro' ? {engine: 'kokoro-82m', voice: voiceName, speed} : {engine: 'chatterbox', voice: voiceName, intensity, ...INTENSITY[intensity]};
console.log(`Voice: ${engine} · ${voiceName}${engine === 'kokoro' ? ` · speed ${speed}` : ` · ${intensity}`}`);
const tag = JSON.stringify(settings);
const ref = engine === 'chatterbox' ? await referenceFor(voiceName) : null;

// 1. work out every line and its clip file
const plans = files.map((f) => {
  const spec = JSON.parse(readFileSync(f, 'utf8'));
  const name = basename(f, '.json');
  const dir = join(ROOT, 'public/locato/voice', name);
  mkdirSync(dir, {recursive: true});
  const lines = linesFor(spec.template, spec.props);
  const clip = (text) => ({text, said: speakable(text), file: join(dir, `${createHash('sha1').update(`${tag}|${speakable(text)}`).digest('hex').slice(0, 10)}.wav`)});
  const voice = Object.fromEntries(Object.entries(lines).filter(([, v]) => v).map(([k, v]) => [k, Array.isArray(v) ? v.map(clip) : clip(v)]));
  return {f, spec, dir, voice};
});
if (args.includes('--lines')) {
  // dry run: what would be said, nothing generated
  for (const p of plans) {
    console.log(p.f);
    for (const [k, v] of Object.entries(p.voice)) for (const c of [v].flat()) console.log(`  ${k.padEnd(8)} ${c.text}${c.said !== c.text ? `   (said: ${c.said})` : ''}`);
    if (!readdirSync(p.dir).length) rmSync(p.dir, {recursive: true});
  }
  process.exit(0);
}
const all = plans.flatMap((p) => Object.values(p.voice).flat());
const todo = [...new Map(all.filter((c) => !existsSync(c.file)).map((c) => [c.file, c])).values()];

// 2. generate what's missing
if (engine === 'kokoro') {
  const tts = await loadKokoro();
  if (!tts.voices[voiceName]) throw new Error(`Unknown voice "${voiceName}". Available: ${Object.keys(tts.voices).join(' ')}`);
  for (const c of todo) {
    const a = await tts.generate(c.said, {voice: voiceName, speed});
    writeClean(c.file, a.audio, a.sampling_rate);
  }
} else {
  // Chatterbox can garble a word now and then: check every new clip, retry with a new seed (up to 3 tries).
  let pending = todo.map((c) => ({...c, best: null, tries: 0}));
  while (pending.length) {
    const tries = pending[0].tries;
    const raw = (c) => c.file.replace(/\.wav$/, `.try${c.tries}.wav`);
    chatterbox(pending.map((c) => ({text: c.said, out: raw(c), seed: 7 + c.tries * 101})), ref);
    const retry = [];
    for (const c of pending) {
      const {x, sr} = readWav(raw(c));
      const tmp = raw(c).replace('.wav', '.clean.wav');
      writeClean(tmp, x, sr);
      rmSync(raw(c));
      const heard = await transcribe(tmp);
      const score = Math.max(match(c.text, heard), match(c.said, heard));
      const dur = durationOf(tmp);
      const tooLong = dur > 1.2 + c.said.length * 0.11; // runaway generations
      const ok = score >= 0.8 && !tooLong;
      if (!c.best || (score > c.best.score && !tooLong)) {
        if (c.best) rmSync(c.best.file, {force: true});
        c.best = {file: tmp, score, heard};
      } else rmSync(tmp, {force: true});
      if (ok || c.tries >= 2) {
        writeFileSync(c.file, readFileSync(c.best.file));
        rmSync(c.best.file, {force: true});
        if (!ok) console.warn(`  ⚠ "${c.text}" still unclear after 3 tries (heard "${c.best.heard}"); kept the closest`);
      } else retry.push({...c, tries: c.tries + 1});
    }
    if (retry.length) console.log(`  re-trying ${retry.length} unclear line(s) (attempt ${tries + 2})`);
    pending = retry;
  }
}

// 3. write specs
for (const p of plans) {
  const out = {};
  for (const [k, v] of Object.entries(p.voice)) {
    const entry = (c) => ({src: c.file.replace(join(ROOT, 'public') + '/', ''), duration: +durationOf(c.file).toFixed(3), text: c.text});
    out[k] = Array.isArray(v) ? v.map(entry) : entry(v);
  }
  const used = new Set(Object.values(out).flat().map((c) => basename(c.src)));
  for (const old of readdirSync(p.dir)) if (!used.has(old)) rmSync(join(p.dir, old));
  p.spec.props.voice = out;
  p.spec.voiceSettings = settings;
  writeFileSync(p.f, JSON.stringify(p.spec, null, 2) + '\n');
  const list = Object.values(out).flat();
  console.log(`✓ ${p.f}: ${list.length} lines, ${list.reduce((s, c) => s + c.duration, 0).toFixed(1)}s of speech`);
  for (const c of list) console.log(`    ${c.duration.toFixed(2)}s  ${c.text}`);
  if (args.includes('--check')) for (const c of list) console.log(`    heard: ${(await transcribe(join(ROOT, 'public', c.src))).padEnd(48)} (wrote: ${c.text})`);
}
