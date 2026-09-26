import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { AdminClient, AdminDailyEntry, LeaderboardEntry } from "../api";
import { formatDateTime, formatDuration, modeName, todayUtc } from "../format";
import { Badge, Empty, ErrorNote, Loading, Panel, useResource } from "../ui";
import type { ActionHelpers } from "./Users";

type Meta = { modes: { id: string; variants: string[] }[] };
type BoardEntry = LeaderboardEntry & { suspicious: boolean };

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const FLAG_LABELS: Record<string, string> = { "too-fast": "too fast", backdated: "backdated" };

export function ModerationView({ client, onOpenUser, helpers }: { client: AdminClient; onOpenUser: (id: string) => void; helpers: ActionHelpers }) {
  return (
    <div className="adm-stack">
      <DailyBoard client={client} onOpenUser={onOpenUser} helpers={helpers} />
      <BestTimes client={client} onOpenUser={onOpenUser} helpers={helpers} />
    </div>
  );
}

function DailyBoard({ client, onOpenUser, helpers }: { client: AdminClient; onOpenUser: (id: string) => void; helpers: ActionHelpers }) {
  const [date, setDate] = useState(todayUtc());
  const board = useResource(() => client.get<{ entries: AdminDailyEntry[] }>(`/daily?date=${date}`), [client, date]);
  const flagged = board.data?.entries.filter((e) => e.flags.length > 0).length ?? 0;

  return (
    <Panel
      title="Daily challenge"
      subtitle={board.data ? `${board.data.entries.length} result${board.data.entries.length === 1 ? "" : "s"}${flagged ? ` · ${flagged} flagged` : ""}` : " "}
      actions={
        <div className="adm-date-nav">
          <button type="button" className="adm-icon-btn" aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}><ChevronLeft size={16} /></button>
          <input type="date" value={date} max={todayUtc()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Daily challenge date" />
          <button type="button" className="adm-icon-btn" aria-label="Next day" disabled={date >= todayUtc()} onClick={() => setDate(shiftDate(date, 1))}><ChevronRight size={16} /></button>
        </div>
      }
      flush
    >
      {board.error && <ErrorNote message={board.error} onRetry={board.refresh} />}
      {!board.data ? <Loading /> : board.data.entries.length === 0 ? <Empty>No daily results for {date}.</Empty> : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th className="num">#</th><th>Player</th><th className="num">Score</th><th className="num">Time</th><th className="num">Hints</th><th>Submitted</th><th>Flags</th><th /></tr></thead>
            <tbody>
              {board.data.entries.map((entry) => (
                <tr key={entry.user.id} className={entry.flags.length ? "is-flagged" : undefined}>
                  <td className="num">{entry.rank}</td>
                  <td><button type="button" className="adm-link-btn" onClick={() => onOpenUser(entry.user.id)}>{entry.user.displayName}</button><div className="adm-muted adm-small">{entry.user.email}</div></td>
                  <td className="num">{entry.result.score}</td>
                  <td className="num">{formatDuration(entry.result.timeMs)}</td>
                  <td className="num">{entry.result.hintsUsed}</td>
                  <td>{formatDateTime(entry.result.completedAt)}</td>
                  <td>{entry.flags.map((flag) => <Badge key={flag} tone="bad">{FLAG_LABELS[flag] ?? flag}</Badge>)}</td>
                  <td className="num">
                    <button type="button" className="adm-icon-btn" aria-label={`Remove ${entry.user.displayName}'s result`} onClick={() => helpers.confirm({
                      title: "Remove daily result?",
                      body: <p>Removes <strong>{entry.user.displayName}</strong>'s {date} result ({entry.result.score}/100 in {formatDuration(entry.result.timeMs)}) from the daily leaderboard.</p>,
                      confirmLabel: "Remove",
                      tone: "danger",
                      run: async () => { await client.send("DELETE", `/daily/${encodeURIComponent(entry.user.id)}/${date}`); helpers.notify("Daily result removed."); board.refresh(); },
                    })}><Trash2 size={14} /></button>
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

function BestTimes({ client, onOpenUser, helpers }: { client: AdminClient; onOpenUser: (id: string) => void; helpers: ActionHelpers }) {
  const meta = useResource(() => client.get<Meta>("/leaderboards/meta"), [client]);
  const [mode, setMode] = useState("flags");
  const [variant, setVariant] = useState("");
  const variants = meta.data?.modes.find((m) => m.id === mode)?.variants ?? [""];

  useEffect(() => {
    if (!variants.includes(variant)) setVariant(variants[0] ?? "");
  }, [mode, variants, variant]);

  const board = useResource(
    () => client.get<{ entries: BoardEntry[] }>(`/leaderboards?${new URLSearchParams({ mode, variant, limit: "200" })}`),
    [client, mode, variant],
  );
  const flagged = board.data?.entries.filter((e) => e.suspicious).length ?? 0;

  return (
    <Panel
      title="Best-time leaderboards"
      subtitle={board.data ? `${board.data.entries.length} entr${board.data.entries.length === 1 ? "y" : "ies"}${flagged ? ` · ${flagged} suspicious` : ""}` : " "}
      actions={
        <div className="adm-filters is-tight">
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Game mode">
            {(meta.data?.modes ?? [{ id: "flags", variants: [""] }]).map((m) => <option key={m.id} value={m.id}>{modeName(m.id)}</option>)}
          </select>
          {variants.length > 1 && (
            <select value={variant} onChange={(e) => setVariant(e.target.value)} aria-label="Variant">
              {variants.map((v) => <option key={v} value={v}>{v || "Default"}</option>)}
            </select>
          )}
        </div>
      }
      flush
    >
      {board.error && <ErrorNote message={board.error} onRetry={board.refresh} />}
      {!board.data ? <Loading /> : board.data.entries.length === 0 ? <Empty>No times on this leaderboard yet.</Empty> : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th className="num">#</th><th>Player</th><th className="num">Time</th><th>Set</th><th /></tr></thead>
            <tbody>
              {board.data.entries.map((entry) => (
                <tr key={entry.userId} className={entry.suspicious ? "is-flagged" : undefined}>
                  <td className="num">{entry.rank}</td>
                  <td><button type="button" className="adm-link-btn" onClick={() => onOpenUser(entry.userId)}>{entry.avatarEmoji ? `${entry.avatarEmoji} ` : ""}{entry.displayName}</button></td>
                  <td className="num">{formatDuration(entry.timeMs)} {entry.suspicious && <Badge tone="bad">suspicious</Badge>}</td>
                  <td>{formatDateTime(entry.achievedAt)}</td>
                  <td className="num">
                    <button type="button" className="adm-icon-btn" aria-label={`Remove ${entry.displayName}'s time`} onClick={() => helpers.confirm({
                      title: "Remove leaderboard time?",
                      body: <p>Removes <strong>{entry.displayName}</strong>'s {modeName(mode)}{variant ? ` (${variant})` : ""} time of {formatDuration(entry.timeMs)}.</p>,
                      confirmLabel: "Remove",
                      tone: "danger",
                      run: async () => { await client.send("DELETE", `/leaderboards/${encodeURIComponent(entry.userId)}?${new URLSearchParams({ mode, variant })}`); helpers.notify("Leaderboard time removed."); board.refresh(); },
                    })}><Trash2 size={14} /></button>
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
