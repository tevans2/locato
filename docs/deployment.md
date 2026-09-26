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

### Release gate: staging must deploy before main

The `main-protect` ruleset (Settings → Rules) protects `main`:

- Changes land only through a pull request (merge commits only); no direct pushes, force pushes, or deletion.
- The PR's head commit must have a passing **Test, build, and deploy staging** check from GitHub Actions: that's the staging workflow job, which runs tests, deploys `locato-staging`, and then smoke-tests `/health`. In practice only `staging` → `main` PRs can carry that check.
- The branch must be up to date with `main`. If GitHub asks you to update it, merge `main` into `staging`, which redeploys staging and re-runs the check on the new commit.
- Repository admins can bypass the gate when merging a PR (GitHub records this); nobody can push to `main` directly.

Flow: feature branch → PR into `staging` → staging deploys and goes green → PR `staging` → `main` → production deploys.

A hotfix follows the same path, since the gate only waits for the staging deploy (a few minutes).

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
| `ADMIN_TOKEN` | Enables the admin console at `/admin` and the `/api/admin/*` API. Unset ⇒ both are hidden. Use a long random value (`openssl rand -hex 32`). |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth (optional). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (optional). |

`ADMIN_EVENT_RETENTION_DAYS` (optional, default `90`) controls how long the admin event log keeps rows.

OAuth callback URLs to register with each provider: `${BASE_URL}/auth/github/callback` and `${BASE_URL}/auth/google/callback`.

### GeoGuessr browser configuration

`VITE_GOOGLE_MAPS_JAVASCRIPT_API_KEY` is a **build-time** browser key. Solo GeoGuessr uses Maps JavaScript API for both the guess map and native Street View; the latter replaces the cropped Maps Embed iframe. Enable Maps JavaScript API and billing, and restrict the key to the deployed HTTP referrers. If this variable is empty, the client falls back to `VITE_GOOGLE_MAPS_EMBED_API_KEY`, which must also permit Maps JavaScript API. Street View Country continues to use Maps Embed API.

Native panoramas use Google's [Dynamic Street View billing SKU](https://developers.google.com/maps/billing-and-pricing/sku-details), so the new solo view has different usage costs from an Embed panorama. Review the project's quotas and budget before deploying. The Fly workflows already pass both browser keys as Docker build arguments; changing a runtime secret alone does not update an existing frontend bundle.

Without a browser key, GeoGuessr displays a recoverable unavailable screen. For local layout checks without Google requests, `/tests/fixtures/geoguessr.html` mounts the real game UI with labeled sample surfaces; this fixture is excluded from the production build.

## Sizing & scaling

Each app is `shared-cpu-1x` / 512 MB — ample for Bun, room state, and WebSocket connections at this scale. Scaling vertically (`fly scale vm shared-cpu-2x --memory 1024`) is the next step if CPU/memory gets tight. Horizontal scaling (multiple machines) is **not** supported as-is: in-memory rooms and the in-process `RoomManager` assume a single machine; multi-machine would require shared room state (Redis) and sticky routing. Postgres would only be needed if SQLite-on-volume becomes a bottleneck.
