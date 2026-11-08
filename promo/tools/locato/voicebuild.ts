#!/usr/bin/env bun
// Record every line the templates can say, in one voice, and upload them to the voice library. Runs on the Mac as fast
// as it can: one Chatterbox worker per device (e.g. the GPU via MPS and the CPU at the same time), each keeping its model
// loaded; every take is checked by local Whisper (words in order; names judged by sound, see src/content/speech.ts) and
// uploaded as soon as it passes. Re-running continues where it left off (the library is the record of what's done).
//
//   npm run voices:build -- george [--limit 20] [--only hooks,outros,ctas,answers,pins,split,lookalikes] [--devices mps]
//                                  [--list]  (print the lines, record nothing)
//                                  [--redo Eritrea]  (re-record lines containing this text, replacing the library's takes)
// Report of lines that never passed: out/voice-build/<voice>/report.json (their best takes are kept next to it).
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {resolveLine, spokenHook, spokenText, type PhraseCtx} from '../../src/content/phrases';
import {judgeLine, isRespelled, speakable, type Pronunciations} from '../../src/content/speech';
import {clipKey, type ClipInfo, type VoiceInfo} from '../../src/content/voice';
import {ROOT, api, loadContent, loadGame} from './env';

for (const ev of ['uncaughtException', 'unhandledRejection'] as const) process.on(ev, (e: any) => (console.error(`✗ ${e?.message ?? e}`), process.exit(1)));

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const voiceId = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!voiceId) throw new Error('Usage: npm run voices:build -- <voice> [--limit 20] [--only …] [--devices mps] [--list]');
const MAX_TRIES = 4;
const dict: Pronunciations = JSON.parse(readFileSync(join(ROOT, 'content/pronunciations.json'), 'utf8'));

// ---- every line the templates can say ---------------------------------------------------------------------------
type Line = {text: string; kind: string; names: string[]};
function allLines(): Line[] {
  const game = loadGame();
  const content = loadContent({quiet: true});
  const P = content.phrases;
  const seen = new Map<string, Line>();
  const add = (text: string, kind: string, names: string[] = []) => {
    const k = clipKey(text);
    if (!seen.has(k)) seen.set(k, {text, kind, names});
  };
  const warn = () => undefined;
  const line = (slot: Parameters<typeof resolveLine>[1], ref: string | undefined, ctx: PhraseCtx, vars: Record<string, string | number>) => resolveLine(P, slot, ref, ctx, vars, warn);
  const quiz = (rules: 'score' | 'one-life'): PhraseCtx => ({format: 'quiz', rules});
  const ROUNDS = [3, 4, 5, 6, 7, 8, 9, 10];

  // hooks (what a video opens with), as compile() speaks them
  for (const p of P.filter((p) => p.slot === 'hook' && p.text && !p.needs?.length)) {
    const fmts = p.suits?.format ?? ['quiz'];
    if (fmts.includes('quiz')) for (const n of p.text.includes('{n}') || p.say?.includes('{n}') ? ROUNDS : [5]) {
      const l = line('hook', p.id, quiz(p.suits?.rules?.[0] ?? 'score'), {n});
      add(l.say ?? spokenHook(l.text), 'hooks');
    }
    if (fmts.includes('daily')) for (const t of game.themes) {
      const l = line('hook', p.id, {format: 'daily'}, {theme: t.title, n: 5});
      add(l.say ?? spokenHook(l.text), 'hooks');
    }
    if (fmts.includes('lookalikes')) {
      const l = line('hook', p.id, {format: 'lookalikes', skill: p.suits?.skill?.[0] ?? 'flag'}, {n: 3});
      add(l.say ?? spokenHook(l.text), 'hooks');
    }
  }
  // closing question + note, and the call to action, per kind of video
  const ctxs: [PhraseCtx, number[]][] = [[quiz('score'), ROUNDS], [quiz('one-life'), [5]], [{format: 'daily'}, [5]], [{format: 'lookalikes'}, [3]]];
  for (const [ctx, ns] of ctxs)
    for (const n of ns) {
      const vars = {n, theme: game.themes[0].title};
      const q = line('question', undefined, ctx, vars), note = line('note', undefined, ctx, vars), cta = line('cta', undefined, ctx, vars);
      add(`${q.say ?? q.text} ${note.say ?? spokenText(note.text)}`, 'outros');
      add(cta.say ?? cta.text, 'ctas');
    }
  // reveals: "That's Kenya!" / "That's Nairobi!", MapTap "It's in Kenya!", Worldsplit sides
  for (const c of game.countries) add(line('answer', 'answer.thats', quiz('score'), {answer: c.name, country: c.name}).text, 'answers', [c.name]);
  for (const c of game.countries) add(line('answer', 'answer.thats', quiz('score'), {answer: c.capital, country: c.name}).text, 'answers', [c.capital]);
  for (const c of game.countries) add(line('answer', 'answer.pin', quiz('score'), {country: c.name}).text, 'pins', [c.name]);
  for (const side of ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'])
    for (let pct = 50; pct <= 80; pct++) add(line('answer', 'answer.split', quiz('score'), {side, pct}).text, 'split');
  // look-alike reveals ("Chad. Romania."), every order, for sets of up to 3
  const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  for (const s of game.lookalikes.filter((s) => s.codes.length <= 3 && s.codes.every((c) => game.byCode.has(c))))
    for (const p of perms(s.codes.map((c) => game.byCode.get(c)!.name))) {
      const t = p.join('. ') + '.';
      add(t, 'lookalikes', [t]);
    }
  return [...seen.values()];
}

// ---- audio helpers ----------------------------------------------------------------------------------------------------
function readWav(file: string) {
  const b = readFileSync(file);
  let off = 12, fmt: any, data: Buffer | undefined;
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = {ch: b.readUInt16LE(off + 10), sr: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22)};
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  const n = data!.length / (fmt.bits / 8) / fmt.ch, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = fmt.bits === 32 ? data!.readFloatLE(i * 4 * fmt.ch) : data!.readInt16LE(i * 2 * fmt.ch) / 32768;
  return {x, sr: fmt.sr as number};
}
/** Trim silence (keep 40 ms either side), peak-normalise, 16-bit mono. Returns the length in seconds. */
function cleanWav(src: string, dest: string) {
  let {x, sr} = readWav(src);
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
  writeFileSync(dest, pcm);
  return x.length / sr;
}

// ---- long-running workers (JSON lines in, JSON lines out) ---------------------------------------------------------
class Worker {
  private waiting = new Map<string, (v: any) => void>();
  private ready: Promise<void>;
  constructor(public name: string, private proc: ChildProcessWithoutNullStreams) {
    let markReady!: () => void;
    this.ready = new Promise((r) => (markReady = r));
    createInterface({input: proc.stdout}).on('line', (l) => {
      let m: any;
      try { m = JSON.parse(l); } catch { return; }
      if (m.ready) return markReady();
      this.waiting.get(m.id)?.(m);
      this.waiting.delete(m.id);
    });
    proc.on('exit', (code) => { if (code) console.error(`✗ worker ${name} stopped (exit ${code})`); });
  }
  start() { return this.ready; }
  ask(msg: {id: string} & Record<string, unknown>) {
    return new Promise<any>((r) => { this.waiting.set(msg.id, r); this.proc.stdin.write(JSON.stringify(msg) + '\n'); });
  }
  stop() { this.proc.stdin.end(); }
}

// ---- main ---------------------------------------------------------------------------------------------------------------
const lines = allLines();
const only = opt('only')?.split(',');
const voice = await api<{voice: VoiceInfo; clips: Record<string, ClipInfo>}>(`/voices/${voiceId}`);
const have = new Set(Object.keys(voice.clips));
const redo = opt('redo');
let todo = lines.filter((l) => (!only || only.includes(l.kind)) && (!have.has(clipKey(l.text)) || (redo && l.text.includes(redo))));
// small, high-value lines first (every video uses them), then the reveals
const ORDER = ['hooks', 'outros', 'ctas', 'answers', 'pins', 'split', 'lookalikes'];
todo.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
if (opt('limit')) todo = todo.slice(0, Number(opt('limit')));
const counts = Object.fromEntries(ORDER.map((k) => [k, lines.filter((l) => l.kind === k).length]));
console.log(`${voiceId}: ${lines.length} lines in all (${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}); ${have.size} already in the library; ${todo.length} to record now`);
if (argv.includes('--list')) {
  for (const l of todo) console.log(`  ${l.kind.padEnd(10)} ${l.text}${isRespelled(l.text, dict) ? `   → ${speakable(l.text, dict)}` : ''}`);
  process.exit(0);
}
if (!todo.length) process.exit(0);

const s = (voice.voice.settings ?? {}) as {voice?: string; exaggeration?: number; cfg?: number};
const ref = s.voice && s.voice !== 'default' ? join(ROOT, 'tools/voice/refs', `${s.voice}.wav`) : null;
if (ref && !existsSync(ref)) throw new Error(`No reference clip ${ref} (make one by voicing any video with --voice ${s.voice})`);
const PY = join(ROOT, 'tools/voice/.venv/bin/python');
// one MPS worker by default: two Chatterbox models + Whisper don't fit in 16 GB alongside other apps
const devices = (opt('devices') ?? 'mps').split(',');
const workers = devices.map((device) => new Worker(device, spawn(PY, [join(ROOT, 'tools/voice/chatterbox_worker.py'), JSON.stringify({device, exaggeration: s.exaggeration ?? 1.3, cfg: s.cfg ?? 0.3, ref, threads: device === 'cpu' ? 6 : undefined})], {cwd: ROOT, env: {...process.env, PYTORCH_ENABLE_MPS_FALLBACK: '1'}})));
const whisper = new Worker('whisper', spawn('node', [join(ROOT, 'tools/voice/whisper_worker.mjs')], {cwd: ROOT}));
process.stdout.write(`Loading ${devices.join(' + ')} and Whisper… `);
await Promise.all([...workers, whisper].map((w) => w.start()));
console.log('ready');

const DIR = join(ROOT, 'out/voice-build', voiceId);
mkdirSync(join(DIR, 'tmp'), {recursive: true});
mkdirSync(join(DIR, 'failed'), {recursive: true});
const reportFile = join(DIR, 'report.json');
const report: {failed: Record<string, {text: string; said: string; heard: string; why: string; tries: number; file: string}>} = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : {failed: {}};
for (const k of Object.keys(report.failed)) if (have.has(k)) delete report.failed[k]; // since recorded
const saveReport = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');

type Task = {line: Line; tries: number; best: {score: number; file: string; heard: string; why: string; said: string} | null};
const queue: Task[] = todo.map((line) => ({line, tries: 0, best: null}));
let done = 0, passed = 0, failed = 0;
const genSecs: number[] = [];
const t0 = Date.now();
const total = queue.length;
const fmtTime = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : `${Math.round(s / 60)}m`);

// Two overlapping stages, so the GPU never waits: a worker records takes back to back, while each finished take is
// cleaned, heard by Whisper, judged and uploaded alongside (up to IN_FLIGHT at a time).
const IN_FLIGHT = 3;
type Take = {task: Task; said: string; raw: string; clean: string; ok: boolean; error?: string; worker: string; secs?: number};

async function record(w: Worker, task: Task): Promise<Take> {
  const respelled = isRespelled(task.line.text, dict);
  // tries 1–2: the dictionary's spelling; 3–4: plain, in case the respelling is what's going wrong
  const said = speakable(task.line.text, dict, {respell: !(respelled && task.tries >= 2)});
  const key = clipKey(task.line.text);
  const raw = join(DIR, 'tmp', `${key}.${task.tries}.${w.name}.raw.wav`);
  // a fresh random seed per take: fixed seeds would replay the same bad take whenever a line is re-run
  const gen = await w.ask({id: `${key}.${task.tries}`, text: said, out: raw, seed: Math.floor(Math.random() * 2 ** 31)});
  task.tries++;
  if (gen.ok) genSecs.push(gen.secs);
  return {task, said, raw, clean: raw.replace('.raw.wav', '.wav'), ok: !!gen.ok, error: gen.error, worker: w.name, secs: gen.secs};
}

function progress() {
  if (done % 25 === 0 || done === total) {
    const per = (Date.now() - t0) / 1000 / done;
    console.log(`  … ${done}/${total} done (${passed} uploaded, ${failed} for review) · ${per.toFixed(1)}s per line · about ${fmtTime(per * (total - done))} left`);
  }
}

async function finish(t: Take) {
  const {task} = t;
  const key = clipKey(task.line.text);
  let r: {ok: boolean; why: string; file: string; heard: string; dur?: number};
  if (!t.ok) r = {ok: false, why: `generation: ${t.error}`, file: '', heard: ''};
  else {
    const dur = cleanWav(t.raw, t.clean);
    rmSync(t.raw, {force: true});
    // a generation that ran away (rambling, long silences); hype stretches short lines, so allow a little more for them
    if (dur > 2 + t.said.length * 0.12) r = {ok: false, why: `runaway (${dur.toFixed(1)}s)`, file: t.clean, heard: '', dur};
    else {
      const heard = (await whisper.ask({id: `${key}.${task.tries}`, file: t.clean})).text ?? '';
      r = {...judgeLine(task.line.text, heard, dict, task.line.names), file: t.clean, heard, dur};
    }
  }
  if (r.ok) {
    await api(`/voices/${voiceId}/clips?${new URLSearchParams({text: task.line.text, duration: r.dur!.toFixed(3), source: 'generated', ...(have.has(key) ? {replace: '1'} : {})})}`, {method: 'PUT', body: Bun.file(r.file), headers: {'content-type': 'audio/wav'}});
    rmSync(r.file, {force: true});
    if (task.best) rmSync(task.best.file, {force: true});
    delete report.failed[key];
    passed++;
    done++;
    console.log(`[${done}/${total}] ✓ ${task.line.text}${task.tries > 1 ? ` (try ${task.tries})` : ''} · ${t.worker} ${t.secs?.toFixed(1)}s`);
    return progress();
  }
  if (r.file) {
    if (task.best) rmSync(task.best.file, {force: true});
    task.best = {score: 0, file: r.file, heard: r.heard, why: r.why, said: t.said};
  }
  if (task.tries < MAX_TRIES) {
    queue.splice(Math.min(queue.length, 1), 0, task); // retry soon, on whichever worker is free
    return;
  }
  const keep = join(DIR, 'failed', `${key}.wav`);
  if (task.best) writeFileSync(keep, readFileSync(task.best.file)), rmSync(task.best.file, {force: true});
  report.failed[key] = {text: task.line.text, said: task.best?.said ?? t.said, heard: task.best?.heard ?? r.heard, why: task.best?.why ?? r.why, tries: task.tries, file: keep};
  saveReport();
  failed++;
  done++;
  console.log(`[${done}/${total}] ✗ ${task.line.text}: ${r.why}${r.heard ? ` (heard "${r.heard}")` : ''}`);
  progress();
}

const inflight = new Set<Promise<void>>();
async function run(w: Worker) {
  for (;;) {
    const task = queue.shift();
    if (!task) {
      if (!inflight.size) return;
      await Promise.race(inflight); // a retry may still come back
      continue;
    }
    const take = await record(w, task);
    const p: Promise<void> = finish(take).catch((e) => console.log(`[!] ${task.line.text}: ${(e as Error).message}`)).finally(() => inflight.delete(p));
    inflight.add(p);
    if (inflight.size >= IN_FLIGHT) await Promise.race(inflight);
  }
}

await Promise.all(workers.map(run));
workers.forEach((w) => w.stop());
whisper.stop();
saveReport();
console.log(`takes: ${genSecs.length}, generation ${(genSecs.reduce((a, b) => a + b, 0) / Math.max(1, genSecs.length)).toFixed(1)}s each on average; wall ${(((Date.now() - t0) / 1000) / Math.max(1, genSecs.length)).toFixed(1)}s per take`);
console.log(`DONE ${voiceId}: ${passed} uploaded, ${failed} need review (${reportFile}) in ${fmtTime((Date.now() - t0) / 1000)}`);
process.exit(0);
