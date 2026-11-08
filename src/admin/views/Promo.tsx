import { useCallback, useMemo, useRef, useState } from "react";
import type { AdminClient, GrowthReport } from "../api";
import { formatBytes, formatDateTime, formatNumber } from "../format";
import { Badge, Empty, ErrorNote, Loading, Panel, useResource } from "../ui";
import type { ActionHelpers } from "./Users";

// The promo pipeline (videos, posting, content, voices, music) runs as its own service (promo/worker on Cloudflare),
// separate from the game. This tab talks to it straight from the browser with a short-lived token the game's admin
// API signs for the signed-in admin; the game server never calls the promo service.

type CallOptions = { readonly json?: unknown; readonly body?: Blob; readonly contentType?: string; readonly onProgress?: (fraction: number) => void };
type PromoCall = <T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options?: CallOptions) => Promise<T>;
type PromoSession = { readonly token: string; readonly expiresAt: number; readonly apiUrl: string };

type Channel = "tiktok" | "instagram" | "youtube";
const CHANNELS: readonly Channel[] = ["tiktok", "instagram", "youtube"];
interface Published { readonly postId: string; readonly dueAt: string; readonly status?: "sent" | "error" | "missing"; readonly sentAt?: string; readonly link?: string }
interface VideoRow {
  readonly name: string;
  readonly status: "queued" | "scheduled" | "posted" | "problem" | "removed";
  readonly dueAt: string;
  readonly hold: boolean;
  readonly video: string;
  readonly ref: string | null;
  readonly meta: Record<string, unknown> | null;
  readonly postedAt: string | null;
  readonly channels: readonly string[];
  readonly published: Partial<Record<Channel, Published>>;
  readonly errors: Partial<Record<Channel, string>>;
}
type Kind = "phrases" | "lists" | "presets" | "plans";
const KINDS: readonly Kind[] = ["phrases", "lists", "presets", "plans"];
type ContentItem = { readonly id: string } & Record<string, unknown>;
type MergedContent = Record<Kind, readonly ContentItem[]> & { readonly sources: Record<string, string>; readonly problems: readonly string[] };
interface Voice { readonly id: string; readonly name: string; readonly engine: string; readonly count: number }
interface Clip { readonly key: string; readonly text: string; readonly url?: string; readonly duration: number; readonly source: string; readonly addedAt: string }
interface Music { readonly name: string; readonly bytes: number; readonly licence: string | null; readonly added_at: string }
interface Run { readonly id: number; readonly at: string; readonly trigger: string; readonly scheduled: number; readonly posted: number; readonly log: string; readonly error: string | null }

const TABS = ["queue", "posted", "content", "voices", "music", "runs"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { queue: "Queue", posted: "Posted", content: "Content", voices: "Voices", music: "Music", runs: "Runs" };

const when = (iso: string | null) => (iso ? formatDateTime(Date.parse(iso)) : "—");
const failed = (helpers: ActionHelpers, err: unknown) => helpers.notify(err instanceof Error ? err.message : String(err), "bad");

function usePromo(client: AdminClient): PromoCall {
  const session = useRef<PromoSession | null>(null);
  return useCallback(
    async <T,>(method: string, path: string, options: CallOptions = {}): Promise<T> => {
      if (!session.current || session.current.expiresAt - Date.now() < 60_000) session.current = await client.send<PromoSession>("POST", "/promo-token");
      const { token, apiUrl } = session.current;
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      let body: BodyInit | undefined = options.body;
      if (options.json !== undefined) {
        body = JSON.stringify(options.json);
        headers["content-type"] = "application/json";
      } else if (options.contentType) headers["content-type"] = options.contentType;
      if (options.onProgress && body instanceof Blob) {
        // uploads report progress (fetch can't): useful for big videos on a phone connection
        const onProgress = options.onProgress;
        return await new Promise<T>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(method, `${apiUrl}${path}`);
          for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
          xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
          xhr.onload = () => {
            let data: { error?: string } = {};
            try { data = JSON.parse(xhr.responseText) as { error?: string }; } catch { /* not JSON */ }
            if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
            else reject(new Error(data.error ?? `Promo service: ${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error("Upload failed (network)."));
          xhr.send(body);
        });
      }
      const response = await fetch(`${apiUrl}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
      if (path.endsWith("/audio")) {
        if (!response.ok) throw new Error(`Promo service: ${response.status}`);
        return (await response.blob()) as T;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `Promo service: ${response.status}`);
      return data as T;
    },
    [client],
  ) as PromoCall;
}

export function PromoView({ client, helpers }: { client: AdminClient; helpers: ActionHelpers }) {
  const call = usePromo(client);
  const [tab, setTab] = useState<Tab>("queue");
  const [running, setRunning] = useState(false);

  async function runNow() {
    setRunning(true);
    try {
      const r = await call<{ log: readonly string[]; error: string | null }>("POST", "/tick");
      if (r.error) helpers.notify(`Posting step: ${r.error}`, "bad");
      else helpers.notify(r.log.at(-1) ?? "Done.");
    } catch (err) {
      failed(helpers, err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="adm-stack">
      <div className="adm-chips" role="group" aria-label="Promo section">
        {TABS.map((t) => <button key={t} type="button" className="adm-chip-btn" aria-pressed={t === tab} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>)}
        <button type="button" className="adm-btn is-small" disabled={running} onClick={() => void runNow()} title="Top up Buffer and record what was posted (the service also does this every 4 hours)">{running ? "Running…" : "Run posting now"}</button>
      </div>
      {tab === "queue" && <QueueTab call={call} helpers={helpers} />}
      {tab === "posted" && <PostedTab call={call} client={client} />}
      {tab === "content" && <ContentTab call={call} helpers={helpers} />}
      {tab === "voices" && <VoicesTab call={call} helpers={helpers} />}
      {tab === "music" && <MusicTab call={call} helpers={helpers} />}
      {tab === "runs" && <RunsTab call={call} />}
    </div>
  );
}

// ---- queue ------------------------------------------------------------------------------------------------------------
function channelBadge(row: VideoRow, channel: Channel) {
  if (!row.channels.includes(channel)) return null;
  const p = row.published[channel];
  const err = row.errors[channel];
  if (err || p?.status === "error") return <Badge key={channel} tone="bad" title={err ?? "Buffer reported an error"}>{channel}</Badge>;
  if (p?.status === "missing") return <Badge key={channel} tone="bad" title="Post not found in Buffer (deleted?)">{channel}</Badge>;
  if (p?.status === "sent") return <Badge key={channel} tone="good" title={p.link ?? "sent"}>{channel}</Badge>;
  if (p) return <Badge key={channel} tone="brand" title={`In Buffer for ${when(p.dueAt)}`}>{channel}</Badge>;
  return <Badge key={channel} title="Waiting for room in Buffer">{channel}</Badge>;
}

function QueueTab({ call, helpers }: { call: PromoCall; helpers: ActionHelpers }) {
  const queue = useResource(() => call<{ videos: readonly VideoRow[] }>("GET", "/queue?status=active"), [call], 60_000);
  const [uploading, setUploading] = useState(false);

  async function setHold(row: VideoRow, hold: boolean) {
    try {
      await call("PATCH", `/queue/${row.name}`, { json: { hold } });
      helpers.notify(`${row.name}: ${hold ? "on hold" : "released"}.`);
      queue.refresh();
    } catch (err) {
      failed(helpers, err);
    }
  }
  function remove(row: VideoRow) {
    helpers.confirm({
      title: `Take ${row.name} out of the queue?`,
      body: <p>Its posts that haven't gone out yet are deleted from Buffer. The video and its record stay, marked removed.</p>,
      confirmLabel: "Remove",
      tone: "danger",
      run: async () => {
        await call("DELETE", `/queue/${row.name}`);
        helpers.notify(`${row.name} removed.`);
        queue.refresh();
      },
    });
  }

  const rows = queue.data?.videos;
  return (
    <div className="adm-stack">
    {uploading && <UploadVideo call={call} helpers={helpers} onDone={() => { setUploading(false); queue.refresh(); }} onCancel={() => setUploading(false)} />}
    <Panel
      title="Queue"
      subtitle="Staged videos. The promo service moves them into Buffer as room frees up (10 per channel on the free plan)."
      actions={!uploading && <button type="button" className="adm-btn is-small is-primary" onClick={() => setUploading(true)}>Upload a video</button>}
      flush
    >
      {queue.error && <ErrorNote message={queue.error} onRetry={queue.refresh} />}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>Nothing queued. Stage a batch from the Mac: npm run stage -- videos/&lt;week&gt;-*.json</Empty> : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Goes out</th><th>Video</th><th>Status</th><th>Channels</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td>{when(row.dueAt)}</td>
                  <td><a href={row.video} target="_blank" rel="noreferrer" style={{ color: "inherit" }} title="Open the video"><strong>{row.name}</strong></a></td>
                  <td>{row.hold ? <Badge tone="warn">on hold</Badge> : <Badge tone={row.status === "problem" ? "bad" : row.status === "scheduled" ? "brand" : "neutral"}>{row.status}</Badge>}</td>
                  <td><span className="adm-chips">{CHANNELS.map((c) => channelBadge(row, c))}</span></td>
                  <td className="num">
                    <button type="button" className="adm-btn is-small" onClick={() => void setHold(row, !row.hold)}>{row.hold ? "Release" : "Hold"}</button>{" "}
                    <button type="button" className="adm-btn is-small is-danger" onClick={() => remove(row)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
    </div>
  );
}

// ---- upload a finished video ---------------------------------------------------------------------------------------
// The same rules as the Mac's `npm run stage -- --video` (promo/src/content/posts.ts); the game doesn't import promo code.
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const videoSlug = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "video";
interface VideoInfo { readonly width: number; readonly height: number; readonly duration: number; readonly bytes: number }
function videoChecks(v: VideoInfo): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  if (v.bytes > MAX_VIDEO_BYTES) errors.push(`${(v.bytes / 1048576).toFixed(1)} MB is over the 60 MB upload limit (export at a lower bitrate).`);
  if (!(v.duration > 0)) errors.push("Couldn't read the video's length.");
  else if (v.duration > 600) errors.push(`${Math.round(v.duration)}s is too long (max 10 minutes).`);
  else {
    if (v.duration > 180) warnings.push("Over 3 minutes: YouTube may post it as a regular video, not a Short.");
    if (v.duration > 90) warnings.push("Over 90 seconds: Instagram may not show the Reel everywhere.");
  }
  if (v.width && v.height) {
    if (v.width > v.height) errors.push(`${v.width}×${v.height} is landscape; Shorts, Reels and TikTok need portrait (9:16).`);
    else if (Math.abs(v.width / v.height - 9 / 16) > 0.03) warnings.push(`${v.width}×${v.height} isn't 9:16, so platforms will crop or add bars.`);
    if (v.height < 1280) warnings.push(`${v.width}×${v.height} is low resolution (1080×1920 is best).`);
  }
  return { errors, warnings };
}
const readVideo = (file: File) =>
  new Promise<VideoInfo>((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, bytes: file.size }); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve({ width: 0, height: 0, duration: 0, bytes: file.size }); };
    v.src = url;
  });

function UploadVideo({ call, helpers, onDone, onCancel }: { call: PromoCall; helpers: ActionHelpers; onDone: () => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [name, setName] = useState("");
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [channels, setChannels] = useState<readonly Channel[]>(CHANNELS);
  const [when, setWhen] = useState<"next" | "at">("next");
  const [at, setAt] = useState("");
  const [hold, setHold] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const checks = info ? videoChecks(info) : null;

  async function pick(f: File | null) {
    setFile(f);
    setInfo(null);
    if (!f) return;
    setName(videoSlug(f.name));
    setInfo(await readVideo(f));
  }
  async function submit() {
    if (!file || !checks || checks.errors.length || !caption.trim() || !name || !channels.length) return;
    try {
      const existing = await call<{ status: string }>("GET", `/queue/${name}`).catch(() => null);
      if (existing && existing.status !== "removed") throw new Error(`"${name}" is already in the queue (${existing.status}). Pick another name.`);
      setProgress(0);
      const up = await call<{ url: string }>("PUT", `/media/videos/${name}`, { body: file, contentType: "video/mp4", onProgress: setProgress });
      const r = await call<{ dueAt: string; channels: readonly string[] }>("POST", "/queue/upload", {
        json: { name, video: up.url, caption: caption.trim(), ...(title.trim() ? { title: title.trim() } : {}), channels, ...(when === "at" && at ? { dueAt: new Date(at).toISOString() } : {}), ...(hold ? { hold: true } : {}), meta: { file: file.name } },
      });
      helpers.notify(`Queued ${name} for ${formatDateTime(Date.parse(r.dueAt))} on ${r.channels.join(", ")}.`);
      onDone();
    } catch (err) {
      failed(helpers, err);
      setProgress(null);
    }
  }

  const busy = progress !== null;
  return (
    <Panel title="Upload a video" subtitle="Any finished portrait video (made by hand, CapCut, a screen recording…). It's queued and posted like the rendered ones.">
      <div className="adm-stack">
        <label className="adm-field">
          <span>Video file (.mp4)</span>
          <input type="file" accept="video/mp4,video/quicktime" onChange={(e) => void pick(e.target.files?.[0] ?? null)} disabled={busy} />
        </label>
        {info && checks && (
          <div className="adm-small">
            <span className="adm-muted">{info.width}×{info.height} · {info.duration.toFixed(1)}s · {formatBytes(info.bytes)}</span>
            {checks.errors.map((e) => <div key={e}><Badge tone="bad">can't post</Badge> {e}</div>)}
            {checks.warnings.map((w) => <div key={w}><Badge tone="warn">check</Badge> {w}</div>)}
          </div>
        )}
        <label className="adm-field">
          <span>Name (used in its link: locato.quest/?ref={name.replace(/[^a-z0-9]+/g, "").slice(0, 24) || "…"})</span>
          <input value={name} onChange={(e) => setName(videoSlug(e.target.value))} disabled={busy} />
        </label>
        <label className="adm-field">
          <span>Caption (TikTok and Instagram; a question and 3 hashtags work best)</span>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} maxLength={2000} disabled={busy} style={{ font: "inherit", width: "100%" }} placeholder="How many countries can you name on this road trip? 👇 #geography #maps #quiz" />
        </label>
        <label className="adm-field">
          <span>YouTube title (optional: defaults to the caption without hashtags)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} disabled={busy} />
        </label>
        <div className="adm-chips" role="group" aria-label="Channels">
          {CHANNELS.map((c) => (
            <button key={c} type="button" className="adm-chip-btn" aria-pressed={channels.includes(c)} disabled={busy} onClick={() => setChannels(channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c])}>{c}</button>
          ))}
        </div>
        <div className="adm-inline-form">
          <select value={when} onChange={(e) => setWhen(e.target.value as "next" | "at")} aria-label="When" disabled={busy}>
            <option value="next">Next free posting slot</option>
            <option value="at">At a set time…</option>
          </select>
          {when === "at" && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} aria-label="Post at" disabled={busy} />}
          <label><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} disabled={busy} /> Hold (don't post until released)</label>
        </div>
        <div className="adm-actions">
          <button type="button" className="adm-btn is-primary" disabled={busy || !file || !checks || checks.errors.length > 0 || !caption.trim() || !name || !channels.length || (when === "at" && !at)} onClick={() => void submit()}>
            {busy ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : "Upload and queue"}
          </button>
          <button type="button" className="adm-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </Panel>
  );
}

// ---- posted + results -------------------------------------------------------------------------------------------------
function PostedTab({ call, client }: { call: PromoCall; client: AdminClient }) {
  const posted = useResource(() => call<{ videos: readonly VideoRow[] }>("GET", "/queue?status=posted&limit=200"), [call]);
  // Visits come from the game's own analytics (each video's link carries ?ref=<name>); matched here, in the browser.
  const growth = useResource(() => client.get<GrowthReport>("/growth?days=90"), [client]);
  const bySource = useMemo(() => new Map((growth.data?.sources ?? []).map((s) => [s.source, s])), [growth.data]);
  const rows = posted.data?.videos;
  return (
    <Panel title="Posted" subtitle="What went out, with live links, and what each video brought in (visitors from its ?ref= link, last 90 days)." flush>
      {posted.error && <ErrorNote message={posted.error} onRetry={posted.refresh} />}
      {growth.error && <p className="adm-muted adm-small">Visits unavailable: {growth.error}</p>}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>No posted videos yet.</Empty> : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Posted</th><th>Video</th><th>Format</th><th className="num">Visitors</th><th className="num">Played</th><th className="num">Sign-ups</th><th>Links</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const s = row.ref ? bySource.get(row.ref) : undefined;
                const meta = row.meta ?? {};
                return (
                  <tr key={row.name}>
                    <td>{when(row.postedAt)}</td>
                    <td><strong>{row.name}</strong>{row.ref && <div className="adm-muted adm-small">ref={row.ref}</div>}</td>
                    <td className="adm-muted">{meta.format === "manual" ? `manual${typeof meta.file === "string" ? ` · ${meta.file}` : ""}` : [meta.kind, meta.mode, meta.hook].filter((x) => typeof x === "string").join(" · ") || "—"}</td>
                    <td className="num">{s ? formatNumber(s.visitors) : "—"}</td>
                    <td className="num">{s ? formatNumber(s.played) : "—"}</td>
                    <td className="num">{s ? formatNumber(s.signups) : "—"}</td>
                    <td>{CHANNELS.map((c) => { const p = row.published[c]; return p?.link ? <a key={c} href={p.link} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{c}</a> : null; })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---- content ----------------------------------------------------------------------------------------------------------
const TEMPLATES: Record<Kind, object> = {
  phrases: { id: "hook.my-hook", slot: "hook", text: "Can you get {n}/{n}?", suits: { format: ["quiz"] } },
  lists: { id: "my-list", name: "My list", codes: ["KE", "BR", "JP"] },
  presets: { id: "my-preset", name: "My preset", recipe: { format: "quiz", modes: ["flag"], count: 5 } },
  plans: { id: "my-plan", name: "My plan", days: [[{ preset: "my-preset" }]] },
};
const summary = (kind: Kind, item: ContentItem) =>
  kind === "phrases" ? `${String(item.slot)} · ${JSON.stringify(item.text)}` : kind === "lists" ? `${String(item.name)} · ${Array.isArray(item.codes) ? item.codes.length : 0} countries` : String(item.name ?? "");

function ContentTab({ call, helpers }: { call: PromoCall; helpers: ActionHelpers }) {
  const content = useResource(() => call<MergedContent>("GET", "/content"), [call]);
  const [kind, setKind] = useState<Kind>("phrases");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const data = content.data;

  async function save() {
    if (draft === null) return;
    let item: ContentItem;
    try {
      item = JSON.parse(draft) as ContentItem;
    } catch {
      helpers.notify("That isn't valid JSON.", "bad");
      return;
    }
    setBusy(true);
    try {
      await call("PUT", `/content/${kind}/${encodeURIComponent(item.id)}`, { json: item });
      helpers.notify(`Saved ${kind} "${item.id}".`);
      setDraft(null);
      content.refresh();
    } catch (err) {
      failed(helpers, err);
    } finally {
      setBusy(false);
    }
  }
  function removeOnline(id: string) {
    helpers.confirm({
      title: `Remove the online ${kind} "${id}"?`,
      body: <p>Only the online version is removed. If a default with this id exists, it comes back.</p>,
      confirmLabel: "Remove",
      tone: "danger",
      run: async () => {
        await call("DELETE", `/content/${kind}/${encodeURIComponent(id)}`);
        helpers.notify(`Removed "${id}".`);
        content.refresh();
      },
    });
  }

  return (
    <div className="adm-stack">
      <Panel
        title="Content"
        subtitle="Defaults come from the repo; anything saved here is added online (same id = it replaces the default; &quot;disabled&quot;: true hides one). The Mac tools pick it up with npm run content -- pull."
        actions={<button type="button" className="adm-btn is-small is-primary" onClick={() => setDraft(JSON.stringify(TEMPLATES[kind], null, 2))}>New {kind.slice(0, -1)}</button>}
        flush
      >
        <div className="adm-chips" role="group" aria-label="Content kind" style={{ padding: "12px 16px 0" }}>
          {KINDS.map((k) => <button key={k} type="button" className="adm-chip-btn" aria-pressed={k === kind} onClick={() => { setKind(k); setDraft(null); }}>{k} {data ? `(${data[k].length})` : ""}</button>)}
        </div>
        {content.error && <ErrorNote message={content.error} onRetry={content.refresh} />}
        {!data ? <Loading /> : data[kind].length === 0 ? <Empty>No {kind} yet.</Empty> : (
          <div className="adm-table-wrap">
            <table className="adm-table is-clickable">
              <thead><tr><th>Id</th><th>Source</th><th>What</th><th /></tr></thead>
              <tbody>
                {data[kind].map((item) => {
                  const source = data.sources[`${kind}:${item.id}`] ?? "default";
                  return (
                    <tr key={item.id} onClick={() => setDraft(JSON.stringify(item, null, 2))}>
                      <td><code>{item.id}</code></td>
                      <td><Badge tone={source === "default" ? "neutral" : "brand"}>{source}</Badge></td>
                      <td className="adm-muted">{summary(kind, item)}</td>
                      <td className="num">{source !== "default" && <button type="button" className="adm-btn is-small is-danger" onClick={(e) => { e.stopPropagation(); removeOnline(item.id); }}>Remove online</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {draft !== null && (
        <Panel title={`Edit ${kind.slice(0, -1)}`} subtitle="Saving checks it against the schema first. Saving a default's id makes an online copy that replaces it.">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} aria-label="Item JSON" style={{ width: "100%", minHeight: 260, fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
          <div className="adm-actions" style={{ marginTop: 12 }}>
            <button type="button" className="adm-btn is-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save online"}</button>
            <button type="button" className="adm-btn" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---- voices -----------------------------------------------------------------------------------------------------------
const audioDuration = (file: File) =>
  new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(audio.duration); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that audio file.")); };
    audio.src = url;
  });

function VoicesTab({ call, helpers }: { call: PromoCall; helpers: ActionHelpers }) {
  const voices = useResource(() => call<{ voices: readonly Voice[] }>("GET", "/voices"), [call]);
  const [selected, setSelected] = useState<string | null>(null);
  const clips = useResource(() => (selected ? call<{ clips: Record<string, Clip> }>("GET", `/voices/${selected}`) : Promise.resolve(null)), [call, selected]);
  const [newVoice, setNewVoice] = useState({ id: "", name: "", engine: "human" });
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function createVoice() {
    setBusy(true);
    try {
      await call("PUT", `/voices/${newVoice.id.trim()}`, { json: { name: newVoice.name.trim() || newVoice.id.trim(), engine: newVoice.engine } });
      helpers.notify(`Voice "${newVoice.id}" ready.`);
      setSelected(newVoice.id.trim());
      setNewVoice({ id: "", name: "", engine: "human" });
      voices.refresh();
    } catch (err) {
      failed(helpers, err);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!selected || !file || !text.trim()) return;
    setBusy(true);
    try {
      const duration = await audioDuration(file);
      const q = new URLSearchParams({ text: text.trim(), duration: duration.toFixed(3), source: "uploaded" });
      const r = await call<{ skipped?: boolean }>("PUT", `/voices/${selected}/clips?${q.toString()}`, { body: file, contentType: file.type || "audio/wav" });
      helpers.notify(r.skipped ? "That line is already recorded for this voice." : `Added "${text.trim()}".`);
      setText("");
      setFile(null);
      clips.refresh();
      voices.refresh();
    } catch (err) {
      failed(helpers, err);
    } finally {
      setBusy(false);
    }
  }
  function removeClip(clip: Clip) {
    if (!selected) return;
    helpers.confirm({
      title: `Remove "${clip.text}"?`,
      body: <p>Videos stop using this take. The audio file stays in storage.</p>,
      confirmLabel: "Remove",
      tone: "danger",
      run: async () => {
        await call("DELETE", `/voices/${selected}/clips/${clip.key}`);
        clips.refresh();
        voices.refresh();
      },
    });
  }

  const list = voices.data?.voices;
  const clipList = clips.data ? Object.values(clips.data.clips).sort((a, b) => a.text.localeCompare(b.text)) : null;
  return (
    <div className="adm-stack">
      <Panel title="Voices" subtitle="Recorded lines, reused by every video that says them. Upload from here or from the Mac (npm run voices); nothing is generated on a server." flush>
        {voices.error && <ErrorNote message={voices.error} onRetry={voices.refresh} />}
        {!list ? <Loading /> : list.length === 0 ? <Empty>No voices yet. Create one below.</Empty> : (
          <div className="adm-table-wrap">
            <table className="adm-table is-clickable">
              <thead><tr><th>Voice</th><th>Engine</th><th className="num">Lines</th></tr></thead>
              <tbody>
                {list.map((v) => (
                  <tr key={v.id} onClick={() => setSelected(v.id)} aria-selected={v.id === selected}>
                    <td><strong>{v.name}</strong> <span className="adm-muted">{v.id}</span></td>
                    <td>{v.engine}</td>
                    <td className="num">{formatNumber(v.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="adm-inline-form" style={{ padding: 16 }} onSubmit={(e) => { e.preventDefault(); void createVoice(); }}>
          <input value={newVoice.id} onChange={(e) => setNewVoice({ ...newVoice, id: e.target.value.toLowerCase() })} placeholder="id, e.g. tate" aria-label="Voice id" pattern="[a-z0-9-]+" required />
          <input value={newVoice.name} onChange={(e) => setNewVoice({ ...newVoice, name: e.target.value })} placeholder="Name" aria-label="Voice name" />
          <select value={newVoice.engine} onChange={(e) => setNewVoice({ ...newVoice, engine: e.target.value })} aria-label="Engine">
            {["human", "chatterbox", "kokoro", "other"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <button type="submit" className="adm-btn" disabled={busy || !newVoice.id.trim()}>Create voice</button>
        </form>
      </Panel>
      {selected && (
        <Panel title={`Lines: ${selected}`} flush>
          <form className="adm-inline-form" style={{ padding: 16 }} onSubmit={(e) => { e.preventDefault(); void upload(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Exactly what's said, e.g. That's Kenya!" aria-label="Line text" style={{ minWidth: 280 }} required />
            <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Audio file" required />
            <button type="submit" className="adm-btn is-primary" disabled={busy || !file || !text.trim()}>{busy ? "Uploading…" : "Upload line"}</button>
          </form>
          {clips.error && <ErrorNote message={clips.error} onRetry={clips.refresh} />}
          {!clipList ? <Loading /> : clipList.length === 0 ? <Empty>No lines yet.</Empty> : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead><tr><th>Line</th><th>Length</th><th>Source</th><th>Listen</th><th /></tr></thead>
                <tbody>
                  {clipList.map((clip) => (
                    <tr key={clip.key}>
                      <td>{clip.text}</td>
                      <td>{clip.duration.toFixed(2)}s</td>
                      <td className="adm-muted">{clip.source}</td>
                      <td>{clip.url && <audio src={clip.url} controls preload="none" style={{ height: 32 }} />}</td>
                      <td className="num"><button type="button" className="adm-btn is-small is-danger" onClick={() => removeClip(clip)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

// ---- music (private) --------------------------------------------------------------------------------------------------
function MusicTab({ call, helpers }: { call: PromoCall; helpers: ActionHelpers }) {
  const music = useResource(() => call<{ music: readonly Music[] }>("GET", "/music"), [call]);
  const [name, setName] = useState("");
  const [licence, setLicence] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState<{ name: string; url: string } | null>(null);

  async function upload() {
    if (!file || !name.trim()) return;
    setBusy(true);
    try {
      const q = new URLSearchParams(licence.trim() ? { licence: licence.trim() } : {});
      await call("PUT", `/music/${name.trim()}${q.toString() ? `?${q.toString()}` : ""}`, { body: file, contentType: file.type || "audio/mpeg" });
      helpers.notify(`Uploaded "${name.trim()}".`);
      setName("");
      setLicence("");
      setFile(null);
      music.refresh();
    } catch (err) {
      failed(helpers, err);
    } finally {
      setBusy(false);
    }
  }
  async function play(track: string) {
    try {
      const blob = await call<Blob>("GET", `/music/${track}/audio`);
      if (playing) URL.revokeObjectURL(playing.url);
      setPlaying({ name: track, url: URL.createObjectURL(blob) });
    } catch (err) {
      failed(helpers, err);
    }
  }

  const list = music.data?.music;
  return (
    <Panel title="Music" subtitle="Licensed tracks, kept in the private bucket (never public). Note each track's licence." flush>
      {music.error && <ErrorNote message={music.error} onRetry={music.refresh} />}
      {!list ? <Loading /> : list.length === 0 ? <Empty>No tracks uploaded yet.</Empty> : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th>Track</th><th>Licence</th><th>Size</th><th>Added</th><th /></tr></thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.name}>
                  <td><strong>{m.name}</strong></td>
                  <td className="adm-muted">{m.licence ?? "—"}</td>
                  <td>{formatBytes(m.bytes)}</td>
                  <td>{when(m.added_at)}</td>
                  <td className="num">{playing?.name === m.name ? <audio src={playing.url} controls autoPlay style={{ height: 32 }} /> : <button type="button" className="adm-btn is-small" onClick={() => void play(m.name)}>Play</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="adm-inline-form" style={{ padding: 16 }} onSubmit={(e) => { e.preventDefault(); void upload(); }}>
        <input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="name, e.g. quiz-drive" aria-label="Track name" pattern="[a-z0-9-]+" required />
        <input value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="Licence, e.g. Mixkit free licence" aria-label="Licence" />
        <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Audio file" required />
        <button type="submit" className="adm-btn is-primary" disabled={busy || !file || !name.trim()}>{busy ? "Uploading…" : "Upload track"}</button>
      </form>
    </Panel>
  );
}

// ---- runs -------------------------------------------------------------------------------------------------------------
function RunsTab({ call }: { call: PromoCall }) {
  const runs = useResource(() => call<{ runs: readonly Run[] }>("GET", "/runs?limit=20"), [call]);
  const list = runs.data?.runs;
  return (
    <Panel title="Posting runs" subtitle="Each run tops up Buffer and checks what went out. The timer runs every 4 hours; Run posting now runs one immediately.">
      {runs.error && <ErrorNote message={runs.error} onRetry={runs.refresh} />}
      {!list ? <Loading /> : list.length === 0 ? <Empty>No runs yet.</Empty> : (
        <div className="adm-stack">
          {list.map((r) => (
            <div key={r.id} className="adm-section">
              <div>
                <strong>{when(r.at)}</strong> <span className="adm-muted">{r.trigger}</span>{" "}
                {r.error ? <Badge tone="bad">error</Badge> : <Badge tone="good">{r.scheduled} scheduled · {r.posted} posted</Badge>}
              </div>
              {(r.log || r.error) && <pre className="adm-small" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{[r.log, r.error && `ERROR ${r.error}`].filter(Boolean).join("\n")}</pre>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
