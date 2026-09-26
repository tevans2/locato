import { DoorClosed } from "lucide-react";
import type { AdminClient, AdminRoomSummary, PublicUser } from "../api";
import { formatRelative } from "../format";
import { Badge, Empty, ErrorNote, Loading, Panel, useResource } from "../ui";
import type { ActionHelpers } from "./Users";

const STATUS_TONE: Record<string, "good" | "brand" | "neutral"> = { playing: "good", "round-result": "good", lobby: "brand", complete: "neutral" };

export function LiveView({ client, onOpenUser, helpers }: { client: AdminClient; onOpenUser: (id: string) => void; helpers: ActionHelpers }) {
  const live = useResource(() => client.get<{ rooms: AdminRoomSummary[]; online: PublicUser[] }>("/rooms"), [client], 5_000);

  if (!live.data) return live.error ? <ErrorNote message={live.error} onRetry={live.refresh} /> : <Loading />;
  const { rooms, online } = live.data;

  return (
    <div className="adm-stack">
      <Panel title="Multiplayer rooms" subtitle={`${rooms.length} open · refreshes every 5s`} flush>
        {rooms.length === 0 ? <Empty>No rooms are open right now.</Empty> : (
          <div className="adm-rooms">
            {rooms.map((room) => (
              <article key={room.code} className="adm-room">
                <header>
                  <code className="adm-room-code">{room.code}</code>
                  <Badge tone={STATUS_TONE[room.status] ?? "neutral"}>{room.status}</Badge>
                  <span className="adm-muted adm-small">{room.kind === "quiz" ? room.categoryIds.join(", ") : room.kind}</span>
                </header>
                <p className="adm-small adm-muted">
                  {room.roundNumber !== null ? `Round ${room.roundNumber} of ${room.roundLimit}` : `${room.roundLimit} rounds`} · updated {formatRelative(room.updatedAt)}
                </p>
                <ul className="adm-room-players">
                  {room.players.map((player, index) => (
                    <li key={`${player.name}-${index}`} className={player.connected ? undefined : "is-away"}>
                      <span className={`adm-dot ${player.connected ? "is-on" : ""}`} aria-hidden />
                      {player.name}{player.isHost && <small> host</small>}
                      <span className="adm-room-score">{player.score}</span>
                    </li>
                  ))}
                </ul>
                <button type="button" className="adm-btn is-small is-danger" onClick={() => helpers.confirm({
                  title: `Close room ${room.code}?`,
                  body: <p>Ends the room for all {room.players.length} player{room.players.length === 1 ? "" : "s"}. They'll be sent back to multiplayer setup with a "closed by an admin" message.</p>,
                  confirmLabel: "Close room",
                  tone: "danger",
                  run: async () => { await client.send("DELETE", `/rooms/${encodeURIComponent(room.code)}`); helpers.notify(`Room ${room.code} closed.`); live.refresh(); },
                })}><DoorClosed size={14} aria-hidden /> Close room</button>
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Signed-in users online" subtitle="Anyone with the app open while signed in" flush>
        {online.length === 0 ? <Empty>Nobody signed in is online.</Empty> : (
          <ul className="adm-online">
            {online.map((user) => (
              <li key={user.id}>
                <button type="button" className="adm-chip-btn" onClick={() => onOpenUser(user.id)}>
                  <span className="adm-dot is-on" aria-hidden /> {user.avatarEmoji ? `${user.avatarEmoji} ` : ""}{user.username}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
