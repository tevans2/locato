# locato

locato is a dark-mode geography game: read flags and other prompt categories, name and place every country on a world map, and race others in real-time multiplayer. Signed-in players get persistent stats and per-mode best-time leaderboards.

The frontend is a vanilla-DOM/Vite app built on a browser-independent game engine (typed country indexing, deterministic seeded rounds, local-save persistence). The backend is a single Bun process that serves the built frontend, exposes the HTTP/JSON API, runs server-authoritative WebSocket multiplayer, and persists accounts/stats/leaderboards to SQLite.

## Stack

- **Frontend:** TypeScript, Vite, vanilla DOM, per-area CSS, Vitest.
- **Backend:** Bun (`Bun.serve` + `bun:sqlite` + `Bun.password`), WebSocket multiplayer.
- **Deploy:** Fly.io (prod `locato`, staging `locato-staging`), SQLite on a persistent volume.

No web framework and no runtime npm dependencies — only built-in Bun/Node APIs.

## Run locally

Install once:

```sh
npm install
```

**Frontend only (fast iteration, NO API):**

```sh
npm run dev
```

Serves the Vite dev server. Accounts, stats, leaderboards, and multiplayer call the backend and will fail here — use this only for pure UI/gameplay work.

**Full app (frontend + API + multiplayer):**

```sh
npm run build   # tsc --noEmit && vite build  → dist/
npm run serve   # bun server/index.ts  → http://localhost:3000
```

`npm run serve` serves the built `dist/` plus the API and WebSocket endpoint. SQLite auto-creates at `./.data/locato.db`. Session cookies are marked `Secure` only when `NODE_ENV=production`, so plain `http://localhost` works in dev.

## Test and build

```sh
npm test          # vitest run
npm run build     # type-check + production build
```

Tests run under Node, so `bun:sqlite` and `Bun.password` are kept behind interfaces (`UserStore` / `PasswordHasher`) and never imported by the test graph; an in-memory store backs the auth/leaderboard/admin tests.

## Configuration

All configuration is via environment variables (none required for basic local play):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket listen port. |
| `DATABASE_PATH` | `./.data/locato.db` | SQLite file location (a Fly volume in deploys). |
| `SESSION_TTL_DAYS` | `30` | Session lifetime. |
| `NODE_ENV` | — | `production` marks session cookies `Secure`. |
| `BASE_URL` | `http://localhost:$PORT` | Public origin; used to build OAuth callback URLs. |
| `ALLOWED_ORIGINS` | _(allow all)_ | Comma-separated origin allowlist for the WebSocket upgrade. |
| `ADMIN_TOKEN` | _(unset → admin API disabled)_ | Credential for `/api/admin/*` (`Authorization: Bearer` or `x-admin-token`). |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | — | Enables GitHub OAuth. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Enables Google OAuth. |
| `MAX_PLAYERS_PER_ROOM` | `8` | Multiplayer room cap. |
| `MAX_ROOMS` | `500` | Concurrent room cap. |
| `ROOM_TTL_SECONDS` | `7200` | Idle-room expiry. |
| `ANSWER_RATE_LIMIT_PER_SECOND` | `5` | Per-connection answer throttle. |

OAuth is optional — email/password works without any provider configured. Callback URLs are `${BASE_URL}/auth/github/callback` and `${BASE_URL}/auth/google/callback`.

## Project structure

```text
src/
  core/           Browser-independent logic
    countries/    Country data, indexing, normalization, validation
    game/         Seeded game engine (commands/events/state)
    categories/   Prompt categories (e.g. flags) for the solo game
    map/          World-map projection + country-guessing data
    timer/        World-map play timer + best-time → leaderboard sync
    multiplayer/  Typed protocol, message validation, WS transport
    auth/         Client auth/stats/leaderboard fetch helpers + avatars
  app/            Routing/controller layer (App.ts, router.ts)
  ui/             Vanilla DOM screens, components, renderers
  storage/        Versioned local persistence and settings
  styles/         Dark UI, CSS split by area
public/assets/    Flag SVGs (flags/), country outlines (country-shapes/), world-map.json

server/
  index.ts        Bun.serve: static dist + API + WebSocket wiring
  auth/           AuthService, HTTP routes, sessions/cookies, OAuth,
                  password hashing, in-memory + SQLite stores
  db/database.ts  bun:sqlite UserStore (users, sessions, stats,
                  leaderboard best times) with cascading deletes
  leaderboard/    Leaderboard mode/variant validation
  rooms/          Server-authoritative multiplayer Room + RoomManager
  protocol/       Raw WebSocket message parsing
```

## HTTP API

JSON over HTTP; session is an `HttpOnly` cookie set on register/login.

- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (returns `{ user, stats }`), `PATCH /auth/avatar`, and OAuth redirects `GET /auth/{github,google}` + `…/callback`.
- **Stats:** `POST /api/games` records a finished game and returns the updated aggregate (`games`, `correctAnswers`, `wrongAnswers`, `bestStreak`).
- **Leaderboards:** `GET /api/leaderboard?mode=&variant=&limit=&offset=`, `POST /api/leaderboard` (submit a best time).
- **Multiplayer:** WebSocket at `GET /ws`, authenticated from the session cookie at upgrade time.
- **Health:** `GET /health`.

### Admin account controls

Gated by `ADMIN_TOKEN` (`Authorization: Bearer <token>` or `x-admin-token: <token>`). While the variable is unset the entire surface is hidden — requests fall through to `404`; with it set, missing/wrong credentials get `403`. Password hashes are never returned.

| Method | Path | Effect |
| --- | --- | --- |
| `GET` | `/api/admin/users?q=&limit=&offset=` | List/search users (`{ total, users[] }`). |
| `GET` | `/api/admin/users/:id` | User detail + stats. |
| `DELETE` | `/api/admin/users/:id` | Delete a user; cascades sessions, OAuth links, stats, and leaderboard times. |
| `DELETE` | `/api/admin/users/:id/sessions` | Revoke all sessions (force-logout) without deleting the account. |

## Architecture rules

- The game engine never references `window`, `document`, `localStorage`, or `WebSocket`; rules are tested as plain TypeScript.
- Country state uses stable IDs/codes, never display names.
- Round order is seeded and deterministic (repeatable tests, fair multiplayer).
- Multiplayer is server-authoritative: the server owns room state, current country, answer validation, scoring, and timing; clients render public round state only.
- Persistence lives behind the `UserStore` interface so `bun:sqlite` stays out of the Node test graph.

## Deployment

Deployed to Fly.io: prod app `locato` and staging `locato-staging`, each a single Bun process with SQLite on a mounted volume. See **[`docs/deployment.md`](docs/deployment.md)** for the full runbook (Docker image, CI workflows, volume creation, and secrets).

## More docs

- **[`docs/multiplayer.md`](docs/multiplayer.md)** — server-authoritative multiplayer: race model, scoring, protocol contract, and code map.
- **[`docs/deployment.md`](docs/deployment.md)** — Fly.io deployment and operations.
- **[`CATEGORY_IDEAS.md`](CATEGORY_IDEAS.md)** — forward-looking backlog of prompt-category ideas (not yet implemented).