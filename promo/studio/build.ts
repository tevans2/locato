#!/usr/bin/env bun
// Build the Studio into studio-dist/ (served by the promo Worker as static assets):
//   studio-dist/studio/        the app (index.html + bundled JS)
//   studio-dist/locato/        the game data and pictures the templates load (from `npm run locato:sync`)
//   studio-dist/_headers       who may frame it (the admin), caching
// Needs public/locato from `npm run locato:sync`.
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const OUT = join(ROOT, 'studio-dist');
const PUB = join(ROOT, 'public/locato');
if (!existsSync(join(PUB, 'data.json'))) throw new Error('No game data: run npm run locato:sync first');
// the admin origins allowed to embed the Studio and hand it tokens: the same list the API allows (worker/wrangler.jsonc)
const wrangler = readFileSync(join(ROOT, 'worker/wrangler.jsonc'), 'utf8');
const origins = (/"ADMIN_ORIGINS":\s*"([^"]+)"/.exec(wrangler)?.[1] ?? 'https://locato.quest').split(',').map((s) => s.trim());

rmSync(OUT, {recursive: true, force: true});
mkdirSync(join(OUT, 'studio'), {recursive: true});
const r = await Bun.build({
  entrypoints: [join(ROOT, 'studio/main.tsx')],
  outdir: join(OUT, 'studio'),
  target: 'browser',
  minify: true,
  naming: 'app-[hash].js',
  define: {'process.env.NODE_ENV': '"production"', ADMIN_ORIGINS: JSON.stringify(origins)},
});
if (!r.success) throw new Error(r.logs.map(String).join('\n'));
const app = r.outputs.find((o) => o.kind === 'entry-point')!.path.split('/').pop()!;
writeFileSync(join(OUT, 'studio/index.html'), readFileSync(join(ROOT, 'studio/index.html'), 'utf8').replace('__APP__', app));
for (const p of ['data.json', 'map/world.json', 'map/extras.json', 'flags', 'shapes', 'sfx', 'logo.svg']) cpSync(join(PUB, p), join(OUT, 'locato', p), {recursive: true});
writeFileSync(join(OUT, '_headers'), `/studio/*\n  Content-Security-Policy: frame-ancestors ${origins.join(' ')}\n  Cache-Control: no-cache\n/locato/*\n  Cache-Control: public, max-age=3600\n`);
const kb = (r.outputs.reduce((s, o) => s + o.size, 0) / 1024).toFixed(0);
console.log(`✓ studio-dist: app ${app} (${kb} KB), game data, ${origins.length} admin origin(s) may embed it`);
