import { useEffect, useState } from "react";
import { Ban, Eraser, LogOut, Pencil, RotateCcw, Search, ShieldCheck, ShieldOff, Trash2, X } from "lucide-react";
import type { AdminAccess, AdminClient, AdminUserDetail, AdminUserList, AuthUser } from "../api";
import { formatBoardValue, formatDate, formatDateTime, formatDuration, formatNumber, formatRelative, modeName } from "../format";
import { Badge, Empty, ErrorNote, Loading, Panel, useResource, type ConfirmRequest } from "../ui";
import { EventRow } from "./Events";
import { RunsTable } from "./Runs";

const PAGE = 50;

export interface ActionHelpers {
  readonly confirm: (request: ConfirmRequest) => void;
  readonly notify: (message: string, tone?: "good" | "bad") => void;
}

function authLabel(user: { hasPassword: boolean; providers: readonly string[] }): string {
  return [...(user.hasPassword ? ["password"] : []), ...user.providers].join(", ") || "—";
}

function AdminBadge({ access }: { access: AdminAccess }) {
  if (!access) return null;
  return <Badge tone="good" title={access === "config" ? "Admin through ADMIN_EMAILS" : "Admin access granted in the console"}>admin</Badge>;
}

// Ban and unban from anywhere in the console. Banning asks for an optional reason; unbanning is
// one click, since nothing was deleted and it's just as easy to ban again.
export function toggleBan(client: AdminClient, helpers: ActionHelpers, user: { id: string; displayName: string; banned: boolean }, onDone: () => void): void {
  if (user.banned) {
    void client.send("DELETE", `/users/${encodeURIComponent(user.id)}/ban`)
      .then(() => { helpers.notify(`Unbanned ${user.displayName}.`); onDone(); })
      .catch((err: unknown) => helpers.notify(err instanceof Error ? err.message : String(err), "bad"));
    return;
  }
  let reason = "";
  helpers.confirm({
    title: `Ban ${user.displayName}?`,
    body: (
      <>
        <p>Signs them out everywhere, stops them signing in or playing online, and hides them from every leaderboard. Nothing is deleted: unban to restore everything.</p>
        <label className="adm-field">
          <span>Reason (optional, only admins see it)</span>
          <input onChange={(e) => { reason = e.target.value; }} maxLength={200} placeholder="e.g. Scripted leaderboard runs" />
        </label>
      </>
    ),
    confirmLabel: "Ban",
    tone: "danger",
    run: async () => {
      await client.send("PUT", `/users/${encodeURIComponent(user.id)}/ban`, { reason });
      helpers.notify(`Banned ${user.displayName}.`);
      onDone();
    },
  });
}

export function BanSwitch({ banned, disabledReason, onToggle }: { banned: boolean; disabledReason: string | null; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={banned}
      className={`adm-switch${banned ? " is-on" : ""}`}
      disabled={disabledReason !== null}
      title={disabledReason ?? (banned ? "Banned. Click to unban" : "Click to ban")}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="adm-switch-track" aria-hidden><span className="adm-switch-thumb" /></span>
      <span>{banned ? "Banned" : "Active"}</span>
    </button>
  );
}

export const IP_BAN_LENGTHS: readonly { readonly value: string; readonly label: string }[] = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "", label: "Until lifted" },
];

export function banIp(client: AdminClient, helpers: ActionHelpers, ip: string, onDone: () => void): void {
  let days = "7";
  let reason = "";
  helpers.confirm({
    title: `Ban ${ip}?`,
    body: (
      <>
        <p>Blocks sign-in, sign-up, the game API and multiplayer from this address. It can hit other people on the same network (schools, offices, mobile data), and a VPN gets around it, so keep it short.</p>
        <label className="adm-field">
          <span>Length</span>
          <select defaultValue={days} onChange={(e) => { days = e.target.value; }}>
            {IP_BAN_LENGTHS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>Reason (optional)</span>
          <input onChange={(e) => { reason = e.target.value; }} maxLength={200} />
        </label>
      </>
    ),
    confirmLabel: "Ban IP",
    tone: "danger",
    run: async () => {
      const length = days === "" ? null : Number(days);
      await client.send("POST", "/bans/ips", { ip, reason, days: length });
      helpers.notify(`Banned ${ip}${length ? ` for ${length} day${length === 1 ? "" : "s"}` : ""}.`);
      onDone();
    },
  });
}

function banBlockedReason(user: { id: string; admin: AdminAccess }, currentAdminId: string): string | null {
  if (user.id === currentAdminId) return "You can't ban yourself.";
  return user.admin ? "Remove admin access before banning." : null;
}

// Heuristic only: helps spot automated / test signups at a glance.
function looksLikeTestAccount(email: string, name: string): boolean {
  return /@example\.(com|org|net)$/i.test(email) || /pentest|^ptest|^test/i.test(name) || /pentest/i.test(email);
}

export function UsersView({ client, currentAdminId, selectedId, onSelect, helpers }: { client: AdminClient; currentAdminId: string; selectedId: string | null; onSelect: (id: string | null) => void; helpers: ActionHelpers }) {
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
                <tr><th>User</th><th>Email</th><th>Sign-in</th><th>Joined</th><th>Last active</th><th className="num">Games</th><th className="num">Dailies</th><th>Status</th></tr>
              </thead>
              <tbody>
                {list.data.users.map((user) => (
                  <tr key={user.id} onClick={() => onSelect(user.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect(user.id)} aria-selected={user.id === selectedId}>
                    <td>
                      <span className="adm-user-cell">
                        {user.avatarEmoji && <span aria-hidden>{user.avatarEmoji}</span>}
                        <strong>{user.displayName}</strong>
                        <AdminBadge access={user.admin} />
                        {user.banned && <Badge tone="bad">banned</Badge>}
                        {looksLikeTestAccount(user.email, user.displayName) && <Badge tone="warn" title="Looks like an automated or test account">test?</Badge>}
                      </span>
                    </td>
                    <td className="adm-muted">{user.email}</td>
                    <td>{authLabel(user)}</td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td>{formatRelative(user.lastActiveAt)}</td>
                    <td className="num">{user.games}</td>
                    <td className="num">{user.dailies}</td>
                    <td>
                      <BanSwitch banned={user.banned} disabledReason={banBlockedReason(user, currentAdminId)} onToggle={() => toggleBan(client, helpers, user, list.refresh)} />
                    </td>
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
      {selectedId && <UserDrawer key={selectedId} client={client} currentAdminId={currentAdminId} id={selectedId} onClose={() => onSelect(null)} onChanged={list.refresh} helpers={helpers} />}
    </>
  );
}

function UserDrawer({ client, currentAdminId, id, onClose, onChanged, helpers }: { client: AdminClient; currentAdminId: string; id: string; onClose: () => void; onChanged: () => void; helpers: ActionHelpers }) {
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
              <AdminBadge access={d.user.admin} />
              {d.ban && <Badge tone="bad" {...(d.ban.reason ? { title: d.ban.reason } : {})}>Banned {formatDate(d.ban.bannedAt)}</Badge>}
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
              <BanSwitch banned={d.ban !== null} disabledReason={banBlockedReason({ id: d.user.id, admin: d.user.admin }, currentAdminId)} onToggle={() => toggleBan(client, helpers, { id: d.user.id, displayName: d.user.displayName, banned: d.ban !== null }, afterChange)} />
              {d.user.admin === null && d.ban === null ? (
                <button type="button" className="adm-btn is-small" onClick={() => helpers.confirm({
                  title: "Make this user an admin?",
                  body: <p><strong>{d.user.displayName}</strong> ({d.user.email}) will be able to sign in here and see every account, edit and delete users, and remove leaderboard entries.</p>,
                  confirmLabel: "Make admin",
                  run: async () => { await client.send("PUT", `${path}/admin`, { admin: true }); helpers.notify(`${d.user.displayName} is now an admin.`); afterChange(); },
                })}><ShieldCheck size={14} aria-hidden /> Make admin</button>
              ) : d.user.admin === "granted" && d.user.id !== currentAdminId ? (
                <button type="button" className="adm-btn is-small" onClick={() => helpers.confirm({
                  title: "Remove admin access?",
                  body: <p><strong>{d.user.displayName}</strong> will lose access to this console. Their account is otherwise unchanged.</p>,
                  confirmLabel: "Remove admin",
                  tone: "danger",
                  run: async () => { await client.send("PUT", `${path}/admin`, { admin: false }); helpers.notify(`Removed admin access from ${d.user.displayName}.`); afterChange(); },
                })}><ShieldOff size={14} aria-hidden /> Remove admin</button>
              ) : null}
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

            {d.ban && (
              <p className="adm-ban-note"><Ban size={14} aria-hidden /> Banned {formatDateTime(d.ban.bannedAt)}{d.ban.reason ? `: ${d.ban.reason}` : ""}</p>
            )}

            <section className="adm-section">
              <h3>IP addresses</h3>
              {d.ips.length === 0 ? <Empty>No addresses in the event log.</Empty> : (
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead><tr><th>Address</th><th>Last seen</th><th className="num">Events</th><th /></tr></thead>
                    <tbody>
                      {d.ips.map((row) => (
                        <tr key={row.ip}>
                          <td><code>{row.ip}</code> {row.banned && <Badge tone="bad">banned</Badge>}</td>
                          <td>{formatRelative(row.lastSeenAt)}</td>
                          <td className="num">{row.events}</td>
                          <td className="num">
                            {row.banned ? (
                              <button type="button" className="adm-btn is-small" onClick={async () => {
                                try { await client.send("DELETE", `/bans/ips/${encodeURIComponent(row.ip)}`); helpers.notify(`Unbanned ${row.ip}.`); afterChange(); } catch (err) { helpers.notify(err instanceof Error ? err.message : String(err), "bad"); }
                              }}>Unban IP</button>
                            ) : (
                              <button type="button" className="adm-btn is-small" onClick={() => banIp(client, helpers, row.ip, afterChange)}>Ban IP</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

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
              <h3>Leaderboard bests</h3>
              {d.bestTimes.length + (d.bestScores?.length ?? 0) === 0 ? <Empty>No leaderboard entries.</Empty> : (
                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead><tr><th>Mode</th><th>Variant</th><th className="num">Best</th><th>Set</th><th /></tr></thead>
                    <tbody>
                      {[...d.bestTimes, ...(d.bestScores ?? [])].map((row) => {
                        const noun = "score" in row ? "score" : "time";
                        return (
                          <tr key={`${row.gameMode}:${row.variant}`}>
                            <td>{modeName(row.gameMode)}</td>
                            <td>{row.variant || "Default"}</td>
                            <td className="num">{formatBoardValue(row)} {row.suspicious && <Badge tone="bad" title={noun === "score" ? "A perfect total" : "Faster than any plausible run"}>suspicious</Badge>}</td>
                            <td>{formatDateTime(row.achievedAt)}</td>
                            <td className="num">
                              <button type="button" className="adm-icon-btn" aria-label={`Remove ${row.gameMode} ${noun}`} onClick={() => helpers.confirm({
                                title: `Remove leaderboard ${noun}?`,
                                body: <p>Removes {d.user.displayName}'s {modeName(row.gameMode)}{row.variant ? ` (${row.variant})` : ""} {noun} of {formatBoardValue(row)}.</p>,
                                confirmLabel: "Remove",
                                tone: "danger",
                                run: async () => { await client.send("DELETE", `/leaderboards/${encodeURIComponent(id)}?${new URLSearchParams({ mode: row.gameMode, variant: row.variant })}`); helpers.notify(`Leaderboard ${noun} removed.`); afterChange(); },
                              })}><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="adm-section">
              <h3>Runs</h3>
              {(d.runs?.length ?? 0) === 0 ? <Empty>No audited runs yet. Name all countries runs are recorded from this version on.</Empty> : (
                <RunsTable runs={d.runs} />
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
