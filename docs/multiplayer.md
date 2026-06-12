# Multiplayer (as built)

Real-time, server-authoritative "race" rooms over a single WebSocket endpoint. One Bun process owns all game state; rooms live in memory and are lost on restart (acceptable for casual play — there is no room persistence).

## Topology

- WebSocket endpoint: `GET /ws` on the same Bun process that serves the app and API (`server/index.ts`).
- The upgrade is authenticated from the session cookie. A signed-in player's display name overrides whatever name the client sends, so room rosters show real account names.
- `ALLOWED_ORIGINS` (when set) restricts which origins may open the socket.

## Race model

Everyone in a room sees the same prompt stream (flags or any other category) in the same seeded order. The first correct typed answer takes the round and the round closes immediately; wrong guesses never eliminate a player. Defaults (`server/rooms/Room.ts`):

| Setting | Default | Constant |
| --- | --- | --- |
| Rounds per game | 10 (capped at the available prompt count) | `DEFAULT_MULTIPLAYER_ROUND_LIMIT` |
| Round duration | 30s | `DEFAULT_ROUND_DURATION_MS` |
| Result reveal | 2s between rounds | `DEFAULT_RESULT_DISPLAY_MS` |
| Max players | 8 | `DEFAULT_MAX_PLAYERS_PER_ROOM` |

**Scoring** (`Room.calculatePoints`): `100 + min(streak, 10) * 10 + secondsRemaining`, where `secondsRemaining` is whole seconds left in the round when the answer lands. Faster answers and longer streaks score higher.

## Public vs private state

Clients only ever receive public round state — the prompt asset and timing — never the country name, code, aliases, or accepted answers. The answer is revealed only in `ROUND_ENDED`. The server alone decides correctness, the round winner, points, and when a round ends.

## Reconnection

On connect the server sends `SESSION_ASSIGNED { playerId, roomCode, sessionToken }`. If the socket drops, the client reconnects and sends `REJOIN_ROOM { roomCode, playerId, sessionToken }` to reclaim its seat and score instead of joining as a new player.

## Protocol

Defined in `src/core/multiplayer/protocol.ts` (the source of truth) and validated server-side before any state changes.

**Client → server (`ClientMessage`):** `CREATE_ROOM` (`playerName`, `categoryIds`), `JOIN_ROOM` (`roomCode`, `playerName`), `REJOIN_ROOM` (`roomCode`, `playerId`, `sessionToken`), `LEAVE_ROOM`, `SET_READY` (`ready`), `START_GAME`, `PLAY_AGAIN`, `SUBMIT_ANSWER` (`answer`, `clientSentAt`), `REQUEST_HINT`.

**Server → client (`ServerMessage`):** `SESSION_ASSIGNED`, `ROOM_SNAPSHOT`, `PLAYER_JOINED`, `PLAYER_LEFT`, `GAME_STARTED`, `ROUND_STARTED`, `ANSWER_ACCEPTED` (`playerId`, `points`), `ANSWER_REJECTED` (`reason`, sent only to the guesser), `ROUND_ENDED` (`answer`, `results`), `GAME_COMPLETED` (`results`), `ERROR`.

## Code map

| Concern | Location |
| --- | --- |
| Room state, round flow, scoring, prompt queue | `server/rooms/Room.ts` |
| Sockets, message routing, room create/join, TTL + empty-room cleanup, room/player limits | `server/rooms/RoomManager.ts` |
| Raw message parsing | `server/protocol/parseMessage.ts` |
| Strict client-message validation | `src/core/multiplayer/messageValidation.ts` |
| Protocol + public room/round types | `src/core/multiplayer/{protocol,roomTypes}.ts` |
| Browser transport (WS + mock) | `src/core/multiplayer/{webSocketTransport,mockTransport}.ts` |
| Lobby/game UI | `src/ui/screens/MultiplayerLobbyScreen.ts` |

## Safeguards

Incoming client messages are never trusted. Protections: strict message validation, origin allowlist (`ALLOWED_ORIGINS`), per-connection answer rate limit (`ANSWER_RATE_LIMIT_PER_SECOND`), max players per room (`MAX_PLAYERS_PER_ROOM`), max concurrent rooms (`MAX_ROOMS`), and idle-room TTL cleanup (`ROOM_TTL_SECONDS`, swept on a 250ms tick).

## Scaling note

Rooms are in-memory, so production runs a single always-on machine (`min_machines_running = 1`). Running multiple machines would split players of the same room across processes and break games; that would require shared room state (e.g. Redis) and sticky routing, which is not implemented.
