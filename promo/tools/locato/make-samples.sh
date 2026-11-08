#!/usr/bin/env bash
# One voiced sample video per format: videos/sample-<kind>.json -> out/sample-<kind>.mp4
set -e
cd "$(dirname "$0")/../.."
for k in flags shapes capitals capital-of codes colours which spot find pin route split mix; do
  npm run -s new -- quiz --kind "$k" --seed "sample-$k" --name "sample-$k" | grep -E "✓|voice|⚠" || true
done
npm run -s new -- quiz --kind flags --mode one-life --seed sample-onelife --name sample-onelife | grep -E "✓|voice|⚠" || true
npm run -s render -- videos/sample-{flags,shapes,capitals,capital-of,codes,colours,which,spot,find,pin,route,split,mix,onelife}.json | grep "✓"
