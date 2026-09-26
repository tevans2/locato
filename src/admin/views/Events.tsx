import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import type { AdminClient, AdminEvent } from "../api";
import { formatClock, formatDate } from "../format";
import { Badge, Empty, ErrorNote, Loading, Panel } from "../ui";

const PAGE = 100;
const ACTION_PRESETS = ["", "admin.", "register", "login", "oauth", "daily", "leaderboard", "game", "friend", "streetview"];

function summarize(event: AdminEvent): string {
  const d = event.details;
  const parts: string[] = [];
  for (const key of ["email", "reason", "mode", "variant", "date", "score", "timeMs", "correct", "provider", "result", "path", "targetUserId", "roomCode", "error"]) {
    const value = d[key];
    if (value !== undefined && value !== null && value !== "") parts.push(`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return parts.join("  ");
}

export function EventRow({ event, compact = false, onOpenUser, onFilterIp }: { event: AdminEvent; compact?: boolean; onOpenUser?: (id: string) => void; onFilterIp?: (ip: string) => void }) {
  const [open, setOpen] = useState(false);
  const summary = summarize(event);
  return (
    <li className={`adm-event is-${event.level}`}>
      <button type="button" className="adm-event-main" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {!compact && (open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />)}
        <time dateTime={new Date(event.time).toISOString()} title={new Date(event.time).toISOString()}>
          {compact ? formatClock(event.time).slice(0, 5) : `${formatDate(event.time)} ${formatClock(event.time)}`}
        </time>
        <span className="adm-event-action">{event.action}</span>
        {event.level === "warn" && <Badge tone="warn">warn</Badge>}
        {!compact && <span className="adm-event-summary">{summary}</span>}
      </button>
      {open && (
        <div className="adm-event-detail">
          <dl>
            {event.ip && (
              <div><dt>IP</dt><dd>{onFilterIp ? <button type="button" className="adm-link-btn" onClick={() => onFilterIp(event.ip!)}>{event.ip}</button> : event.ip}</dd></div>
            )}
            {event.userId && (
              <div><dt>User</dt><dd>{onOpenUser ? <button type="button" className="adm-link-btn" onClick={() => onOpenUser(event.userId!)}>{event.userId}</button> : event.userId}</dd></div>
            )}
          </dl>
          <pre>{JSON.stringify(event.details, null, 2)}</pre>
        </div>
      )}
    </li>
  );
}

export function EventsView({ client, onOpenUser, initialFilter }: { client: AdminClient; onOpenUser: (id: string) => void; initialFilter?: { ip?: string; userId?: string } }) {
  const [level, setLevel] = useState<"" | "info" | "warn">("");
  const [action, setAction] = useState("");
  const [ip, setIp] = useState(initialFilter?.ip ?? "");
  const [userId, setUserId] = useState(initialFilter?.userId ?? "");
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const query = useCallback((before?: number) => {
    const params = new URLSearchParams({ limit: String(PAGE) });
    if (level) params.set("level", level);
    if (action.trim()) params.set("action", action.trim());
    if (ip.trim()) params.set("ip", ip.trim());
    if (userId.trim()) params.set("userId", userId.trim());
    if (before !== undefined) params.set("before", String(before));
    return client.get<{ events: AdminEvent[] }>(`/events?${params}`);
  }, [client, level, action, ip, userId]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await query();
      setEvents(result.events);
      setExhausted(result.events.length < PAGE);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 250);
    return () => window.clearTimeout(timer);
  }, [reload]);

  async function loadMore() {
    const last = events?.at(-1);
    if (!last) return;
    setLoading(true);
    try {
      const result = await query(last.id);
      setEvents((current) => [...(current ?? []), ...result.events]);
      setExhausted(result.events.length < PAGE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel
      title="Event log"
      subtitle="Every structured server log line, kept in the database (default 90 days)"
      actions={<button type="button" className="adm-btn is-small" onClick={() => void reload()} disabled={loading}><RefreshCw size={14} className={loading ? "adm-spin" : undefined} aria-hidden /> Refresh</button>}
      flush
    >
      <div className="adm-filters">
        <label className="adm-field is-inline">
          <span>Level</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
            <option value="">All</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
          </select>
        </label>
        <label className="adm-field is-inline">
          <span>Action</span>
          <input list="adm-action-presets" value={action} onChange={(e) => setAction(e.target.value)} placeholder="prefix, e.g. admin." spellCheck={false} />
          <datalist id="adm-action-presets">{ACTION_PRESETS.filter(Boolean).map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="adm-field is-inline">
          <span>IP</span>
          <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="exact" spellCheck={false} />
        </label>
        <label className="adm-field is-inline">
          <span>User ID</span>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="exact" spellCheck={false} />
        </label>
        {(level || action || ip || userId) && (
          <button type="button" className="adm-link-btn" onClick={() => { setLevel(""); setAction(""); setIp(""); setUserId(""); }}>Clear filters</button>
        )}
      </div>
      {error && <ErrorNote message={error} onRetry={() => void reload()} />}
      {!events ? <Loading /> : events.length === 0 ? (
        <Empty>No events match these filters. Events are recorded from the moment this version is deployed.</Empty>
      ) : (
        <>
          <ul className="adm-events">
            {events.map((event) => <EventRow key={event.id} event={event} onOpenUser={onOpenUser} onFilterIp={setIp} />)}
          </ul>
          {!exhausted && (
            <div className="adm-more">
              <button type="button" className="adm-btn" onClick={() => void loadMore()} disabled={loading}>Load older events</button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
