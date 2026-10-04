import { useState } from "react";
import type { AdminBans, AdminClient } from "../api";
import { formatDateTime } from "../format";
import { Empty, ErrorNote, Loading, Panel, useResource } from "../ui";
import { IP_BAN_LENGTHS, toggleBan, type ActionHelpers } from "./Users";

function failed(helpers: ActionHelpers, err: unknown): void {
  helpers.notify(err instanceof Error ? err.message : String(err), "bad");
}

export function BansView({ client, onOpenUser, helpers }: { client: AdminClient; onOpenUser: (id: string) => void; helpers: ActionHelpers }) {
  const bans = useResource(() => client.get<AdminBans>("/bans"), [client]);
  const [ip, setIp] = useState("");
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function addIpBan() {
    setBusy(true);
    try {
      const length = days === "" ? null : Number(days);
      await client.send("POST", "/bans/ips", { ip: ip.trim(), reason, days: length });
      helpers.notify(`Banned ${ip.trim()}.`);
      setIp("");
      setReason("");
      bans.refresh();
    } catch (err) {
      failed(helpers, err);
    } finally {
      setBusy(false);
    }
  }

  const data = bans.data;
  return (
    <div className="adm-stack">
      {bans.error && <ErrorNote message={bans.error} onRetry={bans.refresh} />}
      <Panel title="Banned accounts" subtitle="Can't sign in or play online, and hidden from every leaderboard. Unbanning restores everything." flush>
        {!data ? <Loading /> : data.users.length === 0 ? <Empty>No banned accounts. Ban someone from Users with the status switch.</Empty> : (
          <div className="adm-table-wrap">
            <table className="adm-table is-clickable">
              <thead><tr><th>User</th><th>Email</th><th>Banned</th><th>Reason</th><th /></tr></thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id} onClick={() => onOpenUser(user.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpenUser(user.id)}>
                    <td><strong>{user.displayName}</strong></td>
                    <td className="adm-muted">{user.email}</td>
                    <td>{formatDateTime(user.bannedAt)}</td>
                    <td>{user.reason ?? <span className="adm-muted">—</span>}</td>
                    <td className="num">
                      <button type="button" className="adm-btn is-small" onClick={(e) => { e.stopPropagation(); toggleBan(client, helpers, { id: user.id, displayName: user.displayName, banned: true }, bans.refresh); }}>Unban</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Banned IP addresses" subtitle="Blocks sign-in, sign-up, the game API and multiplayer from an address. Shared networks and VPNs make these blunt, so keep them short." flush>
        <form className="adm-inline-form adm-ban-form" onSubmit={(e) => { e.preventDefault(); void addIpBan(); }}>
          <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="IP address" aria-label="IP address" spellCheck={false} />
          <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Ban length">
            {IP_BAN_LENGTHS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" aria-label="Reason" maxLength={200} />
          <button type="submit" className="adm-btn is-danger is-small" disabled={busy || !ip.trim()}>Ban IP</button>
        </form>
        {!data ? <Loading /> : data.ips.length === 0 ? <Empty>No banned addresses. Players' addresses are listed in their details under Users.</Empty> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Address</th><th>Banned</th><th>Until</th><th>Reason</th><th /></tr></thead>
              <tbody>
                {data.ips.map((ban) => (
                  <tr key={ban.ip}>
                    <td><code>{ban.ip}</code></td>
                    <td>{formatDateTime(ban.createdAt)}</td>
                    <td>{ban.expiresAt === null ? "Until lifted" : formatDateTime(ban.expiresAt)}</td>
                    <td>{ban.reason ?? <span className="adm-muted">—</span>}</td>
                    <td className="num">
                      <button type="button" className="adm-btn is-small" onClick={async () => {
                        try { await client.send("DELETE", `/bans/ips/${encodeURIComponent(ban.ip)}`); helpers.notify(`Unbanned ${ban.ip}.`); bans.refresh(); } catch (err) { failed(helpers, err); }
                      }}>Unban</button>
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
