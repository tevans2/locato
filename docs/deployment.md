# Deployment (as built)

locato runs as a single Bun process per environment on Fly.io. That one process serves the built frontend from `dist/`, the HTTP/JSON API, and the `/ws` multiplayer socket. Accounts/stats/leaderboards persist to SQLite on a mounted volume.

## Environments

| | Prod | Staging |
| --- | --- | --- |
| Fly app | `locato` | `locato-staging` |
| Config | `fly.toml` | `fly.staging.toml` |
| Region | `jnb` | `jnb` |
| Machines | always-on (`min_machines_running = 1`, `auto_stop_machines = "off"`) | scale-to-zero (`min_machines_running = 0`, `auto_stop_machines = "stop"`) |
| Public URL | custom domain `locato.quest` (Fly cert + Cloudflare DNS) | `locato-staging.fly.dev` |

Prod stays always-on because multiplayer rooms are in-memory — stopping the machine drops active games. Staging idles at $0; the trade-off is that a cold start resets in-memory rooms.

## Image

`Dockerfile` is multi-stage: `node:22-alpine` runs `npm ci && npm run build`, then `oven/bun:1-slim` runs the server. `dist/`, `server/`, and `src/` are copied into the runtime image (the server imports country data from `src/`), and the entrypoint is `bun server/index.ts` on port 3000.

## CI/CD

GitHub Actions deploy on push (both run `npm test` then `npm run build` before deploying):

- `.github/workflows/fly-deploy.yml` — push to `main` → `flyctl deploy --config fly.toml --app locato`, using secret `FLY_API_TOKEN`.
- `.github/workflows/fly-deploy-staging.yml` — push to `staging` → `flyctl deploy --config fly.staging.toml` (targets `locato-staging`), using secret `FLY_API_TOKEN_STAGING`.

Manual deploy: `flyctl deploy --config fly.toml -a locato` (or `--config fly.staging.toml`).

## Persistent volume

SQLite lives on a Fly volume mounted at `/data`, with `DATABASE_PATH=/data/locato.db` set in each app's `[env]`. Create the volume **before the first deploy** of an app:

```sh
fly volumes create data -a locato --size 1 --region jnb          # prod
fly volumes create data -a locato-staging --size 1 --region jnb  # staging
```

## Secrets

Non-secret config (`NODE_ENV`, room limits, `DATABASE_PATH`) lives in each `[env]` block. Secrets are set per app with `fly secrets set NAME=value -a <app>` (this triggers a restart):

| Secret | Purpose |
| --- | --- |
| `BASE_URL` | Public origin (e.g. `https://locato.quest`); used to build OAuth callback URLs. |
| `ADMIN_TOKEN` | Enables the `/api/admin/*` account API. Unset ⇒ that surface is hidden. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth (optional). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (optional). |

OAuth callback URLs to register with each provider: `${BASE_URL}/auth/github/callback` and `${BASE_URL}/auth/google/callback`.

## Sizing & scaling

Each app is `shared-cpu-1x` / 512 MB — ample for Bun, room state, and WebSocket connections at this scale. Scaling vertically (`fly scale vm shared-cpu-2x --memory 1024`) is the next step if CPU/memory gets tight. Horizontal scaling (multiple machines) is **not** supported as-is: in-memory rooms and the in-process `RoomManager` assume a single machine; multi-machine would require shared room state (Redis) and sticky routing. Postgres would only be needed if SQLite-on-volume becomes a bottleneck.
