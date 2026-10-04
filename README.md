# locato

locato is a dark-mode geography game: read flags and other prompt categories, name and place every country on a world map, and race others in real-time multiplayer. Signed-in players get persistent stats and per-mode best-time leaderboards.

The frontend is a vanilla-DOM/Vite app built on a browser-independent game engine (typed country indexing, deterministic seeded rounds, local-save persistence). The backend is a single Bun process that serves the built frontend, exposes the HTTP/JSON API, runs server-authoritative WebSocket multiplayer, and persists accounts/stats/leaderboards to SQLite.

## Stack

- **Frontend:** TypeScript, Vite, vanilla DOM, per-area CSS, Vitest.
- **Backend:** Bun (`Bun.serve` + `bun:sqlite` + `Bun.password`), WebSocket multiplayer.
- **Deploy:** Fly.io (prod `locato`, staging `locato-staging`), SQLite on a persistent volume.

The server uses Bun/Node APIs plus `@resvg/resvg-js` and `pngjs` to render private game clues.

Ranked games are validated and scored on the server. See [anti-cheat architecture and deployment](docs/anti-cheat.md), including the one-time quarantine of historical leaderboard entries and the limits of bot detection.

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

### Seed dev data

A fresh database has empty leaderboards, dailies and admin charts. Fill it with realistic, deterministic data:

```sh
npm run seed                 # seed or refresh ./.data/locato.db (or $DATABASE_PATH)
npm run dev:seeded           # seed, then start the server (bun server/index.ts)
npm run seed -- --reset      # delete every seed account first, then seed from scratch
npm run seed -- --clean      # delete every seed account and stop
npm run seed -- --seed=7     # a different (still deterministic) dataset
```

**Test user:** `tester@locato.test` / password `locato-dev` (username `tester`). Sign in on the landing page. The tester is mid-table on most boards, 3rd on Capitals (so the medals and "you" highlight show), has a 7-day daily streak (10 of the last 14 days), about 55 games of history, 5 friends plus one incoming and one outgoing request, and Academy progress with two groups mastered, a few started and some cards due for review. The ~40 seed players (for example `atlas_amy@seed.locato.test`) use the same password.

What gets seeded: best times on all 9 leaderboard modes, including the flag pools (countries, territories, both) and every puzzle continent; 14 days of daily results; 60 days of game history and sign-ins for the admin overview; and admin events. One player (`zoomzoom`) has an impossibly fast Codes time and daily so the admin "too fast" flags have something to show. The command prints a summary with row counts and the tester's ranks.

- **Re-running is safe.** Seed accounts keep their ids and their data is replaced, so nothing is duplicated and a signed-in tester stays signed in. Admin events are written once per database, because the store can't delete them.
- **Only seed accounts are touched.** That means emails on `@seed.locato.test` plus `tester@locato.test`. If a real account already has a seed username, that seed player is skipped. `--reset` and `--clean` delete only seed accounts.
- **Refuses anything production-like.** It won't run when `NODE_ENV=production`, when `FLY_APP_NAME`/`FLY_MACHINE_ID` is set, or when `DATABASE_PATH` is under `/data` (the Fly volume). It also refuses any path outside the project, your home directory or a temp directory.
- **Achievements** are stored per device in `localStorage`, so the seed can't write them. It prints a one-line `localStorage.setItem("locato.achievements.v1", …)` snippet; paste it into the browser console after signing in.

The seeding logic is in `server/dev/seed.ts` and writes through the `UserStore` API, so it also runs against the in-memory store in `tests/seedDev.test.ts`. `scripts/seed-dev.ts` is the Bun wrapper that opens SQLite.

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
| `ALLOWED_ORIGINS` | _(same origin)_ | Comma-separated origin allowlist for the WebSocket upgrade. |
| `ADMIN_EMAILS` | _(none)_ | Comma-separated emails of accounts that are always admins. Other admins are granted from the console. |
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

### Admin console

Admins sign in with their normal Locato account; the console uses the same session cookie as the game. `/api/admin/*` answers `401` without a session and `403` for an account without admin access (logged as `admin.unauthorized`). An account is an admin when its email is in `ADMIN_EMAILS` (how the first admin gets in; can't be revoked from the console) or when another admin granted it from **Users → a player → Make admin** (stored as `users.is_admin`). Admins can't remove their own access. Every admin action in the event log carries `adminId`/`adminName`. Password hashes and session tokens are never returned, and admin responses are `Cache-Control: no-store`.

**Panel:** open `/admin` and sign in with your email and password. Accounts that use GitHub or Google sign in on Locato first, then open `/admin`. Sections: Overview (30-day activity, deltas, top players, modes), Users (search, full dossier, rename, clear avatar, reset stats, sign out everywhere, delete), Leaderboards (daily results and best times with too-fast/backdated flags, remove entries), Live (open rooms, close a room, who's online), Event log, and System. In dev, run `npm run serve` with `ADMIN_EMAILS=<your email>` plus `npm run dev`, then open `/admin.html` on the Vite port.

**Event log:** every structured server log line (`logEvent` in `server/admin/events.ts`) is also written to the `admin_events` table and pruned after `ADMIN_EVENT_RETENTION_DAYS` (default 90), so history survives Fly's short stdout retention. It only records signed-in activity and server events; guest play isn't tracked.

| Method | Path | Effect |
| --- | --- | --- |
| `GET` | `/api/admin/overview` | Totals, 24h/7d/30d windows (+ prior 30d), 30-day daily series, modes, top players, live counts. |
| `GET` | `/api/admin/users?q=&limit=&offset=` | List/search users with sign-in methods, game/daily counts, last active. |
| `GET` | `/api/admin/users/:id` | Dossier: stats, recent games, dailies, best times, session timestamps, friends, events. |
| `PATCH` | `/api/admin/users/:id` | `{ displayName?, clearAvatar? }`: rename (username rules + uniqueness) / clear avatar. |
| `DELETE` | `/api/admin/users/:id` | Delete a user; cascades sessions, OAuth links, stats, games, dailies, times, friendships. |
| `DELETE` | `/api/admin/users/:id/sessions` | Revoke all sessions (force sign-out) without deleting the account. |
| `DELETE` | `/api/admin/users/:id/stats` | Clear game history and aggregates (leaderboards/dailies untouched). |
| `GET` | `/api/admin/leaderboards/meta` | Game modes and their variants. |
| `GET` | `/api/admin/leaderboards?mode=&variant=` | Best-time board with `suspicious` flags. |
| `DELETE` | `/api/admin/leaderboards/:userId?mode=&variant=` | Remove one best time. |
| `GET` | `/api/admin/daily?date=YYYY-MM-DD` | Daily results with `too-fast` / `backdated` flags. |
| `DELETE` | `/api/admin/daily/:userId/:date` | Remove one daily result. |
| `GET` | `/api/admin/rooms` | Open multiplayer rooms and signed-in users online. |
| `DELETE` | `/api/admin/rooms/:code` | Close a room (players get `room-not-found`). |
| `GET` | `/api/admin/events?level=&action=&ip=&userId=&before=&limit=` | Event log, newest first; `action` is a prefix, `before` is an id cursor. |
| `GET` | `/api/admin/system` | Uptime, memory, database size, limits, OAuth config, Street View pool. |

Every admin write is itself logged as an `admin.*` event with the caller's IP.

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