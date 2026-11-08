// D1 access for the promo service.
import type {Entry, Store} from '../../tools/locato/autopost';

export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  PRIVATE: R2Bucket;
  TIMEZONE: string;
  TIMES: string;
  MEDIA_URL: string;
  ADMIN_ORIGINS: string;
  BUFFER_API_KEY?: string;
  PROMO_SERVICE_TOKEN?: string;
  PROMO_ADMIN_SECRET?: string;
};

export const now = () => new Date().toISOString();

/** A queue entry, plus what the API keeps alongside it. */
export type VideoEntry = Entry & {ref?: string; meta?: Record<string, unknown>; removed?: boolean};

/** Status for listing: posted / removed / problem (a channel failed or vanished) / scheduled (in Buffer on every channel) / queued. */
export function statusOf(e: VideoEntry) {
  if (e.removed) return 'removed';
  if (e.postedAt) return 'posted';
  const pub = Object.values(e.published ?? {});
  if ((e.errors && Object.keys(e.errors).length) || pub.some((p) => p?.status === 'error' || p?.status === 'missing')) return 'problem';
  return Object.keys(e.posts).every((s) => (e.published as any)?.[s]) ? 'scheduled' : 'queued';
}

export async function getEntry(env: Env, name: string): Promise<VideoEntry | null> {
  const row = await env.DB.prepare('SELECT entry FROM videos WHERE name = ?').bind(name).first<{entry: string}>();
  return row ? JSON.parse(row.entry) : null;
}

export async function putEntry(env: Env, e: VideoEntry) {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO videos (name, status, due_at, hold, video_url, ref, meta, entry, staged_at, posted_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(name) DO UPDATE SET status = ?2, due_at = ?3, hold = ?4, video_url = ?5, ref = ?6, meta = ?7, entry = ?8, posted_at = ?10, updated_at = ?11`,
  )
    .bind(e.name, statusOf(e), e.dueAt, e.hold ? 1 : 0, e.video, e.ref ?? null, e.meta ? JSON.stringify(e.meta) : null, JSON.stringify(e), e.stagedAt, e.postedAt ?? null, t)
    .run();
}

/** The posting step's storage: active videos only. "Moving" a posted video just changes its status; nothing is deleted. */
export const d1Store = (env: Env): Store => ({
  async list() {
    const r = await env.DB.prepare("SELECT name FROM videos WHERE status IN ('queued', 'scheduled', 'problem') ORDER BY due_at").all<{name: string}>();
    return r.results.map((x) => x.name);
  },
  get: (name) => getEntry(env, name),
  put: (_name, e) => putEntry(env, e),
  move: (_from, _to, e) => putEntry(env, e),
});

export async function audit(env: Env, who: string, action: string, details?: unknown) {
  await env.DB.prepare('INSERT INTO audit (at, who, action, details) VALUES (?, ?, ?, ?)').bind(now(), who, action, details === undefined ? null : JSON.stringify(details)).run();
}
