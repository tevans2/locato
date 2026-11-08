#!/usr/bin/env bun
// A page for listening through a voice's library: groups (respelled names, lines that needed retries, hooks, reveals…),
// play-all with the current line highlighted, one-key flagging, and a "copy flagged" list to hand back for re-recording.
//   npm run voices:review -- george        → writes out/voice-review/george.html and opens it
import {readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {isRespelled, speakable, type Pronunciations} from '../../src/content/speech';
import type {ClipInfo, VoiceInfo} from '../../src/content/voice';
import {ROOT, api} from '../locato/env';

const voiceId = process.argv[2];
if (!voiceId) throw new Error('Usage: npm run voices:review -- <voice>');
const dict: Pronunciations = JSON.parse(readFileSync(join(ROOT, 'content/pronunciations.json'), 'utf8'));
const {voice, clips} = await api<{voice: VoiceInfo; clips: Record<string, ClipInfo>}>(`/voices/${voiceId}`);

// lines that needed more than one take (from the build logs)
const retried = new Map<string, number>();
const logDir = join(ROOT, 'out/voice-build', voiceId);
if (existsSync(logDir))
  for (const f of readdirSync(logDir).filter((f) => f.endsWith('.log')))
    for (const m of readFileSync(join(logDir, f), 'utf8').matchAll(/✓ (.+?) \(try (\d)\)/g)) retried.set(m[1], Math.max(retried.get(m[1]) ?? 0, Number(m[2])));

const COUNTRY_NAMES = new Set<string>(JSON.parse(readFileSync(join(ROOT, 'public/locato/data.json'), 'utf8')).countries.map((c: {name: string}) => c.name));
const kindOf = (t: string) =>
  /^That's .+!$/.test(t) ? 'Country & capital reveals'
  : /^It's in .+!$/.test(t) ? 'MapTap reveals'
  : /side, with \d+ percent!$/.test(t) ? 'Worldsplit'
  : /\? Comment your|Comment your (score|round)!$/.test(t) ? 'Closing questions'
  : /Prove it|Play .*free|locato\.quest/.test(t) ? 'Calls to action'
  : t.endsWith('.') && t.slice(0, -1).split('. ').every((n) => COUNTRY_NAMES.has(n)) ? 'Look-alike reveals'
  : 'Hooks';
const rows = Object.values(clips)
  .map((c) => ({key: c.key, text: c.text, url: c.url, dur: c.duration, kind: kindOf(c.text), said: isRespelled(c.text, dict) ? speakable(c.text, dict) : null, tries: retried.get(c.text) ?? 1}))
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.text.localeCompare(b.text));

const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voice review · ${voice.name}</title>
<style>
:root{--bg:#f7f6f1;--card:#fff;--line:#e3e0d6;--ink:#1b3023;--muted:#5b6b5f;--accent:#2f6b45;--flag:#b3261e;--now:#fff6d6}
body{margin:0;font:15px/1.45 -apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 20px;z-index:2}
h1{font-size:20px;margin:0 0 8px} .muted{color:var(--muted)} .row-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
button,input{font:inherit} button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 12px;cursor:pointer}
button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff} input[type=search]{border:1px solid var(--line);border-radius:8px;padding:6px 10px;min-width:220px}
main{max-width:980px;margin:0 auto;padding:12px 20px 80px} .help{font-size:13px;margin-top:8px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
td{padding:7px 10px;border-top:1px solid var(--line);vertical-align:middle} tr.now td{background:var(--now)} tr.flagged td{box-shadow:inset 3px 0 var(--flag)}
.said{font-size:12px;color:var(--muted)} .tag{font-size:11px;padding:1px 6px;border-radius:999px;background:#eef3ee;color:var(--accent);margin-left:6px}
.flagbtn[aria-pressed=true]{background:var(--flag);border-color:var(--flag);color:#fff} #flagged{white-space:pre-wrap;font-size:13px}
</style>
<header>
  <h1>${voice.name}: ${rows.length} lines <span class="muted" id="count"></span></h1>
  <div class="row-tools" id="filters"></div>
  <div class="row-tools" style="margin-top:8px">
    <input type="search" id="q" placeholder="Search, e.g. Kenya">
    <button id="playall">▶ Play these</button><button id="stop">■ Stop</button>
    <span class="muted" id="flagcount"></span><button id="copy">Copy flagged</button><button id="clear">Clear flags</button>
  </div>
  <div class="help muted">Play these: plays each line in turn. Keys while playing: <b>F</b> flag the current line · <b>→</b> next · <b>←</b> again · <b>Space</b> pause. Flags are saved in this browser.</div>
</header>
<main><table><tbody id="rows"></tbody></table><h3>Flagged</h3><div id="flagged" class="muted">None yet.</div></main>
<script>
const ROWS = ${JSON.stringify(rows)};
const KEY = 'voice-review-${voiceId}';
let flags = new Set(); try { flags = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...flags])); } catch {} ; renderFlags(); };
const GROUPS = [['All', () => true], ['Respelled names', (r) => r.said], ['Needed retries', (r) => r.tries > 1],
  ...[...new Set(ROWS.map((r) => r.kind))].map((k) => [k, (r) => r.kind === k]), ['Flagged', (r) => flags.has(r.key)]];
let group = 'Respelled names', q = '', current = -1, playing = false;
const audio = new Audio();
const visible = () => ROWS.filter(GROUPS.find((g) => g[0] === group)[1]).filter((r) => !q || r.text.toLowerCase().includes(q));
function render() {
  document.getElementById('filters').innerHTML = GROUPS.map(([g, f]) => '<button aria-pressed="' + (g === group) + '" data-g="' + g + '">' + g + ' (' + ROWS.filter(f).length + ')</button>').join('');
  const v = visible();
  document.getElementById('count').textContent = '· showing ' + v.length;
  document.getElementById('rows').innerHTML = v.map((r, i) => '<tr data-i="' + i + '" class="' + (i === current ? 'now ' : '') + (flags.has(r.key) ? 'flagged' : '') + '">' +
    '<td style="width:44px"><button data-play="' + i + '">▶</button></td><td>' + r.text + (r.tries > 1 ? '<span class="tag">take ' + r.tries + '</span>' : '') +
    (r.said ? '<div class="said">said as: ' + r.said + '</div>' : '') + '</td><td class="muted" style="width:60px">' + r.dur.toFixed(1) + 's</td>' +
    '<td style="width:80px"><button class="flagbtn" data-flag="' + r.key + '" aria-pressed="' + flags.has(r.key) + '">Flag</button></td></tr>').join('');
}
function renderFlags() {
  const f = ROWS.filter((r) => flags.has(r.key));
  document.getElementById('flagcount').textContent = f.length + ' flagged';
  document.getElementById('flagged').textContent = f.length ? f.map((r) => r.text).join('\\n') : 'None yet.';
}
function play(i) {
  const v = visible(); if (i < 0 || i >= v.length) { playing = false; current = -1; render(); return; }
  current = i; render(); document.querySelector('tr[data-i="' + i + '"]')?.scrollIntoView({block: 'center'});
  audio.src = v[i].url; audio.play();
}
audio.onended = () => { if (playing) setTimeout(() => playing && play(current + 1), 350); };
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.g) { group = t.dataset.g; current = -1; render(); }
  if (t.dataset.play) { playing = false; play(Number(t.dataset.play)); }
  if (t.dataset.flag) { flags.has(t.dataset.flag) ? flags.delete(t.dataset.flag) : flags.add(t.dataset.flag); save(); render(); }
});
document.getElementById('q').oninput = (e) => { q = e.target.value.toLowerCase(); current = -1; render(); };
document.getElementById('playall').onclick = () => { playing = true; play(current >= 0 ? current : 0); };
document.getElementById('stop').onclick = () => { playing = false; audio.pause(); };
document.getElementById('copy').onclick = () => navigator.clipboard.writeText(ROWS.filter((r) => flags.has(r.key)).map((r) => r.text).join('\\n'));
document.getElementById('clear').onclick = () => { if (confirm('Clear all flags?')) { flags.clear(); save(); render(); } };
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const v = visible();
  if (e.key === 'f' && current >= 0) { const k = v[current].key; flags.has(k) ? flags.delete(k) : flags.add(k); save(); render(); }
  if (e.key === 'ArrowRight') play(current + 1);
  if (e.key === 'ArrowLeft') play(Math.max(0, current));
  if (e.key === ' ') { e.preventDefault(); audio.paused ? audio.play() : audio.pause(); }
});
render(); renderFlags();
</script>`;
mkdirSync(join(ROOT, 'out/voice-review'), {recursive: true});
const file = join(ROOT, 'out/voice-review', `${voiceId}.html`);
writeFileSync(file, html);
const by = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
console.log(`✓ ${file}\n  ${rows.length} lines · ${by((r) => !!r.said)} respelled names · ${by((r) => r.tries > 1)} needed retries`);
if (!process.argv.includes('--no-open')) spawnSync('open', [file]);
