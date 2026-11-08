# Locato promo videos

Remotion templates and tools that turn Locato's game data into short videos, and the **promo service** that posts them.
Its own package: run everything from this folder (`cd promo`). The game never depends on it, and it's excluded
from the game's Docker image. Full guide: `VIDEOS.md`. Posting: `social/profile-setup.md` → Automatic posting.

## Rules
- **This repo is public.** Never commit keys (`.env`, `.claude/settings.local.json`), Mixkit music
  (`public/locato/music/`: the licence forbids sharing the files) or the research report. Check `git status` before committing.
- Game data comes from the repo itself: `npm run locato:sync` copies it into `public/locato/` (gitignored). Don't edit those copies.
- Content rules: no Street View imagery and no "GeoGuessr" name in promos; no made-up stats in hooks or captions;
  hook E ("Beat my score") only with a real score; Mixkit music only in promo videos, never inside the game.
- TikTok posts: never set the AI-generated label (`isAiGenerated` stays false), as the owner decided.
- Rendering and voice are heavy: they run on the Mac, never on the game server.
- Voice clips are made on the Mac (or recorded by a person) and uploaded to the R2 voice library (`npm run voices`); the server only reads them.

## Structure
- A video = a **recipe** (`src/content/types.ts`) compiled by `src/content/compile.ts` into a spec (`videos/<name>.json`) that a template renders.
  `src/content/` must stay free of Node APIs (the admin will run it in the browser); file access goes through `tools/locato/env.ts`.
- Text is data: hooks, spoken lines, outros and captions are phrases in `content/phrases.json` (+ online items in the promo service), never hard-coded.
- **Promo and the game stay decoupled.** The promo service (`worker/`: Cloudflare Worker + D1 + R2, infra in `infra/` as Terraform) has its own
  records, files and deploys. The only links: the game's admin mints short-lived tokens (`server/admin/promoToken.ts`, shared
  `PROMO_ADMIN_SECRET`) and its Promo tab (`src/admin/views/Promo.tsx`) calls the service from the browser. The game server
  never calls the promo service, and the promo service never touches the game's database (results are joined in the browser).
- The Mac tools reach the service only through its API (`PROMO_SERVICE_TOKEN`); they don't need R2 or Cloudflare keys.
- New game mode = a `ModeDef` in `src/content/modes/` + its renderer in `templates/Quiz.tsx`.
- Keep compile output stable: after touching `src/content`, compare specs from fixed seeds before/after (`--seed x --print`).

## Common commands
- `npm run new -- quiz --kind flags [--from continent:asia --exclude FR --pick chad --print]` · `npm run new:week` · `npm run render -- videos/<name>.json`
- `npm run content [-- list|validate|pull|push|schema]` · `npm run voices [-- create|add|import|from-spec|missing|apply|ls|rm]`
- `npm run stage -- videos/<week>-*.json` (queue for posting) · `npm run queue` · `npm run publish -- videos/x.json` (post now)
- `npm run worker:dev` (local service) · `npm run worker:migrate` · `npm run worker:deploy` · infra: `infra/README.md`
- Deploys: the promo service deploys from `main` via `.github/workflows/promo-deploy.yml`; the game's deploys ignore `promo/**`. Terraform is manual.
