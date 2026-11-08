// Promo Studio: build a video from a recipe, preview it live with the real templates, save it or queue it for rendering.
// Served by the promo service at /studio/ and shown inside the game's admin (Promo → Create). Everything here runs in
// the browser: compile() picks the rounds from the game's data, the Remotion Player draws the real templates, voice
// lines come from the voice library. Renders happen on the Mac (npm run render-runner).
import {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from '@remotion/player';
import {compile, type Compiled} from '../src/content/compile';
import {indexGame, type Game, type GameData} from '../src/content/game';
import {MODES} from '../src/content/modes';
import {MODE_IDS, type Content, type ModeId, type Recipe} from '../src/content/types';
import {clipKey, coverage, voiceLines, type ClipInfo} from '../src/content/voice';
import {FPS, H, MUSIC, W} from '../src/locato/brand';
import {lookDuration, quizDuration} from '../src/locato/schema';
import {Lookalikes} from '../src/locato/templates/Lookalikes';
import {Quiz} from '../src/locato/templates/Quiz';

declare const ADMIN_ORIGINS: string[]; // injected at build from worker/wrangler.jsonc

// ---- auth: a short-lived admin token from the admin page (postMessage), or #token= for a direct link -------------
type Token = {token: string; exp: number};
const decodeExp = (t: string) => {
  try {
    return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp as number;
  } catch {
    return 0;
  }
};
let token: Token | null = (() => {
  const t = new URLSearchParams(location.hash.slice(1)).get('token');
  if (t) history.replaceState(null, '', location.pathname); // don't leave it in the address bar
  return t ? {token: t, exp: decodeExp(t)} : null;
})();
const waiters: ((t: Token) => void)[] = [];
window.addEventListener('message', (e) => {
  if (!ADMIN_ORIGINS.includes(e.origin) || e.data?.type !== 'locato-promo:token') return;
  token = {token: e.data.token, exp: decodeExp(e.data.token)};
  waiters.splice(0).forEach((w) => w(token!));
});
async function getToken(): Promise<string> {
  if (token && token.exp * 1000 - Date.now() > 60_000) return token.token;
  if (window.parent === window) throw new Error('Open the Studio from the admin (Promo → Create)');
  const t = new Promise<Token>((resolve, reject) => {
    waiters.push(resolve);
    setTimeout(() => reject(new Error('The admin page did not send a token')), 10_000);
  });
  window.parent.postMessage({type: 'locato-promo:token-request'}, '*'); // the reply only comes from an allowed admin origin
  return (await t).token;
}
async function api<T = any>(path: string, init: RequestInit & {json?: unknown} = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${await getToken()}`);
  let body = init.body;
  if (init.json !== undefined) (body = JSON.stringify(init.json)), headers.set('content-type', 'application/json');
  const r = await fetch(path, {...init, headers, body});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as any).error ?? `Request failed (${r.status})`);
  return d as T;
}

// ---- data ---------------------------------------------------------------------------------------------------------
async function loadGame(): Promise<Game> {
  const [data, world, extras] = await Promise.all(['/locato/data.json', '/locato/map/world.json', '/locato/map/extras.json'].map((u) => fetch(u).then((r) => r.json())));
  return indexGame({countries: data.countries, lookalikes: data.lookalikes, themes: data.themes, world, extras} as GameData);
}
const flagCache = new Map<string, string>();
async function preloadFlags(game: Game) {
  const todo = game.countries.filter((c) => c.flag && !flagCache.has(c.code));
  await Promise.all(todo.map(async (c) => flagCache.set(c.code, await fetch(`/locato/flags/${c.code.toLowerCase()}.svg`).then((r) => r.text()))));
}
const svgData = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const newSeed = () => Math.random().toString(36).slice(2, 8);
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');

// ---- the page -----------------------------------------------------------------------------------------------------
type Job = {id: string; name: string; recipe: Recipe; seed: string; status: string; hold: boolean; createdAt: string; finishedAt: string | null; error: string | null; result: any; log: string | null};
// the Studio's names for modes whose on-screen label is shared
const MODE_NAME: Partial<Record<ModeId, string>> = {capital: 'Capitals (name the capital)', 'capital-of': 'Capitals (name the country)'};
const DEFAULT: Recipe = {format: 'quiz', modes: ['flag'], count: 5};

function App() {
  const [game, setGame] = useState<Game | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [voices, setVoices] = useState<{id: string; name: string; count: number}[]>([]);
  const [voiceId, setVoiceId] = useState(''); // set once the voices load
  const [clips, setClips] = useState<Record<string, ClipInfo>>({});
  const [music, setMusic] = useState<{name: string}[]>([]);
  const [musicChoice, setMusicChoice] = useState('default');
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(DEFAULT);
  const [seed, setSeed] = useState(newSeed());
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [hold, setHold] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flagsReady, setFlagsReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [g, c, v, m] = await Promise.all([loadGame(), api('/content'), api('/voices'), api('/music')]);
        setGame(g);
        setContent(c);
        setVoices(v.voices);
        setMusic(m.music);
        setVoiceId(v.voices.some((x: any) => x.id === 'george') ? 'george' : v.voices[0]?.id ?? 'none');
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);
  useEffect(() => {
    if (!voiceId || voiceId === 'none') return setClips({});
    api(`/voices/${voiceId}`).then((r) => setClips(r.clips)).catch(() => setClips({}));
  }, [voiceId]);
  const refreshJobs = () => api('/jobs').then((r) => setJobs(r.jobs)).catch(() => undefined);
  useEffect(() => {
    refreshJobs();
    const t = setInterval(refreshJobs, 10_000);
    return () => clearInterval(t);
  }, []);
  // flag-colour rounds need every flag's SVG to pick a 2–5 colour flag
  const needsFlags = JSON.stringify(recipe).includes('colours') || (recipe.format === 'quiz' && recipe.modes === 'mix');
  useEffect(() => {
    if (game && needsFlags && !flagsReady) preloadFlags(game).then(() => setFlagsReady(true));
  }, [game, needsFlags, flagsReady]);

  // compile the recipe: same code as the Mac's `npm run new`
  const built = useMemo((): {c?: Compiled; err?: string} => {
    if (!game || !content) return {};
    if (needsFlags && !flagsReady) return {err: 'Loading flags…'};
    try {
      const c = compile(recipe, {game, content, seed, assets: {flagSvg: (code) => flagCache.get(code.toUpperCase()) ?? flagCache.get(code) ?? ''}, today: new Date().toISOString().slice(0, 10)});
      return {c};
    } catch (e) {
      return {err: (e as Error).message};
    }
  }, [game, content, recipe, seed, needsFlags, flagsReady]);

  // the preview's props: generated images inline, voice lines from the library, music by signed link
  const templateMusic = built.c ? MUSIC[built.c.template as keyof typeof MUSIC] : MUSIC.quiz;
  const musicName = musicChoice === 'default' ? templateMusic.split('/').pop()!.replace(/\.[a-z0-9]+$/, '') : musicChoice;
  useEffect(() => {
    setMusicUrl(null);
    if (musicChoice === 'none' || !music.some((m) => m.name === musicName)) return;
    api(`/music/${musicName}/link`, {method: 'POST'}).then((r) => setMusicUrl(r.url)).catch(() => setMusicUrl(null));
  }, [musicName, musicChoice, music]);
  const preview = useMemo(() => {
    const c = built.c;
    if (!c) return null;
    const props: any = structuredClone(c.props);
    for (const r of props.rounds ?? []) if (r.stages) r.stages = r.stages.map((s: string) => (c.files[s] ? svgData(c.files[s]) : s));
    const lines = voiceLines(c.template, props);
    const cov = coverage({clips}, lines);
    const voice: any = {};
    for (const l of cov.have) {
      const clip = {src: l.clip.url!, duration: l.clip.duration, text: l.text};
      if (l.slot === 'answers') (voice.answers ??= [])[l.index!] = clip;
      else voice[l.slot] = clip;
    }
    if (voiceId !== 'none') props.voice = voice;
    props.music = musicChoice === 'none' || !musicUrl ? false : {src: musicUrl, volume: 0.5};
    const isQuiz = c.template !== 'lookalikes';
    const seconds = isQuiz ? quizDuration(props) : lookDuration(props);
    return {props, missing: voiceId === 'none' ? [] : cov.missing, frames: Math.ceil(seconds * FPS), seconds, isQuiz};
  }, [built.c, clips, voiceId, musicUrl, musicChoice]);

  // suggest a name from the video until it's typed over
  useEffect(() => {
    if (built.c && !nameEdited) setName(`${built.c.name.replace(/-\d{8}$/, '')}-${stamp()}`);
  }, [built.c?.name, nameEdited]);

  async function save(queue: boolean) {
    setNotice(null);
    try {
      // the render uses the same voice and music choice as the preview
      const style = {...(recipe as any).style, ...(voiceId === 'none' ? {voice: 'none'} : {}), ...(musicChoice !== 'default' ? {music: musicChoice} : {})};
      await api('/jobs', {method: 'POST', json: {name, recipe: {...(built.c?.recipe ?? recipe), ...(Object.keys(style).length ? {style} : {})}, seed, queue, hold}});
      setNotice(queue ? `Queued "${name}" for rendering. It renders on the Mac (npm run render-runner) and lands in Promo → Queue${hold ? ' on hold' : ''}.` : `Saved "${name}" as a draft.`);
      setNameEdited(false);
      refreshJobs();
    } catch (e) {
      setNotice(`✗ ${(e as Error).message}`);
    }
  }
  async function jobAction(j: Job, status: 'queued' | 'cancelled') {
    try {
      await api(`/jobs/${j.id}`, {method: 'PATCH', json: {status}});
      refreshJobs();
    } catch (e) {
      setNotice(`✗ ${(e as Error).message}`);
    }
  }

  if (error) return <div className="pad"><h2>Promo Studio</h2><p className="err">{error}</p></div>;
  if (!game || !content) return <div className="pad">Loading the game's data…</div>;
  const set = (patch: Partial<Recipe>) => setRecipe({...recipe, ...patch} as Recipe);
  const r: any = recipe;
  const continents = [...new Set(game.countries.map((c) => c.continent))].sort();
  const include: string[] = r.countries?.include ?? [];
  const setInclude = (next: string[]) => set({countries: {...r.countries, include: next.length ? next : undefined}} as any);
  const toggleRef = (ref: string) => setInclude(include.includes(ref) ? include.filter((x) => x !== ref) : [...include, ref]);
  const rulesMode = r.rules?.mode ?? 'score';
  const hooks = content.phrases.filter((p) => p.slot === 'hook' && (!p.suits?.format || p.suits.format.includes(recipe.format)) && (!p.suits?.rules || recipe.format !== 'quiz' || p.suits.rules.includes(rulesMode)));
  const captions = content.phrases.filter((p) => p.slot === 'caption' && (!p.suits?.format || p.suits.format.includes(recipe.format)));
  const modeList: ModeId[] = Array.isArray(r.modes) ? r.modes : [];

  return (
    <div className="studio">
      <section className="form">
        <h2>Build a video</h2>
        <label>Format
          <select value={recipe.format} onChange={(e) => { setRecipe(e.target.value === 'quiz' ? DEFAULT : ({format: e.target.value} as Recipe)); setNameEdited(false); }}>
            <option value="quiz">Quiz (every game mode)</option><option value="daily">Daily warm-up</option><option value="lookalikes">Look-alikes</option>
          </select>
        </label>

        {recipe.format === 'quiz' && (
          <>
            <div className="label">Modes {r.modes === 'mix' ? '(one of each, Overland boss)' : '(rounds cycle through these)'}</div>
            <div className="chips">
              <button className={r.modes === 'mix' ? 'on' : ''} onClick={() => set({modes: r.modes === 'mix' ? ['flag'] : 'mix'} as any)}>Every mode</button>
              {MODE_IDS.map((m) => (
                <button key={m} className={modeList.includes(m) ? 'on' : ''} disabled={r.modes === 'mix'}
                  onClick={() => { const next = modeList.includes(m) ? modeList.filter((x) => x !== m) : [...modeList, m]; set({modes: next.length ? next : ['flag']} as any); }}>{MODE_NAME[m] ?? MODES[m].label}</button>
              ))}
            </div>
            <div className="row">
              <label>Rounds <input type="number" min={1} max={10} value={r.count ?? 5} onChange={(e) => set({count: Number(e.target.value)} as any)} /></label>
              <label>Rules <select value={rulesMode} onChange={(e) => set({rules: {...r.rules, mode: e.target.value}, copy: {...r.copy, hook: undefined}} as any)}><option value="score">Score</option><option value="one-life">One Life</option></select></label>
              <label>Difficulty <select value={r.rules?.ladder ?? 'ladder'} onChange={(e) => set({rules: {...r.rules, ladder: e.target.value}} as any)}><option value="ladder">Easy → boss</option><option value="thirds">Thirds</option></select></label>
            </div>
          </>
        )}
        {recipe.format === 'daily' && <label>Date <input type="date" value={r.date ?? new Date().toISOString().slice(0, 10)} onChange={(e) => set({date: e.target.value} as any)} /></label>}
        {recipe.format === 'lookalikes' && (
          <div className="row">
            <label>Kind <select value={r.skill ?? 'flag'} onChange={(e) => set({skill: e.target.value} as any)}><option value="flag">Flags</option><option value="shape">Outlines</option></select></label>
            <label>Sets <input type="number" min={1} max={6} value={r.count ?? 3} onChange={(e) => set({count: Number(e.target.value)} as any)} /></label>
          </div>
        )}

        {recipe.format !== 'daily' && (
          <>
            <div className="label">Countries (same kind = or; different kinds narrow each other)</div>
            <div className="chips">
              {continents.map((c) => { const ref = `continent:${c.toLowerCase().replace(/ /g, '-')}`; return <button key={c} className={include.includes(ref) ? 'on' : ''} onClick={() => toggleRef(ref)}>{c}</button>; })}
              {(['easy', 'medium', 'hard'] as const).map((l) => <button key={l} className={include.includes(`level:${l}`) ? 'on' : ''} onClick={() => toggleRef(`level:${l}`)}>{l}</button>)}
              {game.themes.map((t) => <button key={t.id} className={include.includes(`theme:${t.id}`) ? 'on' : ''} onClick={() => toggleRef(`theme:${t.id}`)}>{t.title}</button>)}
              {content.lists.map((l) => <button key={l.id} className={include.includes(`list:${l.id}`) ? 'on' : ''} onClick={() => toggleRef(`list:${l.id}`)}>list: {l.name}</button>)}
            </div>
            <div className="row">
              <label>Leave out <input placeholder="e.g. FR, Israel" defaultValue={(r.countries?.exclude ?? []).join(', ')} onBlur={(e) => set({countries: {...r.countries, exclude: e.target.value.split(',').map((x) => x.trim()).filter(Boolean)}} as any)} /></label>
              {recipe.format === 'quiz' && <label>Use these <input placeholder="e.g. chad, romania" defaultValue={(r.picks ?? []).join(', ')} onBlur={(e) => { const v = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); set({picks: v.length ? v : undefined} as any); }} /></label>}
              {recipe.format === 'quiz' && <label>Boss <input placeholder="e.g. liechtenstein" defaultValue={r.boss ?? ''} onBlur={(e) => set({boss: e.target.value.trim() || undefined} as any)} /></label>}
            </div>
          </>
        )}

        <div className="row">
          <label>Hook
            <select value={r.copy?.title !== undefined ? '__custom' : r.copy?.hook === false ? '__none' : r.copy?.hook ?? ''} onChange={(e) => {
              const v = e.target.value;
              set({copy: {...r.copy, hook: v === '__none' ? false : v && v !== '__custom' ? v : undefined, title: v === '__custom' ? r.copy?.title ?? 'Your hook here' : undefined}} as any);
            }}>
              <option value="">Default for this video</option>
              {hooks.filter((p) => p.text).map((p) => <option key={p.id} value={p.id}>{p.text}</option>)}
              <option value="__custom">Custom text…</option><option value="__none">No hook</option>
            </select>
          </label>
          {r.copy?.title !== undefined && <label>Hook text <input value={r.copy.title} onChange={(e) => set({copy: {...r.copy, title: e.target.value}} as any)} /></label>}
          <label>Caption
            <select value={typeof r.copy?.caption === 'string' ? r.copy.caption : ''} onChange={(e) => set({copy: {...r.copy, caption: e.target.value || undefined}} as any)}>
              <option value="">Default</option>
              {captions.map((p) => <option key={p.id} value={p.id}>{p.text.slice(0, 60)}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <label>Voice <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.count} lines)</option>)}<option value="none">No voice</option></select></label>
          <label>Music <select value={musicChoice} onChange={(e) => setMusicChoice(e.target.value)}><option value="default">Default for this format</option>{music.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}<option value="none">No music</option></select></label>
          <label>Seed <span className="seed"><input value={seed} onChange={(e) => setSeed(e.target.value)} /><button title="New picks" onClick={() => setSeed(newSeed())}>🎲</button></span></label>
        </div>
      </section>

      <section className="preview">
        {built.err && <p className="err">{built.err}</p>}
        {preview && built.c && (
          <>
            <Player key={built.c.template} component={(preview.isQuiz ? Quiz : Lookalikes) as any} inputProps={preview.props} durationInFrames={Math.max(1, preview.frames)} fps={FPS} compositionWidth={W} compositionHeight={H}
              controls style={{width: 342, height: 608, borderRadius: 14, overflow: 'hidden', background: '#000'}} acknowledgeRemotionLicense />
            <p className="muted">{preview.seconds.toFixed(1)}s · {built.c.props.title || '(no hook)'}{musicChoice !== 'none' && !musicUrl ? ' · music not uploaded yet (Promo → Music), previewing without it' : ''}</p>
          </>
        )}
      </section>

      <section className="side">
        {built.c && (
          <>
            <h3>Rounds</h3>
            <ol className="rounds">
              {((built.c.props as any).rounds ?? (built.c.props as any).sets ?? []).map((x: any, i: number) => (
                <li key={i}>{x.type ? `${MODES[x.type as ModeId]?.label ?? x.type}: ` : ''}<b>{x.answer ?? x.items?.map((it: any) => it.name).join(' / ')}</b>{x.boss ? ' · boss' : ''}{x.seconds ? <span className="muted"> · {x.seconds}s</span> : null}</li>
              ))}
            </ol>
            {built.c.warnings.map((w) => <p key={w} className="warn">⚠ {w}</p>)}
            {preview && preview.missing.length > 0 && (
              <div className="warn">
                <b>{preview.missing.length} line(s) not in the voice library yet</b> (silent in the preview; the Mac records them when it renders):
                <ul>{preview.missing.map((l) => <li key={clipKey(l.text)}>{l.text}</li>)}</ul>
              </div>
            )}
            <p className="muted">Caption: {built.c.caption}</p>
            <h3>Make it</h3>
            <label>Name <input value={name} onChange={(e) => { setNameEdited(true); setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-')); }} /></label>
            <label className="check"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Hold when queued for posting (approve in Promo → Queue)</label>
            <div className="row"><button className="primary" onClick={() => save(true)} disabled={!name}>Render</button><button onClick={() => save(false)} disabled={!name}>Save draft</button></div>
            {notice && <p className={notice.startsWith('✗') ? 'err' : 'ok'}>{notice}</p>}
          </>
        )}
        <h3>Drafts and renders</h3>
        {jobs.length === 0 ? <p className="muted">None yet.</p> : (
          <ul className="jobs">
            {jobs.map((j) => (
              <li key={j.id}>
                <div><b>{j.name}</b> <span className={`st st-${j.status}`}>{j.status}</span></div>
                {j.error && <div className="err">{j.error}</div>}
                {j.result?.video && <div><a href={j.result.video} target="_blank" rel="noreferrer">video</a>{j.result.dueAt ? ` · queued for ${new Date(j.result.dueAt).toLocaleString()}` : ''}</div>}
                <div className="row">
                  <button onClick={() => { setRecipe(j.recipe); setSeed(j.seed); setNameEdited(false); }}>Open</button>
                  {['draft', 'failed', 'cancelled'].includes(j.status) && <button onClick={() => jobAction(j, 'queued')}>Render</button>}
                  {['draft', 'queued'].includes(j.status) && <button onClick={() => jobAction(j, 'cancelled')}>Cancel</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Renders run on the Mac: <code>npm run render-runner</code> in locato/promo.</p>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
