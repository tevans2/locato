#!/usr/bin/env bash
# Runs scripts/seed-filler.ts on a Fly app's machine against /data/locato.db.
#   scripts/seed-filler-fly.sh locato-staging            # add / refresh filler accounts
#   scripts/seed-filler-fly.sh locato --clean            # remove them
set -euo pipefail
app="${1:?usage: $0 <fly-app> [--clean|--dry-run]}"; shift
dir="$(cd "$(dirname "$0")" && pwd)"
b64="$(base64 < "$dir/seed-filler.ts" | tr -d '\n')"
# Wake a stopped machine so ssh has something to connect to.
curl -fsS -o /dev/null "https://$app.fly.dev/" || true
fly ssh console -a "$app" -C "sh -c 'echo $b64 | base64 -d > /tmp/seed-filler.ts && cd /app && DATABASE_PATH=/data/locato.db bun /tmp/seed-filler.ts $*'"
