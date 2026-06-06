# Fly.io Hosting Plan for locato

## Recommended shape

Run `locato` as a single small Fly.io app:

```text
https://locato.quest
  ├─ static Vite frontend from dist/
  └─ /ws WebSocket multiplayer endpoint
```

One Bun process should serve both:

```text
GET /              -> dist/index.html
GET /assets/...    -> dist/assets/...
GET /health        -> ok
WS  /ws            -> multiplayer rooms
```

This keeps the first production deployment simple:

- one Fly app
- one Machine
- one region
- one origin/domain
- no CORS between frontend and multiplayer
- no database
- no Redis
- no persistent volume

## Initial production configuration

Recommended first size:

```text
shared-cpu-1x
512 MB RAM
1 Machine
1 region
always running
```

Why:

- enough headroom for Bun, room state, logs, and WebSocket connections
- still very cheap
- avoids cold-starts and room loss from stop-to-zero
- simpler than multi-machine room coordination

Ultra-cheap option:

```text
shared-cpu-1x
256 MB RAM
1 Machine
```

Use 256 MB only after checking runtime memory under load.

## Expected cost

Based on Fly.io pricing provided:

| Resource | Estimated cost |
|---|---:|
| 1x shared-cpu-1x, 512 MB | $3.19/month |
| Bandwidth, North America/Europe | $0.02/GB outbound |
| Shared IPv4 | Included |
| Anycast IPv6 | Included |
| First 10 single-host SSL certs | Free |
| Volumes | $0, not used |
| Postgres | $0, not used |
| Redis/extensions | $0, not used |

Expected early monthly bill:

```text
~$3–6/month
```

Examples:

```text
10 GB outbound  -> +$0.20
50 GB outbound  -> +$1.00
100 GB outbound -> +$2.00
```

Cheapest always-on estimate:

```text
shared-cpu-1x 256 MB -> $1.94/month + bandwidth
```

More headroom:

```text
shared-cpu-1x 1 GB -> $5.70/month + bandwidth
shared-cpu-2x 1 GB -> $6.39/month + bandwidth
```

## What needs to be built before full multiplayer deploy

Current repo has:

- static Vite frontend
- pure game engine
- typed multiplayer protocol
- mock multiplayer transport/lobby shell

Still needed:

```text
server/
  index.ts
  rooms/
    Room.ts
    RoomManager.ts
  protocol/
    parseMessage.ts
    handlers.ts
```

Server responsibilities:

- serve static frontend from `dist/`
- accept WebSocket upgrades at `/ws`
- create rooms
- join rooms by room code
- track players and ready state
- start games
- choose current country privately
- validate submitted answers server-side
- assign points and round winners
- broadcast public room/round state
- end rounds and games
- clean up empty/stale rooms

## Server model

The first real multiplayer backend should keep rooms in memory.

```text
RoomManager
  Map<roomCode, Room>
  WeakMap<socket, PlayerSession>

Room
  code
  seed
  modeId
  status
  players
  currentRound
  game state
```

This is enough for casual multiplayer. If the process restarts, active rooms disappear. That is acceptable for the first version.

Add Redis only when multiple Machines or cross-region room state are required.

Add Postgres only when durable features exist:

- accounts
- profiles
- leaderboards
- match history
- moderation/admin tools

## Minimal Bun server shape

```ts
Bun.serve({
  port: Number(process.env.PORT ?? 3000),

  fetch(request, server) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(request);
      return upgraded ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    return serveStaticFromDist(url);
  },

  websocket: {
    open(socket) {
      roomManager.attach(socket);
    },

    message(socket, rawMessage) {
      roomManager.handleMessage(socket, rawMessage);
    },

    close(socket) {
      roomManager.detach(socket);
    },
  },
});
```

## `fly.toml`

Recommended first config:

```toml
app = "locato-quest"
primary_region = "ams"

[env]
  NODE_ENV = "production"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

Cost-minimized config:

```toml
[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

Stop-to-zero config, not recommended for active room-based multiplayer:

```toml
[http_service]
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0
```

Reason to avoid stop-to-zero initially:

- first request after idle has cold-start delay
- in-memory rooms disappear when the Machine stops
- WebSocket games expect the server to remain alive while rooms exist

## Dockerfile

```dockerfile
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
EXPOSE 3000
CMD ["bun", "server/index.ts"]
```

This can be tightened later once the server code is finalized.

## Environment variables

```text
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=https://locato.quest,https://www.locato.quest
ROOM_TTL_SECONDS=7200
MAX_PLAYERS_PER_ROOM=8
MAX_ROOMS=500
ANSWER_RATE_LIMIT_PER_SECOND=5
```

If frontend and WebSocket are same-origin, the browser can derive the WebSocket URL:

```ts
const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${protocol}//${location.host}/ws`;
```

No `VITE_MULTIPLAYER_WS_URL` is required for same-origin Fly hosting.

## Deployment commands

Initial setup:

```sh
fly auth login
fly launch --name locato-quest --region ams --no-deploy
fly scale vm shared-cpu-1x --memory 512
```

Deploy:

```sh
npm test
npm run build
fly deploy
```

Open/logs:

```sh
fly open
fly logs
```

Add domain:

```sh
fly certs add locato.quest
```

Then configure DNS as instructed by Fly.

## Production safeguards

Before making multiplayer public, add:

- strict message parsing/validation
- origin allowlist
- max WebSocket message size
- answer submission rate limit
- room creation rate limit
- max players per room
- max room count
- room TTL cleanup
- empty room cleanup
- `/health` endpoint
- structured logs for room lifecycle and errors

Incoming client messages must never be trusted. The server decides:

- whether an answer is correct
- who won a round
- points awarded
- when a round ends
- final results

## Scaling path

### Stage 1 — Single Machine

```text
1 Machine
in-memory rooms
same-origin frontend + /ws
```

Expected cost:

```text
~$3–6/month
```

### Stage 2 — Larger Machine

If CPU/memory becomes tight:

```sh
fly scale vm shared-cpu-2x --memory 1024
```

Approximate cost from provided pricing:

```text
shared-cpu-2x 1 GB -> $6.39/month + bandwidth
```

### Stage 3 — Multiple Machines

Only do this when one Machine is not enough.

Requires one of:

- sticky room routing
- Redis-backed room state
- region-local room ownership with routing

Without shared state, two Machines can split players for the same room and break multiplayer.

### Stage 4 — Persistent services

Add only when features require them:

```text
Redis       -> multi-machine rooms, pub/sub, distributed rate limits
Postgres    -> accounts, leaderboards, match history
Object store -> user uploads or generated assets
```

## Reservation decision

Fly shared Machine reservation from provided pricing:

```text
$36/year upfront
$5/month shared compute credit
```

For the recommended 512 MB Machine:

```text
$3.19/month compute
```

A reservation would cover the compute, but savings are small at this scale. Skip reservations until usage is stable.

## Recommendation

Start with:

```text
single Fly app
Bun server
shared-cpu-1x
512 MB RAM
one region
always on
in-memory rooms
no database
no Redis
no volumes
```

Expected bill:

```text
~$3.19/month compute
+ $0.02/GB outbound in North America/Europe
```

Practical early total:

```text
~$3–6/month
```
