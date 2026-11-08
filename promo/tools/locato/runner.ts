#!/usr/bin/env bun
// The render runner: picks up videos queued in the Studio (admin → Promo → Create) and renders them on this Mac.
//   npm run render-runner            keep going: check every 15 s, render one job at a time (keeps the Mac awake)
//   npm run render-runner -- --once  render whatever's queued, then stop
// For each job: write its recipe → `new.ts <format> --recipe … --seed … --name …` (voice lines from the library first) →
// `render.mjs videos/<name>.json` → `queue.ts stage videos/<name>.json [--hold]` → report back to the job.
import {mkdirSync, writeFileSync} from 'node:fs';
import {hostname} from 'node:os';
import {join} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {ROOT, api} from './env';

type Job = {id: string; name: string; recipe: {format: string}; seed: string; hold: boolean};
const once = process.argv.includes('--once');
const runner = `mac:${hostname().replace(/\.local$/, '')}`;
if (!once && !process.env.CAFFEINATED && process.platform === 'darwin') {
  // re-run under caffeinate so the Mac doesn't sleep mid-render
  const r = spawnSync('caffeinate', ['-i', process.execPath, ...process.argv.slice(1)], {stdio: 'inherit', env: {...process.env, CAFFEINATED: '1'}});
  process.exit(r.status ?? 0);
}

function run(cmd: string, args: string[], onLine: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {cwd: ROOT, env: {...process.env, PROMO_VOICE_LIBRARY: process.env.PROMO_VOICE_LIBRARY ?? '1'}});
    const feed = (b: Buffer) => b.toString().split(/\r|\n/).filter((l) => l.trim()).forEach(onLine);
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0] ?? ''} exited with ${code}`))));
  });
}

async function work(job: Job) {
  const log: string[] = [];
  let last = 0;
  const push = async (force = false) => {
    if (!force && Date.now() - last < 5000) return;
    last = Date.now();
    await api(`/jobs/${job.id}/progress`, {method: 'POST', json: {log: log.slice(-200).join('\n').slice(-20000)}}).catch(() => undefined);
  };
  const line = (l: string) => {
    log.push(l);
    console.log(`  ${l}`);
    void push();
  };
  const step = async (title: string, cmd: string, args: string[]) => {
    line(`── ${title}`);
    await run(cmd, args, line);
  };
  try {
    const dir = join(ROOT, '.cache/jobs');
    mkdirSync(dir, {recursive: true});
    const recipeFile = join(dir, `${job.id}.json`);
    writeFileSync(recipeFile, JSON.stringify(job.recipe, null, 2));
    const spec = `videos/${job.name}.json`;
    await step('Build the video spec', 'bun', ['tools/locato/new.ts', job.recipe.format, '--recipe', recipeFile, '--seed', job.seed, '--name', job.name, '--no-fresh']); // --no-fresh: the same picks the Studio previewed
    await step('Render', 'node', ['tools/render.mjs', spec]);
    await step('Upload and queue for posting', 'bun', ['tools/locato/queue.ts', 'stage', spec, ...(job.hold ? ['--hold'] : [])]);
    const entry = await api<{video: string; dueAt: string; status: string}>(`/queue/${job.name}`);
    await push(true);
    await api(`/jobs/${job.id}/finish`, {method: 'POST', json: {ok: true, result: {video: entry.video, dueAt: entry.dueAt, status: entry.status}, log: log.slice(-200).join('\n').slice(-20000)}});
    console.log(`✓ ${job.name} rendered and queued${job.hold ? ' (on hold)' : ''}`);
  } catch (e) {
    const error = (e as Error).message;
    console.error(`✗ ${job.name}: ${error}`);
    await api(`/jobs/${job.id}/finish`, {method: 'POST', json: {ok: false, error: error.slice(0, 4000), log: log.slice(-200).join('\n').slice(-20000)}}).catch(() => undefined);
  }
}

console.log(`Render runner ${runner}: ${once ? 'rendering what is queued' : 'waiting for jobs from the Studio (Ctrl-C to stop)'}`);
let quietSince = 0;
for (;;) {
  let job: Job | null = null;
  try {
    job = (await api<{job: Job | null}>('/jobs/claim', {method: 'POST', json: {runner}})).job;
  } catch (e) {
    console.error(`  can't reach the promo service: ${(e as Error).message}`);
  }
  if (job) {
    console.log(`▶ ${job.name} (${job.recipe.format}, seed ${job.seed})`);
    await work(job);
    quietSince = 0;
    continue;
  }
  if (once) break;
  if (!quietSince) (quietSince = Date.now()), console.log('  nothing queued; checking every 15 s');
  await new Promise((r) => setTimeout(r, 15_000));
}
