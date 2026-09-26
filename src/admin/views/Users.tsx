import { useEffect, useState } from "react";
import { Eraser, LogOut, Pencil, RotateCcw, Search, Trash2, X } from "lucide-react";
import type { AdminClient, AdminUserDetail, AdminUserList, AuthUser } from "../api";
import { formatDate, formatDateTime, formatDuration, formatNumber, formatRelative, modeName } from "../format";
import { Badge, Empty, ErrorNote, Loading, Panel, useResource, type ConfirmRequest } from "../ui";
import { EventRow } from "./Events";

const PAGE = 50;

export interface ActionHelpers {
  readonly confirm: (request: ConfirmRequest) => void;
  readonly notify: (message: string, tone?: "good" | "bad") => void;
}

function authLabel(user: { hasPassword: boolean; providers: readonly string[] }): string {
  return [...(user.hasPassword ? ["password"] : []), ...user.providers].join(", ") || "—";
}

// Heuristic only: helps spot automated / test signups at a glance.
function looksLikeTestAccount(email: string, name: string): boolean {
  return /@example\.(com|org|net)$/i.test(email) || /pentest|^ptest|^test/i.test(name) || /pentest/i.test(email);
}

export function UsersView({ client, selectedId, onSelect, helpers }: { client: AdminClient; selectedId: string | null; onSelect: (id: string | null) => void; helpers: ActionHelpers }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebounced(query.trim()); setOffset(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const list = useResource(
    () => client.get<AdminUserList>(`/users?${new URLSearchParams({ q: debounced, limit: String(PAGE), offset: String(offset) })}`),
    [client, debounced, offset],
  );

  return (
    <>
      <Panel
        title="Users"
        subtitle={list.data ? `${formatNumber(list.data.total)} account${list.data.total === 1 ? "" : "s"}${debounced ? ` matching “${debounced}”` : ""}` : " "}
        actions={
          <label className="adm-search">
            <Search size={15} aria-hidden />
            <input type="search" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
          </label>
        }
        flush
      >
        {list.error && <ErrorNote message={list.error} onRetry={list.refresh} />}
        {!list.data ? <Loading /> : list.data.users.length === 0 ? <Empty>No users found.</Empty> : (
          <div className="adm-table-wrap">
            <table className="adm-table is-clickable">
              <thead>
                <tr><th>User</th><th>Email</th><th>Sign-in</th><th>Joined</th><th>Last active</th><th className="num">Games</th><th className="num">Dailies</th></tr>
              </thead>
              <tbody>
                {list.data.users.map((user) => (
                  <tr key={user.id} onClick={() => onSelect(user.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect(user.id)} aria-selected={user.id === selectedId}>
                    <td>
                      <span className="adm-user-cell">
                        {user.avatarEmoji && <span aria-hidden>{user.avatarEmoji}</span>}
                        <strong>{user.displayName}</strong>
                        {looksLikeTestAccount(user.email, user.displayName) && <Badge tone="warn" title="Looks like an automated or test account">test?</Badge>}
                      </span>
                    </td>
                    <td className="adm-muted">{user.email}</td>
                    <td>{authLabel(user)}</td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td>{formatRelative(user.lastActiveAt)}</td>
                    <td className="num">{user.games}</td>
                    <td className="num">{user.dailies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && list.data.total > PAGE && (
          <div className="adm-pager">
            <button type="button" className="adm-btn is-small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <span>{offset + 1}–{Math.min(offset + PAGE, list.data.total)} of {list.data.total}</span>
            <button type="button" className="adm-btn is-small" disabled={offset + PAGE >= list.data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        )}
      </Panel>
      {selectedId && <UserDrawer key={selectedId} client={client} id={selectedId} onClose={() => onSelect(null)} onChanged={list.refresh} helpers={helpers} />}
    </>
  );
}

function UserDrawer({ client, id, onClose, onChanged, helpers }: { client: AdminClient; id: string; onClose: () => void; onChanged: () => void; helpers: ActionHelpers }) {
  const detail = useResource(() => client.get<AdminUserDetail>(`/users/${encodeURIComponent(id)}`), [client, id]);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const afterChange = () => { detail.refresh(); onChanged(); };
  const path = `/users/${encodeURIComponent(id)}`;

  async function rename() {
    try {
      await client.send<{ user: AuthUser }>("PATCH", path, { displayName: newName.trim() });
      helpers.notify(`Renamed to ${newName.trim()}.`);
      setRenaming(false);
      afterChange();
    } catch (err) {
      helpers.notify(err instanceof Error ? err.message : String(err), "bad");
    }
  }

  const d = detail.data;
  return (
    <div className="adm-drawer-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="adm-drawer" aria-label="User details">
        <header className="adm-drawer-head">
          <div>
            <span className="adm-eyebrow">User</span>
            <h2>{d ? <>{d.user.avatarEmoji && <span aria-hidden>{d.user.avatarEmoji} </span>}{d.user.displayName}</> : "Loading…"}</h2>
            {d && <p className="adm-muted">{d.user.email}</p>}
          </div>
          <button type="button" className="adm-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        {detail.error && <ErrorNote message={detail.error} onRetry={detail.refresh} />}
        {!d ? <Loading /> : (
          <div className="adm-drawer-body">
            <div className="adm-chips">
              {d.online ? <Badge tone="good">Online</Badge> : <Badge>Offline</Badge>}
              <Badge>{authLabel({ hasPassword: d.user.hasPassword, providers: d.providers })}</Badge>
              <Badge>Joined {formatDate(d.user.createdAt)}</Badge>
              <Badge>{d.sessions.length} active session{d.sessions.length === 1 ? "" : "s"}</Badge>
              <Badge>{d.friends.length} friend{d.friends.length === 1 ? "" : "s"}</Badge>
            </div>

            <div className="adm-actions">
              {renaming ? (
                <form className="adm-inline-form" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus aria-label="New username" maxLength={20} />
                  <button type="submit" className="adm-btn is-primary is-small" disabled={newName.trim().length < 3}>Save</button>
                  <button type="button" className="adm-btn is-small" onClick={() => setRenaming(false)}>Cancel</button>
                </form>
              ) : (
                <button type="button" className="adm-btn is-small" onClick={() => { setNewName(d.user.displayName); setRenaming(true); }}><Pencil size={14} aria-hidden /> Rename</button>
              )}
              {d.user.avatarEmoji && (
                <button type="button" className="adm-btn is-small" onClick={async () => {
                  try { await client.send("PATCH", path, { clearAvatar: true }); helpers.notify("Avatar cleared."); afterChange(); } catch (err) { helpers.notify(err instanceof Error ? err.message : String(err), "bad"); }
                }}><Eraser size={14} aria-hidden /> Clear avatar</button>
              )}
              <button type="button" className="adm-btn is-small" disabled={d.sessions.length === 0} onClick={() => helpers.confirm({
                title: "Sign this user out everywhere?",
                body: <p>Revokes all {d.sessions.length} active session{d.sessions.length === 1 ? "" : "s"} for <strong>{d.user.displayName}</strong>. They can sign in again.</p>,
                confirmLabel: "Sign out",
                run: async () => { const r = await client.send<{ revoked: number }>("DELETE", `${path}/sessions`); helpers.notify(`Revoked ${r.revoked} session${r.revoked === 1 ? "" : "s"}.`); afterChange(); },
              })}><LogOut size={14} aria-hidden /> Sign out</button>
              <button type="button" className="adm-btn is-small" onClick={() => helpers.confirm({
                title: "Reset game stats?",
                body: <p>Deletes <strong>{d.user.displayName}</strong>'s game history, per-category stats and totals ({d.stats.totalGames} games). Leaderboard times and daily results are kept — remove those individually below.</p>,
                confirmLabel: "Reset stats",
                tone: "danger",
                run: async () => { await client.send("DELETE", `${path}/stats`); helpers.notify("Stats reset."); afterChange(); },
              })}><RotateCcw size={14} aria-hidden /> Reset stats</button>
              <button type="button" className="adm-btn is-small is-danger" onClick={() => helpers.confirm({
                title: "Delete this account?",
                body: <p>Permanently deletes <strong>{d.user.displayName}</strong> ({d.user.email}) with their sessions, stats, games, leaderboard times, daily results and friendships. This can't be undone.</p>,
                confirmLabel: "Delete account",
                tone: "danger",
                typeToConfirm: d.user.displayName,
                run: async () => { await client.send("DELETE", path); helpers.notify(`Deleted ${d.user.displayName}.`); onChanged(); onClose(); },
              })}><Trash2 size={14} aria-hidden /> Delete</button>
            </div>

            <section className="adm-section">
              <h3>Stats</h3>
              <dl className="adm-kv is-grid">
                <div><dt>Games</dt><dd>{d.stats.totalGames}</dd></div>
                <div><dt>Correct</dt><dd>{d.stats.totalCorrect}</dd></div>
                <div><dt>Wrong</dt><dd>{d.stats.totalWrong}</dd></div>
                <div><dt>Best streak</dt><dd>{d.stats.bestStreak}</dd></div>
                <div><dt>Solo</dt><dd>{d.stats.soloGames}</dd></div>
                <div><dt>Multiplayer</dt><dd>{d.stats.multiplayerGames} <small>({d.stats.multiplayerWins} wins)</small></dd></div>
                <div><dt>World map</dt><dd>{d.stats.worldMapGames}</dd></div>
                <div><dt>Dailies</dt><dd>{d.dailies.length}</dd></div>
              </dl>
            </section>

            <section className="adm-section">
              <h3>Leaderboard times</h3>
              {d.bestTimes.length === 0 ? <Empty>No leaderboard times.</Empty> : (
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead><tr><th>Mode</th><th>Variant</th><th className="num">Time</th><th>Set</th><th /></tr></thead>
                    <tbody>
                      {d.bestTimes.map((row) => (
                        <tr key={`${row.gameMode}:${row.variant}`}>
                          <td>{modeName(row.gameMode)}</td>
                          <td>{row.variant || "Default"}</td>
                          <td className="num">{formatDuration(row.timeMs)} {row.suspicious && <Badge tone="bad" title="Faster than any plausible run">suspicious</Badge>}</td>
                          <td>{formatDateTime(row.achievedAt)}</td>
                          <td className="num">
                            <button type="button" className="adm-icon-btn" aria-label={`Remove ${row.gameMode} time`} onClick={() => helpers.confirm({
                              title: "Remove leaderboard time?",
                              body: <p>Removes {d.user.displayName}'s {modeName(row.gameMode)}{row.variant ? ` (${row.variant})` : ""} time of {formatDuration(row.timeMs)}.</p>,
                              confirmLabel: "Remove",
                              tone: "danger",
                              run: async () => { await client.send("DELETE", `/leaderboards/${encodeURIComponent(id)}?${new URLSearchParams({ mode: row.gameMode, variant: row.variant })}`); helpers.notify("Leaderboard time removed."); afterChange(); },
                            })}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="adm-section">
              <h3>Daily results</h3>
              {d.dailies.length === 0 ? <Empty>No daily results.</Empty> : (
                <div className="adm-table-wrap is-short">
                  <table className="adm-table">
                    <thead><tr><th>Date</th><th className="num">Score</th><th className="num">Time</th><th>Submitted</th><th /></tr></thead>
                    <tbody>
                      {d.dailies.map((row) => (
                        <tr key={row.date}>
                          <td>{row.date}</td>
                          <td className="num">{row.score}</td>
                          <td className="num">{formatDuration(row.timeMs)}</td>
                          <td>{formatDateTime(row.completedAt)}</td>
                          <td className="num">
                            <button type="button" className="adm-icon-btn" aria-label={`Remove daily ${row.date}`} onClick={() => helpers.confirm({
                              title: "Remove daily result?",
                              body: <p>Removes {d.user.displayName}'s daily result for {row.date} (score {row.score}). It disappears from that day's leaderboard.</p>,
                              confirmLabel: "Remove",
                              tone: "danger",
                              run: async () => { await client.send("DELETE", `/daily/${encodeURIComponent(id)}/${row.date}`); helpers.notify("Daily result removed."); afterChange(); },
                            })}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="adm-section">
              <h3>Recent games</h3>
              {d.recentGames.length === 0 ? <Empty>No recorded games.</Empty> : (
                <div className="adm-table-wrap is-short">
                  <table className="adm-table">
                    <thead><tr><th>Played</th><th>Mode</th><th>Categories</th><th className="num">Correct</th><th className="num">Wrong</th><th className="num">Score</th></tr></thead>
                    <tbody>
                      {d.recentGames.map((game) => (
                        <tr key={game.id}>
                          <td>{formatDateTime(game.playedAt)}</td>
                          <td>{game.mode}{game.playMode ? ` · ${game.playMode}` : ""}{game.rank === 1 ? " 🏆" : ""}</td>
                          <td className="adm-muted">{game.categoryIds.join(", ")}</td>
                          <td className="num">{game.correctAnswers}</td>
                          <td className="num">{game.wrongAnswers}</td>
                          <td className="num">{game.score}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="adm-section">
              <h3>Sessions</h3>
              {d.sessions.length === 0 ? <Empty>No active sessions.</Empty> : (
                <ul className="adm-list">
                  {d.sessions.map((session) => (
                    <li key={session.createdAt}>Signed in {formatDateTime(session.createdAt)} <span className="adm-muted">· expires {formatDate(session.expiresAt)}</span></li>
                  ))}
                </ul>
              )}
            </section>

            <section className="adm-section">
              <h3>Activity log</h3>
              {d.events.length === 0 ? <Empty>No logged events for this user yet.</Empty> : (
                <ul className="adm-events">
                  {d.events.map((event) => <EventRow key={event.id} event={event} />)}
                </ul>
              )}
            </section>

            <p className="adm-footnote">ID <code>{d.user.id}</code></p>
          </div>
        )}
      </aside>
    </div>
  );
}
