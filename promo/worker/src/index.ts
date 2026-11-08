// The promo service (promo.locato.quest): records in D1, files in R2, posting through Buffer.
// Separate from the game; the game's admin calls it from the browser with a short-lived admin token.
//
//   GET    /health                                   no auth
//   GET    /me                                       who you are
//   ── queue / videos ──
//   PUT    /media/videos/:name                       upload an mp4 (→ public bucket) → {url}
//   POST   /queue                                    add/replace a video: {name, dueAt, video, posts, ref?, meta?, hold?}
//   GET    /queue?status=active|posted|removed|all&limit=100
//   PATCH  /queue/:name                              {hold: true|false}
//   DELETE /queue/:name                              take it out (its unsent Buffer posts are deleted; the record stays, status "removed")
//   POST   /tick                                     run the posting step now          GET /runs?limit=10
//   ── content (phrases, lists, presets, plans) ──
//   GET    /content                                  merged: defaults + online       GET /content/online (online items only)
//   PUT    /content/:kind/:id    DELETE /content/:kind/:id (removes the online item; defaults stay)
//   ── voices ──
//   GET    /voices    GET /voices/:id    PUT /voices/:id {name, engine, description?, settings?}    DELETE /voices/:id (hides it)
//   PUT    /voices/:id/clips?text=…&duration=1.2&source=recorded[&replace=1]   body: the audio
//   DELETE /voices/:id/clips/:key                    (the record goes; the file stays in R2)
//   ── music (private bucket) ──
//   GET    /music    PUT /music/:name?licence=…  body: the audio    GET /music/:name/audio (stream it, for previews)
//   GET    /audit?limit=50
import {z} from 'zod';
import phrases from '../../content/phrases.json';
import lists from '../../content/lists.json';
import presets from '../../content/presets.json';
import plans from '../../content/plans.json';
import {gql, fill, SERVICES, type Entry} from '../../tools/locato/autopost';
import {KINDS, mergeContent, validateItem} from '../../src/content/merge';
import type {ContentKind} from '../../src/content/types';
import {ClipInfo, VoiceInfo, clipFile, clipKey} from '../../src/content/voice';
import {authenticate, type Who} from './auth';
import {audit, d1Store, getEntry, now, putEntry, statusOf, type Env, type VideoEntry} from './data';

const DEFAULTS: Record<ContentKind, unknown[]> = {phrases, lists, presets, plans};
const MAX_VIDEO = 60 << 20, MAX_AUDIO = 20 << 20;
const AUDIO_TYPES: Record<string, string> = {'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg'};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json'}});
const body = async <T>(req: Request, schema: z.ZodType<T>): Promise<T> => {
  const r = schema.safeParse(await req.json().catch(() => undefined));
  if (!r.success) throw new HttpError(400, r.error.issues.map((e) => `${e.path.join('.') || '(body)'}: ${e.message}`).join('; '));
  return r.data;
};
const bytesOf = async (req: Request, max: number) => {
  const b = await req.arrayBuffer();
  if (!b.byteLength) throw new HttpError(400, 'Empty body');
  if (b.byteLength > max) throw new HttpError(413, `Too big (${(b.byteLength / 1048576).toFixed(1)} MB; max ${max >> 20} MB)`);
  return b;
};
const sha1 = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
const NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;

function cors(req: Request, env: Env, res: Response) {
  const origin = req.headers.get('origin');
  if (!origin || !env.ADMIN_ORIGINS.split(',').map((s) => s.trim()).includes(origin)) return res;
  const h = new Headers(res.headers);
  h.set('access-control-allow-origin', origin);
  h.set('vary', 'origin');
  h.set('access-control-allow-headers', 'authorization, content-type');
  h.set('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  h.set('access-control-max-age', '86400');
  return new Response(res.body, {status: res.status, headers: h});
}

// ---- the posting step (timer or /tick) ---------------------------------------------------------------------------
async function runPosting(env: Env, trigger: string) {
  const lines: string[] = [];
  let result: Awaited<ReturnType<typeof fill>> | null = null, error: string | null = null;
  try {
    if (!env.BUFFER_API_KEY) throw new Error('BUFFER_API_KEY is not set');
    result = await fill(d1Store(env), {apiKey: env.BUFFER_API_KEY, timeZone: env.TIMEZONE, times: env.TIMES.split(','), log: (s) => (lines.push(s), console.log(s))});
  } catch (e) {
    error = (e as Error).message;
    console.error(e);
  }
  await env.DB.prepare('INSERT INTO runs (at, trigger, scheduled, posted, log, error) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(now(), trigger, result?.scheduled ?? 0, (result as any)?.posted ?? 0, lines.join('\n'), error)
    .run();
  return {result, log: lines, error};
}

// ---- routes ---------------------------------------------------------------------------------------------------------
async function route(req: Request, env: Env, who: Who): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = (re: RegExp) => path.match(re);
  const method = req.method;
  let p: RegExpMatchArray | null;

  if (path === '/me') return json(who);

  // ---- queue / videos
  if ((p = m(/^\/media\/videos\/([a-z0-9-]+)$/)) && method === 'PUT') {
    const name = p[1];
    const key = `videos/${name}.mp4`;
    const b = await bytesOf(req, MAX_VIDEO);
    const head = await env.MEDIA.head(key);
    if (!head || head.size !== b.byteLength) await env.MEDIA.put(key, b, {httpMetadata: {contentType: 'video/mp4'}});
    await audit(env, who.name, 'video.upload', {name, bytes: b.byteLength});
    return json({url: `${env.MEDIA_URL}/${key}?v=${b.byteLength}`, bytes: b.byteLength, uploaded: !head || head.size !== b.byteLength});
  }
  if (path === '/queue' && method === 'POST') {
    const Post = z.object({text: z.string(), metadata: z.unknown(), assets: z.unknown()});
    const b = await body(req, z.object({
      name: z.string().regex(NAME), dueAt: z.string().datetime(), video: z.string().url(),
      posts: z.object({tiktok: Post.optional(), instagram: Post.optional(), youtube: Post.optional()}),
      ref: z.string().optional(), meta: z.record(z.string(), z.unknown()).optional(), hold: z.boolean().optional(),
    }));
    const old = await getEntry(env, b.name);
    if (old && !old.removed && Object.keys(old.published ?? {}).length) throw new HttpError(409, `${b.name} is already in Buffer (${statusOf(old)}); remove it first to replace it`);
    const e: VideoEntry = {name: b.name, video: b.video, dueAt: b.dueAt, hold: b.hold ?? old?.hold, stagedAt: now(), posts: b.posts as Entry['posts'], ref: b.ref, meta: b.meta};
    await putEntry(env, e);
    await audit(env, who.name, 'queue.add', {name: b.name, dueAt: b.dueAt});
    return json({ok: true, status: statusOf(e)});
  }
  if (path === '/queue' && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'active';
    const limit = Math.min(500, Number(url.searchParams.get('limit') ?? 200));
    const where = status === 'all' ? '1=1' : status === 'active' ? "status IN ('queued','scheduled','problem')" : 'status = ?';
    const stmt = env.DB.prepare(`SELECT entry FROM videos WHERE ${where} ORDER BY ${status === 'posted' ? 'posted_at DESC' : 'due_at'} LIMIT ${limit}`);
    const r = await (where.includes('?') ? stmt.bind(status) : stmt).all<{entry: string}>();
    return json({videos: r.results.map((x) => {
      const e = JSON.parse(x.entry) as VideoEntry;
      return {name: e.name, status: statusOf(e), dueAt: e.dueAt, hold: !!e.hold, video: e.video, ref: e.ref ?? null, meta: e.meta ?? null, postedAt: e.postedAt ?? null, channels: Object.keys(e.posts), published: e.published ?? {}, errors: e.errors ?? {}, log: e.log ?? []};
    })});
  }
  if ((p = m(/^\/queue\/([a-z0-9-]+)$/))) {
    const e = await getEntry(env, p[1]);
    if (!e) throw new HttpError(404, `No video "${p[1]}"`);
    if (method === 'PATCH') {
      const b = await body(req, z.object({hold: z.boolean()}));
      e.hold = b.hold;
      await putEntry(env, e);
      await audit(env, who.name, b.hold ? 'queue.hold' : 'queue.release', {name: e.name});
      return json({ok: true, status: statusOf(e)});
    }
    if (method === 'DELETE') {
      const pulled: string[] = [];
      for (const [s, pub] of Object.entries(e.published ?? {})) {
        if (!pub || pub.status === 'sent' || Date.parse(pub.dueAt) < Date.now()) continue;
        if (!env.BUFFER_API_KEY) throw new HttpError(500, 'BUFFER_API_KEY is not set');
        const r = await gql(env.BUFFER_API_KEY, 'mutation($i: DeletePostInput!){ deletePost(input:$i){ __typename } }', {i: {id: pub.postId}});
        if (r.deletePost?.__typename === 'DeletePostSuccess') pulled.push(s);
      }
      e.removed = true;
      e.hold = true;
      (e.log ??= []).push(`${now()} removed by ${who.name}${pulled.length ? `; deleted unsent Buffer posts: ${pulled.join(', ')}` : ''}`);
      await putEntry(env, e);
      await audit(env, who.name, 'queue.remove', {name: e.name, pulled});
      return json({ok: true, pulledFromBuffer: pulled});
    }
  }
  if (path === '/tick' && method === 'POST') return json(await runPosting(env, `manual:${who.name}`));
  if (path === '/runs' && method === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').bind(Math.min(100, Number(url.searchParams.get('limit') ?? 10))).all();
    return json({runs: r.results});
  }

  // ---- content
  if (path === '/content' && method === 'GET') {
    const online = await onlineContent(env);
    return json(mergeContent(DEFAULTS, online));
  }
  if (path === '/content/online' && method === 'GET') return json(await onlineContent(env));
  if ((p = m(/^\/content\/(phrases|lists|presets|plans)\/([a-z0-9.-]+)$/))) {
    const kind = p[1] as ContentKind, id = p[2];
    if (method === 'PUT') {
      const v = validateItem(kind, await req.json().catch(() => undefined));
      if (!v.ok) throw new HttpError(400, v.error);
      if ((v.item as any).id !== id) throw new HttpError(400, `The item's id (${(v.item as any).id}) doesn't match the URL (${id})`);
      await env.DB.prepare('INSERT INTO content (kind, id, data, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(kind, id) DO UPDATE SET data = ?3, updated_at = ?4, updated_by = ?5')
        .bind(kind, id, JSON.stringify(v.item), now(), who.name).run();
      await audit(env, who.name, 'content.put', {kind, id});
      return json({ok: true, item: v.item});
    }
    if (method === 'DELETE') {
      const r = await env.DB.prepare('DELETE FROM content WHERE kind = ? AND id = ?').bind(kind, id).run();
      await audit(env, who.name, 'content.delete', {kind, id});
      return json({ok: true, removed: r.meta.changes ?? 0, note: 'Only the online item is removed; a default with this id stays (hide it with "disabled": true).'});
    }
  }

  // ---- voices
  if (path === '/voices' && method === 'GET') {
    const r = await env.DB.prepare('SELECT v.data, (SELECT COUNT(*) FROM voice_clips c WHERE c.voice = v.id) AS count FROM voices v WHERE v.disabled = 0 ORDER BY v.id').all<{data: string; count: number}>();
    return json({voices: r.results.map((x) => ({...JSON.parse(x.data), count: x.count}))});
  }
  if ((p = m(/^\/voices\/([a-z0-9-]+)$/))) {
    const id = p[1];
    const row = await env.DB.prepare('SELECT data, disabled, created_at FROM voices WHERE id = ?').bind(id).first<{data: string; disabled: number; created_at: string}>();
    if (method === 'GET') {
      if (!row || row.disabled) throw new HttpError(404, `No voice "${id}"`);
      const c = await env.DB.prepare('SELECT * FROM voice_clips WHERE voice = ? ORDER BY text').bind(id).all<any>();
      const clips = Object.fromEntries(c.results.map((x) => [x.key, {key: x.key, text: x.text, file: x.file, url: `${env.MEDIA_URL}/${x.file}`, duration: x.duration, bytes: x.bytes, addedAt: x.added_at, source: x.source, ...(x.check_json ? {check: JSON.parse(x.check_json)} : {})}]));
      return json({voice: JSON.parse(row.data), clips});
    }
    if (method === 'PUT') {
      const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const info = VoiceInfo.safeParse({...b, id, createdAt: row ? JSON.parse(row.data).createdAt : now()});
      if (!info.success) throw new HttpError(400, info.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '));
      await env.DB.prepare('INSERT INTO voices (id, data, disabled, created_at) VALUES (?1, ?2, 0, ?3) ON CONFLICT(id) DO UPDATE SET data = ?2, disabled = 0')
        .bind(id, JSON.stringify(info.data), info.data.createdAt).run();
      await audit(env, who.name, row ? 'voice.update' : 'voice.create', {id});
      return json({ok: true, voice: info.data, created: !row});
    }
    if (method === 'DELETE') {
      await env.DB.prepare('UPDATE voices SET disabled = 1 WHERE id = ?').bind(id).run();
      await audit(env, who.name, 'voice.hide', {id});
      return json({ok: true, note: 'Hidden. Its clips stay; PUT the voice again to bring it back.'});
    }
  }
  if ((p = m(/^\/voices\/([a-z0-9-]+)\/clips$/)) && method === 'PUT') {
    const voice = p[1];
    const v = await env.DB.prepare('SELECT disabled FROM voices WHERE id = ?').bind(voice).first<{disabled: number}>();
    if (!v || v.disabled) throw new HttpError(404, `No voice "${voice}" (create it first)`);
    const text = (url.searchParams.get('text') ?? '').trim();
    const duration = Number(url.searchParams.get('duration'));
    const source = url.searchParams.get('source') ?? 'uploaded';
    if (!text) throw new HttpError(400, 'text is required');
    if (!(duration > 0 && duration <= 20)) throw new HttpError(400, 'duration (seconds, ≤ 20) is required');
    const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = AUDIO_TYPES[type];
    if (!ext) throw new HttpError(415, `Send audio as one of: ${Object.keys(AUDIO_TYPES).join(', ')}`);
    const key = clipKey(text);
    const old = await env.DB.prepare('SELECT file FROM voice_clips WHERE voice = ? AND key = ?').bind(voice, key).first<{file: string}>();
    if (old && url.searchParams.get('replace') !== '1') return json({ok: true, key, skipped: true, note: 'Already there (replace=1 for a new take)'});
    const b = await bytesOf(req, MAX_AUDIO);
    const file = clipFile(voice, key, (await sha1(b)).slice(0, 8), ext);
    await env.MEDIA.put(file, b, {httpMetadata: {contentType: type, cacheControl: 'public, max-age=31536000, immutable'}});
    const clip = ClipInfo.parse({key, text, file, url: `${env.MEDIA_URL}/${file}`, duration: +duration.toFixed(3), bytes: b.byteLength, addedAt: now(), source});
    await env.DB.prepare(
      `INSERT INTO voice_clips (voice, key, text, file, duration, bytes, source, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(voice, key) DO UPDATE SET text = ?3, file = ?4, duration = ?5, bytes = ?6, source = ?7, added_at = ?8`,
    ).bind(voice, key, clip.text, file, clip.duration, clip.bytes, clip.source, clip.addedAt).run();
    await audit(env, who.name, old ? 'clip.replace' : 'clip.add', {voice, key, text});
    return json({ok: true, key, clip});
  }
  if ((p = m(/^\/voices\/([a-z0-9-]+)\/clips\/([0-9a-f]{14})$/)) && method === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM voice_clips WHERE voice = ? AND key = ?').bind(p[1], p[2]).run();
    await audit(env, who.name, 'clip.remove', {voice: p[1], key: p[2]});
    return json({ok: true, removed: r.meta.changes ?? 0});
  }

  // ---- music (private)
  if (path === '/music' && method === 'GET') {
    const r = await env.DB.prepare('SELECT name, bytes, licence, added_at FROM music ORDER BY name').all();
    return json({music: r.results});
  }
  if ((p = m(/^\/music\/([a-z0-9-]+)$/)) && method === 'PUT') {
    const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = AUDIO_TYPES[type];
    if (!ext) throw new HttpError(415, `Send audio as one of: ${Object.keys(AUDIO_TYPES).join(', ')}`);
    const b = await bytesOf(req, MAX_VIDEO);
    const file = `music/${p[1]}.${ext}`;
    await env.PRIVATE.put(file, b, {httpMetadata: {contentType: type}});
    const licence = url.searchParams.get('licence');
    await env.DB.prepare('INSERT INTO music (name, file, bytes, licence, added_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(name) DO UPDATE SET file = ?2, bytes = ?3, licence = COALESCE(?4, licence), added_at = ?5')
      .bind(p[1], file, b.byteLength, licence, now()).run();
    await audit(env, who.name, 'music.put', {name: p[1], bytes: b.byteLength});
    return json({ok: true, name: p[1], bytes: b.byteLength});
  }
  if ((p = m(/^\/music\/([a-z0-9-]+)\/audio$/)) && method === 'GET') {
    const row = await env.DB.prepare('SELECT file FROM music WHERE name = ?').bind(p[1]).first<{file: string}>();
    const obj = row && (await env.PRIVATE.get(row.file));
    if (!obj) throw new HttpError(404, `No music "${p[1]}"`);
    return new Response(obj.body, {headers: {'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600'}});
  }

  if (path === '/audit' && method === 'GET') {
    const r = await env.DB.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').bind(Math.min(500, Number(url.searchParams.get('limit') ?? 50))).all();
    return json({audit: r.results});
  }
  throw new HttpError(404, `No route ${method} ${path}`);
}

async function onlineContent(env: Env) {
  const r = await env.DB.prepare('SELECT kind, data FROM content ORDER BY kind, id').all<{kind: string; data: string}>();
  const out = Object.fromEntries(KINDS.map((k) => [k, [] as unknown[]])) as Record<ContentKind, unknown[]>;
  for (const x of r.results) if ((KINDS as string[]).includes(x.kind)) out[x.kind as ContentKind].push(JSON.parse(x.data));
  return out;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return cors(req, env, new Response(null, {status: 204}));
    const path = new URL(req.url).pathname;
    if (path === '/health') return cors(req, env, json({ok: true, service: 'locato-promo', time: now(), channels: SERVICES}));
    try {
      const who = await authenticate(req, env);
      if (!who) throw new HttpError(401, 'Not signed in (service token or admin token required)');
      return cors(req, env, await route(req, env, who));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return cors(req, env, json({error: (e as Error).message}, status));
    }
  },
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runPosting(env, 'cron'));
  },
} satisfies ExportedHandler<Env>;
