#!/usr/bin/env bun
// Posting, through the promo service (promo.locato.quest). You stage a finished batch once; the service's timer keeps
// Buffer topped up from it and records what was posted. Nothing here touches Buffer or R2 directly.
//
//   npm run stage -- videos/2026-11-09-*.json        upload + add to the queue (needs out/<name>.mp4)
//       --times 13:00,19:00  --tz Africa/Johannesburg  --start <now|HH:MM|YYYY-MM-DDTHH:MM> --every 60  --hold  --dry-run
//   npm run publish -- videos/<name>.json [--start now] [--every 15]   stage, then run the posting step right away
//   npm run queue                                    what's queued, in Buffer, or has a problem
//   npm run queue -- --done [--last 20]              posted videos, with their live links
//   npm run queue -- --hold <name>  /  --release <name>
//   npm run queue -- --remove <name>                 take it out (its unsent Buffer posts are deleted; the record stays)
//   npm run queue -- --run                           run the posting step now (the timer does it every 4 hours)
//   npm run queue -- --last-run                      the posting step's last log
//
// When: <date>-am-… goes out at the first time, <date>-pm-… at the second; other names take the next free slot.
import {existsSync, readFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {SERVICES, localDate, localToUtc, slotsAfter, type Entry} from './autopost';
import {ROOT, api} from './env';

for (const ev of ['uncaughtException', 'unhandledRejection'] as const) process.on(ev, (e: any) => (console.error(`✗ ${e?.message ?? e}`), process.exit(1)));

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(`--${k}`);
const opt = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const TZ = opt('tz', 'Africa/Johannesburg')!;
const TIMES = opt('times', '13:00,19:00')!.split(',');
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', {timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

type Row = {name: string; status: string; dueAt: string; hold: boolean; video: string; ref: string | null; meta: any; postedAt: string | null; channels: string[]; published: NonNullable<Entry['published']>; errors: Record<string, string>; log: string[]};
const listQueue = async (status = 'active', limit = 200) => (await api<{videos: Row[]}>(`/queue?status=${status}&limit=${limit}`)).videos;

// ---- the finished post per channel ------------------------------------------------------------------------------
function buildPosts(spec: any, captionFile: string, video: string): Entry['posts'] {
  const raw = existsSync(captionFile) ? readFileSync(captionFile, 'utf8').trim() : 'Can you beat it? 🌍 #geography #quiz';
  const caption = raw.split('\n')[0].trim();
  const link: string = spec.link ?? 'https://locato.quest';
  const p = spec.props ?? {};
  const n = p.rounds?.length;
  const title = (spec.youtubeTitle ?? (p.title ? `${p.title}${p.badge ? ` | ${p.badge}` : ''} 🌍` : 'Geography quiz 🌍')).replace(/\s+/g, ' ').slice(0, 90);
  const assets = [{video: {url: video, metadata: {thumbnailOffset: 400}}}];
  const social = `${caption}\n\nPlay free: link in bio 🔗`; // links in TikTok/Instagram captions aren't clickable
  return {
    tiktok: {text: social, assets, metadata: {tiktok: {isAiGenerated: false}}}, // AI-content label: off (the owner's call)
    instagram: {text: social, assets, metadata: {instagram: {type: 'reel', shouldShareToFeed: true}}},
    youtube: {
      text: `${caption}\n\nPlay free in your browser: ${link}${n ? `\n\n${n} rounds, easy to boss. Comment your score!` : ''}`,
      assets,
      metadata: {youtube: {title, categoryId: '27', privacy: 'public', madeForKids: false, notifySubscribers: true}},
    },
  };
}

// ---- stage --------------------------------------------------------------------------------------------------------
async function stage(defaultStart?: string) {
  const files = argv.filter((a, i) => a.endsWith('.json') && !argv[i - 1]?.startsWith('--')).sort();
  if (!files.length) throw new Error('Usage: npm run stage -- videos/<…>.json [--dry-run]');
  const DRY = flag('dry-run');
  const active = await listQueue('active');
  const existing = new Map(active.map((r) => [r.name, r]));
  const taken = new Set(active.map((r) => Date.parse(r.dueAt)));
  const now = new Date(Date.now() + 10 * 60e3);
  const start = opt('start', defaultStart);
  const every = Number(opt('every', '60'));
  let cursor: Date | null = null;
  if (start) {
    const [d, hm] = start === 'now' ? [null, null] : start.includes('T') ? start.split('T') : [localDate(new Date(), TZ), start];
    cursor = d ? new Date(localToUtc(d, hm!, TZ)) : new Date(Date.now() + 6 * 60e3); // "now" = in a few minutes (Buffer needs a future time)
  }
  const nextFree = (after: Date) => {
    for (const s of slotsAfter(after, TIMES, TZ)) if (!taken.has(Date.parse(s))) return s;
    throw new Error('no free slot');
  };
  let last = new Date(Math.max(now.getTime(), ...[...taken].filter((t) => t > now.getTime())));
  let added = 0;
  for (const f of files) {
    const name = basename(f, '.json');
    const spec = JSON.parse(readFileSync(f, 'utf8'));
    // a spec's "file" is relative to its own project (specs live in <project>/videos/)
    const mp4 = spec.file ? resolve(dirname(resolve(f)), '..', spec.file) : join(ROOT, 'out', `${name}.mp4`);
    if (!existsSync(mp4)) {
      console.warn(`· ${name}: not rendered (npm run render -- ${f}); skipped`);
      continue;
    }
    const old = existing.get(name);
    if (old && Object.keys(old.published ?? {}).length) {
      console.log(`· ${name}: already in Buffer; left as is`);
      continue;
    }
    let due: string;
    const m = /^(\d{4}-\d{2}-\d{2})-(am|pm)-/.exec(name);
    if (cursor) (due = cursor.toISOString()), (cursor = new Date(cursor.getTime() + every * 60e3));
    else if (m) due = localToUtc(m[1], TIMES[m[2] === 'am' ? 0 : Math.min(1, TIMES.length - 1)], TZ);
    else due = nextFree(old ? new Date(Math.max(now.getTime(), Date.parse(old.dueAt) - 1)) : last);
    if (!start && Date.parse(due) < now.getTime()) {
      const was = due;
      due = nextFree(now);
      console.log(`· ${name}: ${fmt(was)} has passed, using ${fmt(due)}`);
    }
    if (old) taken.delete(Date.parse(old.dueAt));
    taken.add(Date.parse(due));
    if (Date.parse(due) > last.getTime()) last = new Date(due);
    if (DRY) {
      console.log(`  would queue ${name} for ${fmt(due)}`);
      continue;
    }
    const up = await api<{url: string; uploaded: boolean}>(`/media/videos/${name}`, {method: 'PUT', body: Bun.file(mp4), headers: {'content-type': 'video/mp4'}});
    const ref = /[?&]ref=([^&]+)/.exec(spec.link ?? '')?.[1];
    await api('/queue', {method: 'POST', json: {name, dueAt: due, video: up.url, posts: buildPosts(spec, f.replace(/\.json$/, '.caption.txt'), up.url), ref, meta: spec.props?.meta ?? (spec.recipe ? {format: spec.recipe.format} : undefined), hold: flag('hold') || undefined}});
    added++;
    console.log(`  ✓ ${name} queued for ${fmt(due)}${up.uploaded ? '' : ' (video already uploaded)'}`);
  }
  console.log(DRY ? 'Dry run: nothing uploaded.' : `Queued ${added}.`);
  return added;
}

// ---- views and controls ---------------------------------------------------------------------------------------------
async function show() {
  if (flag('done')) {
    const done = await listQueue('posted', Number(opt('last', '20')));
    for (const e of done) console.log(`${fmt(e.postedAt ?? e.dueAt).padEnd(22)} ${e.name.padEnd(30)} ${SERVICES.map((s) => e.published?.[s]?.link ?? '').filter(Boolean).join('  ')}`);
    return console.log(`${done.length} posted video(s)`);
  }
  const rows = await listQueue('active');
  if (!rows.length) return console.log('Queue is empty. Add a batch with: npm run stage -- videos/<week>-*.json');
  const now = Date.now();
  for (const e of rows) {
    const inBuffer = SERVICES.filter((s) => e.published?.[s]);
    const sent = SERVICES.filter((s) => e.published?.[s]?.status === 'sent');
    const state = e.hold ? 'ON HOLD' : sent.length ? `sent: ${sent.join(', ')}` : inBuffer.length === e.channels.length ? (Date.parse(e.dueAt) < now ? 'due: checking with Buffer' : 'scheduled in Buffer') : inBuffer.length ? `in Buffer: ${inBuffer.join(', ')}` : 'waiting';
    const lost = SERVICES.filter((s) => e.published?.[s]?.status === 'missing').map((s) => `${s}: post not found in Buffer (deleted?)`);
    const probs = [...Object.entries(e.errors ?? {}).map(([s, m]) => `${s}: ${m}`), ...lost];
    console.log(`${fmt(e.dueAt).padEnd(22)} ${e.name.padEnd(30)} ${state}${probs.length ? `  ⚠ ${probs.join('; ')}` : ''}`);
  }
}

async function tick() {
  const r = await api<{log: string[]; error: string | null}>('/tick', {method: 'POST'});
  for (const l of r.log) console.log(`  ${l}`);
  if (r.error) throw new Error(`posting step: ${r.error}`);
}

if (argv[0] === 'stage') await stage();
else if (argv[0] === 'publish') {
  if (await stage('now')) await tick();
} else if (opt('hold') || opt('release')) {
  const name = opt('hold') ?? opt('release')!;
  await api(`/queue/${name}`, {method: 'PATCH', json: {hold: !!opt('hold')}});
  console.log(`${name}: ${opt('hold') ? 'on hold' : 'released'}`);
} else if (opt('remove')) {
  const r = await api<{pulledFromBuffer: string[]}>(`/queue/${opt('remove')}`, {method: 'DELETE'});
  console.log(`${opt('remove')} removed from the queue${r.pulledFromBuffer.length ? ` (deleted its unsent Buffer posts: ${r.pulledFromBuffer.join(', ')})` : ''}. The record stays.`);
} else if (flag('run')) await tick();
else if (flag('last-run')) {
  const {runs} = await api<{runs: {at: string; trigger: string; log: string; error: string | null}[]}>('/runs?limit=1');
  console.log(runs[0] ? `${runs[0].at} (${runs[0].trigger})\n${runs[0].log}${runs[0].error ? `\nERROR ${runs[0].error}` : ''}` : 'No runs yet.');
} else await show();
