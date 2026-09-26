import type { AdminClient, AdminEvent, AdminOverview } from "../api";
import { ActivityChart } from "../ActivityChart";
import { formatCompact, formatRelative } from "../format";
import { Badge, Empty, ErrorNote, Loading, Panel, StatTile, useResource } from "../ui";
import { EventRow } from "./Events";

export function OverviewView({ client, onOpenUser }: { client: AdminClient; onOpenUser: (id: string) => void }) {
  const overview = useResource(() => client.get<AdminOverview>("/overview"), [client], 30_000);
  const events = useResource(() => client.get<{ events: AdminEvent[] }>("/events?limit=12"), [client], 15_000);

  if (!overview.data) return overview.error ? <ErrorNote message={overview.error} onRetry={overview.refresh} /> : <Loading />;
  const { totals, live, windows, series, modes, topPlayers } = overview.data;
  const month = windows.month;
  const prev = windows.previousMonth;
  const vsPrev = (current: number, previous: number) => ({ value: current - previous, label: "vs prior 30d" });

  return (
    <div className="adm-stack">
      <div className="adm-stats">
        <StatTile label="Active users · 30d" value={formatCompact(month.activeUsers)} delta={vsPrev(month.activeUsers, prev.activeUsers)} />
        <StatTile label="Active users · 7d" value={formatCompact(windows.week.activeUsers)} hint={`${windows.day.activeUsers} in the last 24h`} />
        <StatTile label="Signups · 30d" value={formatCompact(month.signups)} delta={vsPrev(month.signups, prev.signups)} />
        <StatTile label="Games · 30d" value={formatCompact(month.games)} delta={vsPrev(month.games, prev.games)} />
        <StatTile label="Dailies · 30d" value={formatCompact(month.dailies)} delta={vsPrev(month.dailies, prev.dailies)} />
        <StatTile label="Online now" value={formatCompact(live.onlineUsers)} hint={`${live.rooms} live room${live.rooms === 1 ? "" : "s"} · ${live.roomConnections} players`} />
      </div>

      <Panel title="Daily activity" subtitle="Signed-in players only · last 30 days, UTC">
        <ActivityChart series={series} />
      </Panel>

      <div className="adm-grid-2">
        <Panel title="Most active players" subtitle="Games and dailies in the last 30 days" flush>
          {topPlayers.length === 0 ? (
            <Empty>No player activity in the last 30 days.</Empty>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table is-clickable">
                <thead><tr><th>Player</th><th className="num">Games</th><th className="num">Dailies</th><th>Last seen</th></tr></thead>
                <tbody>
                  {topPlayers.map((row) => (
                    <tr key={row.user.id} onClick={() => onOpenUser(row.user.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpenUser(row.user.id)}>
                      <td><span className="adm-user-cell">{row.user.avatarEmoji && <span aria-hidden>{row.user.avatarEmoji}</span>}{row.user.username}</span></td>
                      <td className="num">{row.games}</td>
                      <td className="num">{row.dailies}</td>
                      <td>{formatRelative(row.lastActiveAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Modes played" subtitle="Recorded games, last 30 days" flush>
          {modes.length === 0 ? (
            <Empty>No recorded games in the last 30 days.</Empty>
          ) : (
            <ul className="adm-bars">
              {modes.map((mode) => (
                <li key={mode.mode}>
                  <span className="adm-bars-label">{mode.mode}</span>
                  <span className="adm-bars-track"><span style={{ width: `${(mode.games / (modes[0]?.games ?? 1)) * 100}%` }} /></span>
                  <span className="adm-bars-value">{mode.games} <small>· {mode.players} player{mode.players === 1 ? "" : "s"}</small></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="adm-grid-2">
        <Panel title="All time" flush>
          <dl className="adm-kv">
            <div><dt>Accounts</dt><dd>{formatCompact(totals.users)}</dd></div>
            <div><dt>Recorded games</dt><dd>{formatCompact(totals.games)}</dd></div>
            <div><dt>Daily results</dt><dd>{formatCompact(totals.dailies)}</dd></div>
            <div><dt>Leaderboard times</dt><dd>{formatCompact(totals.bestTimes)}</dd></div>
            <div><dt>Active sessions</dt><dd>{formatCompact(totals.activeSessions)}</dd></div>
            <div><dt>Friendships</dt><dd>{formatCompact(totals.friendships)}</dd></div>
          </dl>
        </Panel>

        <Panel title="Recent events" actions={<Badge tone="brand">Live</Badge>} flush>
          {events.data ? (
            events.data.events.length === 0 ? <Empty>No events recorded yet.</Empty> : (
              <ul className="adm-events is-compact">
                {events.data.events.map((event) => <EventRow key={event.id} event={event} compact onOpenUser={onOpenUser} />)}
              </ul>
            )
          ) : events.error ? <ErrorNote message={events.error} /> : <Loading />}
        </Panel>
      </div>
    </div>
  );
}
