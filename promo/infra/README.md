# Promo infrastructure (Cloudflare)

The promo pipeline runs on Cloudflare, separate from the game (Fly.io). The only link is the admin's Promo tab,
which gets a short-lived token from the game and calls the promo service directly.

| Piece | What | Defined in |
|---|---|---|
| `locato-promo` Worker at `promo.locato.quest` | API + a timer every 4 h that tops up Buffer and records what was posted | `../worker/wrangler.jsonc` (deploy: `npm run worker:deploy`) |
| D1 `locato-promo` | Records: videos and their posts, content, voices and clips, music, runs, audit | Terraform (`storage.tf`) + schema `../worker/migrations/*.sql` |
| R2 `locato-social` (public, `media.locato.quest`) | Rendered videos (Buffer fetches them) and voice clips | Terraform (adopted as is; its custom domain stays in the dashboard) |
| R2 `locato-promo-private` | Licensed music, backups, Terraform state | Terraform (created by `./bootstrap`, then adopted) |
| Deploy token | Narrow token for GitHub Actions: the Worker, D1 and its route | Made in the dashboard (see *Automatic deploys*) |
| Secrets | `BUFFER_API_KEY`, `PROMO_SERVICE_TOKEN`, `PROMO_ADMIN_SECRET` | `./secrets` (Worker secrets, never in Terraform state) |

## One-time setup

### 1. A bootstrap API token

Cloudflare dashboard → My Profile → API Tokens → Create Token → **Custom token**:

| Scope | Permission | Access |
|---|---|---|
| Account | Workers R2 Storage | Edit |
| Account | D1 | Edit |
| Account | Workers Scripts | Edit |
| Account | Account Settings | Read |
| Zone (`locato.quest`) | Zone | Read |
| Zone (`locato.quest`) | Workers Routes | Edit |
| Zone (`locato.quest`) | DNS | Edit |

Put it in `promo/.env` as `CLOUDFLARE_API_TOKEN` (replacing the old one), with `CLOUDFLARE_ACCOUNT_ID`.
Terraform keeps its state in R2 and uses this same token for that (an R2-capable token doubles as S3 credentials).

### 2. Create and adopt the resources

```bash
cd promo/infra
./bootstrap          # private bucket, zone id, terraform init, then a plan: check it adopts locato-social without changes
./tf apply           # D1 database
./sync-wrangler      # copies the D1 id into worker/wrangler.jsonc
```

### 3. Schema, secrets, deploy

```bash
cd promo
npm run worker:migrate      # D1 tables
infra/secrets               # generates PROMO_SERVICE_TOKEN + PROMO_ADMIN_SECRET (in .env), stores all three Worker secrets
npm run worker:deploy       # the Worker, its timer, and promo.locato.quest
curl https://promo.locato.quest/health
```

### 4. Connect the admin (restarts the game)

```bash
fly secrets set -a locato PROMO_API_URL=https://promo.locato.quest PROMO_ADMIN_SECRET=<PROMO_ADMIN_SECRET from promo/.env>
```

Then open the admin → **Promo**. From the Mac: `npm run queue`, `npm run voices`, `npm run content -- pull` all talk to the service.

After this, the old R2 S3 keys (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) aren't used by anything: delete them from `.env`
and revoke them in the dashboard.

## Automatic deploys (GitHub Actions)

- `.github/workflows/promo-deploy.yml`: on pushes to `main` that touch the promo service (`promo/worker`, `promo/src/content`,
  `promo/content`, the posting code, or promo's dependencies) it typechecks, applies D1 migrations, deploys the Worker and
  checks `/health`. You can also run it by hand (Actions → Deploy promo service → Run workflow).
- The game's two deploy workflows ignore `promo/**`, so promo-only merges don't restart the game.
- Infrastructure (this folder) stays manual: `./tf plan`, then `./tf apply`.

It needs two repository secrets. Create a **narrow deploy token** (Cloudflare → Manage account → Account API Tokens →
Create → Custom), no expiry or a long one:

| Scope | Permission | Access |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | D1 | Edit |
| Account | Account Settings | Read |
| Zone (`locato.quest`) | Workers Routes | Edit |

Then, from the repo root (paste the token when asked; the account id is in `promo/.env`):

```bash
gh secret set PROMO_CLOUDFLARE_DEPLOY_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
```

It can't touch buckets, DNS or tokens. Your setup token is only needed for `./tf` and can expire.

## Day to day

- Change resources: edit the `.tf` files, `./tf plan`, `./tf apply`.
- Change the schema: add `worker/migrations/000N_….sql`, then `npm run worker:migrate`.
- Change the Worker: `npm run worker:deploy`. Logs: `npx wrangler tail --config worker/wrangler.jsonc`.
- Local development: `npm run worker:dev` (local D1 + R2 simulation, secrets from `worker/.dev.vars`), then point the
  tools at it with `PROMO_API_URL=http://localhost:8787`.

Buckets and the database have `prevent_destroy`: Terraform refuses to delete them.
