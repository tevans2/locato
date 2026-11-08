// The posting step: queue → Buffer. Runs inside the promo Worker (on its timer, or POST /tick), over the videos in D1.
// Plain TypeScript with fetch only. Each video entry carries everything Buffer needs: the video URL, the time it should
// go out, and the finished post for every channel. Each run:
//   1. finds entries with a channel that isn't scheduled yet (and not on hold)
//   2. counts what's already scheduled per channel (Buffer free plan: 10 max)
//   3. schedules entries in time order until a channel's queue is full; an entry whose time has passed gets the
//      next free slot instead, so nothing is lost if the queue was full for a while
//   4. writes the Buffer post IDs (or the error) back into the entry
//   5. once every channel's time has passed, asks Buffer how each post went: sent posts get their live link and
//      time, and a fully posted entry is marked posted (Store.move). Nothing is deleted: the video file stays where
//      it is (its link keeps working), and the record stays.
// It makes no Buffer requests at all when nothing is waiting or due for a check.

export type Service = 'tiktok' | 'instagram' | 'youtube';
export const SERVICES: Service[] = ['tiktok', 'instagram', 'youtube'];
export const QUEUE_MAX = 10;
/** Storage-neutral names the step passes to Store (the D1 store ignores them and uses the video name). */
export const PREFIX = 'queue/';
export const DONE_PREFIX = 'queue-done/';

export type Entry = {
  name: string;
  video: string; // public https URL
  dueAt: string; // ISO UTC
  hold?: boolean;
  stagedAt: string;
  /** createPost input per channel, minus channelId / dueAt / mode */
  posts: Partial<Record<Service, {text: string; metadata: unknown; assets: unknown}>>;
  published?: Partial<Record<Service, {postId: string; dueAt: string; status?: 'sent' | 'error' | 'missing'; sentAt?: string; link?: string}>>;
  /** Set when every channel has gone out (status "posted"). */
  postedAt?: string;
  errors?: Partial<Record<Service, string>>;
  log?: string[];
};

export interface Store {
  list(): Promise<string[]>; // keys under PREFIX
  get(key: string): Promise<Entry | null>;
  put(key: string, e: Entry): Promise<void>;
  /** Mark the entry finished (D1: status "posted"; the record and the video file are kept). */
  move(from: string, to: string, e: Entry): Promise<void>;
}

export type Config = {apiKey: string; timeZone: string; times: string[]; now?: Date; dryRun?: boolean; log?: (s: string) => void};

// ---- Buffer -----------------------------------------------------------------------------------------------
export async function gql<T = any>(apiKey: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({query, variables}),
  });
  if (r.status === 429) throw new Error('Buffer rate limit reached; the next run will retry');
  const d = (await r.json()) as any;
  if (d.errors?.length) throw new Error(d.errors.map((e: any) => e.message).join('; '));
  return d.data;
}

export async function bufferChannels(apiKey: string) {
  const {account} = await gql(apiKey, `{ account { organizations { id } } }`);
  const org: string = account.organizations[0]?.id;
  const {channels} = await gql(apiKey, `query($o: OrganizationId!) { channels(input: {organizationId: $o}) { id service name } }`, {o: org});
  return {org, channels: channels as {id: string; service: string; name: string}[]};
}

export async function bufferScheduled(apiKey: string, org: string, channelId: string) {
  const {posts} = await gql(
    apiKey,
    `query($o: OrganizationId!, $c: [ChannelId!]!) { posts(first: 50, input: {organizationId: $o, filter: {channelIds: $c, status: [scheduled]}}) { edges { node { id dueAt } } } }`,
    {o: org, c: [channelId]},
  );
  return (posts.edges as any[]).map((e) => e.node as {id: string; dueAt: string});
}

// ---- time ---------------------------------------------------------------------------------------------------
/** Offset (ms) of a time zone from UTC at a given moment. */
function tzOffset(timeZone: string, at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'})
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at.getTime() / 1000) * 1000;
}
/** "2026-11-09" + "19:00" in timeZone → UTC ISO */
export function localToUtc(date: string, hhmm: string, timeZone: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const naive = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m);
  return new Date(naive - tzOffset(timeZone, new Date(naive))).toISOString();
}
export const localDate = (d: Date, timeZone: string) => d.toLocaleDateString('en-CA', {timeZone});
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Every slot (times[] each day) after `from`, in order. */
export function* slotsAfter(from: Date, times: string[], timeZone: string) {
  for (let day = localDate(from, timeZone), i = 0; i < 400; i++, day = addDays(day, 1))
    for (const t of times) {
      const iso = localToUtc(day, t, timeZone);
      if (Date.parse(iso) > from.getTime()) yield iso;
    }
}

// ---- the run --------------------------------------------------------------------------------------------------
export async function fill(store: Store, cfg: Config) {
  const now = cfg.now ?? new Date();
  const log = cfg.log ?? console.log;
  const entries = (await Promise.all((await store.list()).map(async (k) => [k, await store.get(k)] as const))).filter((x): x is [string, Entry] => !!x[1]);
  const missing = (e: Entry) => (Object.keys(e.posts) as Service[]).filter((s) => !e.published?.[s]);
  const pending = entries.filter(([, e]) => !e.hold && missing(e).length).sort((a, b) => a[1].dueAt.localeCompare(b[1].dueAt));
  // in Buffer on every channel and past their time (+10 min for Buffer to send): ask how it went
  const toCheck = entries.filter(([, e]) => !missing(e).length && Object.values(e.published ?? {}).some((p) => !p!.status || p!.status === 'missing') && Object.values(e.published ?? {}).every((p) => Date.parse(p!.dueAt) < now.getTime() - 10 * 60e3));
  let posted = 0;
  for (const [key, e] of toCheck) {
    for (const [s, p] of Object.entries(e.published ?? {}) as [Service, NonNullable<Entry['published']>[Service]][]) {
      if (p!.status === 'sent' || p!.status === 'error') continue;
      try {
        const {post} = await gql(cfg.apiKey, `query($i: PostId!) { post(input: {id: $i}) { id status sentAt externalLink error { message } } }`, {i: p!.postId});
        if (!post) p!.status = 'missing';
        else if (post.status === 'sent') Object.assign(p!, {status: 'sent', sentAt: post.sentAt ?? undefined, link: post.externalLink ?? undefined});
        else if (post.status === 'error') (p!.status = 'error'), ((e.errors ??= {})[s] = post.error?.message ?? 'Buffer reported an error');
        // scheduled / sending: not yet; check again next run
      } catch (err) {
        if (/not found|does not exist/i.test(String(err))) p!.status = 'missing';
        else throw err;
      }
    }
    const ps = Object.values(e.published ?? {});
    if (ps.length && ps.every((p) => p!.status === 'sent')) {
      e.postedAt = ps.map((p) => p!.sentAt ?? p!.dueAt).sort().at(-1);
      (e.log ??= []).push(`${now.toISOString()} posted on every channel; moved to ${DONE_PREFIX}`);
      if (!cfg.dryRun) await store.move(key, `${DONE_PREFIX}${e.name}.json`, e);
      posted++;
      log(`✓ ${e.name} posted: ${Object.entries(e.published ?? {}).map(([s, p]) => `${s} ${p!.link ?? ''}`).join(' · ')}`);
    } else {
      const bad = Object.entries(e.published ?? {}).filter(([, p]) => p!.status === 'error' || p!.status === 'missing');
      if (bad.length) log(`⚠ ${e.name}: ${bad.map(([s, p]) => `${s} ${p!.status}`).join(', ')} (see npm run queue; it stays in the queue)`);
      if (!cfg.dryRun) await store.put(key, e);
    }
  }
  if (!pending.length) {
    log(posted ? `Moved ${posted} posted video(s) to ${DONE_PREFIX}. Nothing waiting.` : 'Nothing waiting.');
    return {scheduled: 0, waiting: 0, posted};
  }

  const {org, channels} = await bufferChannels(cfg.apiKey);
  const chan: Partial<Record<Service, string>> = {};
  const room: Partial<Record<Service, number>> = {};
  const taken = new Set<number>(); // slot times already used on any channel
  for (const c of channels) {
    if (!SERVICES.includes(c.service as Service)) continue;
    const s = c.service as Service;
    chan[s] = c.id;
    const q = await bufferScheduled(cfg.apiKey, org, c.id);
    room[s] = QUEUE_MAX - q.length;
    q.forEach((p) => taken.add(Date.parse(p.dueAt)));
  }
  for (const [, e] of entries) if (e.hold || missing(e).length) taken.add(Date.parse(e.dueAt));

  let scheduled = 0;
  const soon = now.getTime() + 5 * 60e3; // Buffer needs the time to be in the future
  for (const [key, e] of pending) {
    const todo = missing(e).filter((s) => chan[s] && (room[s] ?? 0) > 0);
    if (!todo.length) continue;
    let due = e.dueAt;
    if (Date.parse(due) < soon && !Object.keys(e.published ?? {}).length) {
      // its time passed while it waited (queue was full): move it to the next free slot
      for (const s of slotsAfter(new Date(soon), cfg.times, cfg.timeZone))
        if (!taken.has(Date.parse(s))) { due = s; break; }
      taken.add(Date.parse(due));
      (e.log ??= []).push(`${now.toISOString()} moved from ${e.dueAt} to ${due} (original time had passed)`);
      e.dueAt = due;
    } else if (Date.parse(due) < soon) {
      due = new Date(soon).toISOString(); // other channels already went out: finish this one asap
    }
    for (const s of todo) {
      if (cfg.dryRun) {
        log(`would schedule ${e.name} → ${s} at ${due}`);
        room[s]!--;
        continue;
      }
      try {
        const res = await gql(
          cfg.apiKey,
          `mutation($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } } }`,
          {input: {...e.posts[s], channelId: chan[s], schedulingType: 'automatic', mode: 'customScheduled', dueAt: due}},
        );
        const out = res.createPost;
        if (out.__typename !== 'PostActionSuccess') throw new Error(out.message ?? out.__typename);
        (e.published ??= {})[s] = {postId: out.post.id, dueAt: out.post.dueAt};
        if (e.errors) delete e.errors[s];
        room[s]!--;
        scheduled++;
        log(`✓ ${e.name} → ${s} at ${out.post.dueAt}`);
      } catch (err) {
        (e.errors ??= {})[s] = String((err as Error).message ?? err);
        log(`✗ ${e.name} → ${s}: ${e.errors[s]}`);
        if (/rate limit/i.test(String(err))) {
          await store.put(key, e);
          return {scheduled, waiting: pending.length, posted, stopped: 'rate limit'};
        }
      }
    }
    if (!cfg.dryRun) await store.put(key, e);
  }
  const waiting = pending.filter(([, e]) => missing(e).length).length;
  log(`Scheduled ${scheduled}. Still waiting: ${waiting}.${posted ? ` Moved ${posted} posted video(s) to ${DONE_PREFIX}.` : ''}`);
  return {scheduled, waiting, posted};
}
