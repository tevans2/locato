// A tiny cross-process lock, so parallel agents take turns on heavy or rate-limited work.
//   await withLock('render', async () => { ... })        one at a time
//   await withLock('elevenlabs', fn, {slots: 2})          at most two at a time
// Locks are folders in .locks/ (mkdir is atomic). A lock whose process has died is taken over.
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export async function withLock(name, fn, {slots = 1, poll = 3000} = {}) {
  const base = resolve(ROOT, '.locks');
  await mkdir(base, {recursive: true});
  let dir, waited = false;
  for (;;) {
    for (let i = 0; i < slots && !dir; i++) {
      const d = resolve(base, `${name}.${i}`);
      try {
        await mkdir(d);
        dir = d;
      } catch {
        const pid = Number(await readFile(resolve(d, 'pid'), 'utf8').catch(() => '0'));
        if (pid && !alive(pid)) await rm(d, {recursive: true, force: true}); // stale: owner died
      }
    }
    if (dir) break;
    if (!waited) console.log(`… waiting for a free "${name}" slot (another video is using it)`);
    waited = true;
    await new Promise((r) => setTimeout(r, poll));
  }
  await writeFile(resolve(dir, 'pid'), String(process.pid));
  const release = () => rm(dir, {recursive: true, force: true});
  const onExit = () => {
    release().finally(() => process.exit(1));
  };
  process.once('SIGINT', onExit);
  process.once('SIGTERM', onExit);
  try {
    return await fn();
  } finally {
    process.off('SIGINT', onExit);
    process.off('SIGTERM', onExit);
    await release();
  }
}

/** fetch with retries on 429 / 5xx / network errors, exponential backoff (honours Retry-After). */
export async function fetchRetry(url, init, {tries = 5, label = url} = {}) {
  for (let i = 1; ; i++) {
    let res, err;
    try {
      res = await fetch(url, init);
      if (res.status !== 429 && res.status < 500) return res;
    } catch (e) {
      err = e;
    }
    if (i >= tries) {
      if (res) return res;
      throw err;
    }
    const after = Number(res?.headers.get('retry-after'));
    const wait = (after > 0 ? after : 2 ** i * 2) * 1000;
    console.warn(`${label}: ${res ? `HTTP ${res.status}` : err.message}, retry ${i}/${tries - 1} in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
  }
}
