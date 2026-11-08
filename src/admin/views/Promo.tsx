import { useCallback, useMemo, useRef, useState } from "react";
import type { AdminClient, GrowthReport } from "../api";
import { formatBytes, formatDateTime, formatNumber } from "../format";
import { Badge, Empty, ErrorNote, Loading, Panel, useResource } from "../ui";
import type { ActionHelpers } from "./Users";

// The promo pipeline (videos, posting, content, voices, music) runs as its own service (promo/worker on Cloudflare),
// separate from the game. This tab talks to it straight from the browser with a short-lived token the game's admin
// API signs for the signed-in admin; the game server never calls the promo service.

type CallOptions = { readonly json?: unknown; readonly body?: Blob; readonly contentType?: string };
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
    <Panel title="Queue" subtitle="Staged videos. The promo service moves them into Buffer as room frees up (10 per channel on the free plan)." flush>
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
                    <td className="adm-muted">{[meta.kind, meta.mode, meta.hook].filter((x) => typeof x === "string").join(" · ") || "—"}</td>
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
