import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('npm run loadtest -- [traffic|solo|multiplayer] [smoke|baseline|ramp|spike|soak] [--dry-run]\nConfiguration: BASE_URL, UNITS, PLAYERS_PER_ROOM, ANALYTICS=0, SESSION_SECONDS, HTTP_P95_MS. See docs/load-testing.md.');
  process.exit(0);
}
const positional = args.filter(arg => arg !== '--dry-run');
if (positional.length > 2 || args.some(arg => arg.startsWith('--') && arg !== '--dry-run')) throw new Error('Unknown arguments; use --help');
const env = { ...process.env, TEST_SCENARIO: positional[0] || process.env.TEST_SCENARIO || 'traffic', PROFILE: positional[1] || process.env.PROFILE || 'smoke' };
const cfg = config(env);
console.log(JSON.stringify({ ...cfg, unitMeaning: cfg.scenario === 'multiplayer' ? 'rooms (each with PLAYERS_PER_ROOM sockets)' : 'virtual users (paced loops)', peakSockets: cfg.scenario === 'multiplayer' ? (cfg.profile === 'smoke' ? 1 : cfg.units) * cfg.players : 0 }, null, 2));
if (args.includes('--dry-run')) process.exit(0);
const runId = new Date().toISOString().replace(/\D/g, '');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = `loadtest/results/${runId}-${cfg.scenario}-${cfg.profile}`;
await mkdir(new URL(`../${output}/`, import.meta.url), { recursive: true });
await writeFile(new URL(`../${output}/run.json`, import.meta.url), JSON.stringify({ runId, startedAt: new Date().toISOString(), ...cfg }, null, 2) + '\n');
console.log(`Results: ${output}. Ctrl+C stops the test. Watch staging Fly metrics in a separate window.`);
const child = spawn('k6', ['run', '--summary-export', `${output}/summary.json`, '--out', `json=${output}/metrics.json.gz`, `loadtest/${cfg.scenario}.js`], {
  cwd: root, stdio: 'inherit', env: { ...env, RUN_ID: runId },
});
child.on('error', error => { console.error(error.code === 'ENOENT' ? 'k6 is not installed. On macOS: brew install k6' : error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
