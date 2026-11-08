#!/usr/bin/env python3
"""Sequential staging campaign. Writes live and final reports; no third-party deps."""
import datetime as dt
import gzip
import fcntl
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
LOCK = (ROOT / 'loadtest/results/.campaign.lock').open('w')
try:
    fcntl.flock(LOCK, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit('Another load-test campaign is already running')
STAMP = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
OUT = ROOT / 'loadtest' / 'results' / ('campaign-' + STAMP)
OUT.mkdir(parents=True)
TARGET = 'https://locato-staging.fly.dev'
rows, notes = [], []
active = None
stopping = False


def stop(signum, frame):
    global stopping
    stopping = True
    if active and active.poll() is None:
        active.send_signal(signal.SIGINT)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)


def health():
    start = time.monotonic()
    try:
        with urllib.request.urlopen(TARGET + '/health', timeout=10) as response:
            ok = response.status == 200
        elapsed = time.monotonic() - start
        return ok and elapsed < 5, round(elapsed, 3)
    except Exception as error:
        return False, str(error)


def metric(row, name, key='value'):
    return row.get('metrics', {}).get(name, {}).get(key)


def fmt(value):
    return '—' if value is None else f'{value:.2f}'


def report(state):
    data = {'state': state, 'target': TARGET, 'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'runs': rows, 'notes': notes}
    (OUT / 'report.json').write_text(json.dumps(data, indent=2) + '\n')
    text = ['# Locato staging load-test campaign', '', f'**Status: {state}**',
            f'Target: {TARGET}', f'Updated: {data["updatedAt"]}', '',
            '## Scope and limitations', '',
            '- Sequential protocol tests, not browser or production traffic.',
            '- No Fly credentials/CLI: server CPU, RAM, restarts, image and machine size are NOT verified.',
            '- Independent health probe every 15 seconds; three consecutive errors or responses >=5s stop the campaign.',
            '- HTTP error/p95 and multiplayer failure abort thresholds remain enabled.',
            '- Units are concurrent users for HTTP and rooms for multiplayer (four sockets per room).',
            '- Full-run percentiles are not per-plateau results. Passing results are workload-specific, not total site capacity.',
            '- Analytics-enabled solo is capped at 20 users to avoid confusing per-IP limits with capacity.',
            '- Higher solo levels are separately labeled API-only and exclude SQLite analytics writes.',
            '- No mixed-workload test is included; isolated results cannot be added together.', '',
            '## Runs', '',
            '| Workload | Profile | Peak units | Result | HTTP p95 ms | Answer p95 ms | Errors % | 429 % | Iterations | Evidence |',
            '|---|---|---:|---|---:|---:|---:|---:|---:|---|']
    for r in rows:
        err = metric(r, 'request_errors')
        if err is None:
            err = metric(r, 'room_failures')
        rate = metric(r, 'rate_limited')
        text.append(f'| {r["workload"]} | {r["profile"]} | {r["units"]} | {r["result"]} | '
                    f'{fmt(metric(r, "http_req_duration{scenario:load}", "p(95)"))} | '
                    f'{fmt(metric(r, "answer_reply_ms", "p(95)"))} | '
                    f'{fmt(None if err is None else err * 100)} | {fmt(None if rate is None else rate * 100)} | '
                    f'{metric(r, "iterations", "count") or 0} | `{r.get("directory", r["log"])}` |')
    text += ['', '## Highest passing levels and first failures', '']
    for workload in ['traffic', 'solo+analytics', 'solo-api-only', 'multiplayer']:
        group = [r for r in rows if r['workload'] == workload]
        passing = [r for r in group if r['result'] == 'PASS' and r['profile'] in ('baseline', 'ramp')]
        failed = [r for r in group if r['result'] not in ('PASS', 'RUNNING')]
        high = max((r['units'] for r in passing), default=None)
        text.append(f'- **{workload}**: highest passing baseline/ramp peak: {high if high is not None else "not established"}'
                    + (' rooms (' + str(high * 4) + ' sockets)' if high and workload == 'multiplayer' else '') + '.')
        if failed:
            first = failed[0]
            text.append(f'  First failure: {first["profile"]}, peak {first["units"]}; {first["result"]}. '
                        f'Threshold details: {", ".join(first.get("failedThresholds", [])) or "see log"}. '
                        'This is a measured failure boundary, not necessarily a server resource limit; a failed ramp does not locate the exact breaking plateau.')
        else:
            text.append('  No breaking point observed in completed runs; do not extrapolate beyond the tested range.')
    text += ['', '## Campaign notes', ''] + ['- ' + n for n in notes]
    text += ['', '## Interpretation', '',
             'Use a repeated healthy baseline and server telemetry before making capacity claims. '
             'Spike/soak tests use at most half the highest passing baseline/ramp level. '
             'The first failure stops escalation for that workload. Rate limiting is not a CPU breaking point. '
             'No operating target is validated without a representative mixed workload and server resource observations.', '']
    temp = OUT / 'REPORT.md.tmp'
    temp.write_text('\n'.join(text))
    temp.replace(OUT / 'REPORT.md')


def analytics_used():
    """Count actual analytics events sent by all local runs in the last hour."""
    cutoff = time.time() - 3600
    count = 0
    for path in (ROOT / 'loadtest/results').glob('*/metrics.json.gz'):
        if path.stat().st_mtime < cutoff:
            continue
        try:
            with gzip.open(path, 'rt') as handle:
                for line in handle:
                    item = json.loads(line)
                    data = item.get('data', {})
                    if item.get('type') == 'Point' and item.get('metric') == 'http_reqs' and data.get('tags', {}).get('name') == 'analytics_write':
                        when = dt.datetime.fromisoformat(data['time'].replace('Z', '+00:00')).timestamp()
                        if when >= cutoff:
                            count += int(data['value']) * 3
        except (OSError, EOFError, ValueError):
            # Refuse to underestimate an active/partial analytics stream.
            count += 5000
    return count


def wait_budget(profile, units):
    # Conservative upper bound: all VUs active throughout, fastest valid iteration 26s,
    # plus graceful completion. Reserve 1000 events for other activity on this IP.
    seconds = {'smoke': 90, 'baseline': 360, 'ramp': 1350, 'spike': 370, 'soak': 1890}[profile]
    reserve = 3 * units * (math.ceil((seconds + 180) / 26) + 1)
    if reserve > 4000:
        raise RuntimeError(f'Analytics budget cannot safely accommodate {profile} at {units} users')
    waiting = False
    while not stopping and analytics_used() + reserve > 4000:
        if not waiting:
            notes.append(f'Waiting for rolling one-hour analytics budget before {profile}/{units}; reserve {reserve} events.')
            report('WAITING FOR ANALYTICS BUDGET')
            waiting = True
        time.sleep(30)
    return not stopping


def run(workload, profile, units):
    global active, stopping
    if stopping:
        return False
    if workload == 'solo+analytics' and not wait_budget(profile, units):
        return False
    ok, latency = health()
    if not ok:
        notes.append(f'Preflight health failed ({latency}); campaign stopped without increasing load.')
        stopping = True
        return False
    scenario = 'solo' if workload.startswith('solo') else workload
    number = len(rows) + 1
    log = OUT / f'{number:02d}-{workload}-{profile}-{units}.log'
    row = {'workload': workload, 'profile': profile, 'units': units, 'result': 'RUNNING',
           'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'log': str(log.relative_to(ROOT))}
    rows.append(row)
    report('RUNNING')
    env = dict(os.environ, BASE_URL=TARGET, UNITS=str(units), PLAYERS_PER_ROOM='4',
               ANALYTICS='0' if workload == 'solo-api-only' else '1', HTTP_P95_MS='1000',
               SESSION_SECONDS='60', K6_NO_COLOR='true', NO_COLOR='1')
    bad = 0
    probes = []
    with log.open('w') as handle:
        active = subprocess.Popen(['node', 'loadtest/run.mjs', scenario, profile], cwd=ROOT,
                                  env=env, stdout=handle, stderr=subprocess.STDOUT)
        start = time.monotonic()
        stop_started = None
        while active.poll() is None:
            time.sleep(1)
            if stopping:
                if stop_started is None:
                    stop_started = time.monotonic()
                    active.send_signal(signal.SIGINT)
                elif time.monotonic() - stop_started > 30:
                    # The launcher and generator share our process group; terminate
                    # only the launcher's child tree, not the orchestrator itself.
                    subprocess.run(['pkill', '-TERM', '-P', str(active.pid)], check=False)
                    active.terminate()
                continue
            if time.monotonic() - start >= (len(probes) + 1) * 15:
                good, elapsed = health()
                probes.append({'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'ok': good, 'latency': elapsed})
                bad = 0 if good else bad + 1
                if bad >= 3:
                    notes.append(f'Health circuit breaker triggered during {workload}/{profile}/{units}. Entire campaign stopped.')
                    stopping = True
                    active.send_signal(signal.SIGINT)
    row['exitCode'] = active.returncode
    row['healthProbes'] = probes
    row['finishedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
    output = log.read_text()
    match = re.search(r'Results: (loadtest/results/[^.\s]+)\.', output)
    if match:
        row['directory'] = match.group(1)
        summary = ROOT / row['directory'] / 'summary.json'
        if summary.exists():
            row['metrics'] = json.loads(summary.read_text()).get('metrics', {})
    row['failedThresholds'] = [name + ': ' + threshold for name, data in row.get('metrics', {}).items()
                               for threshold, failed in data.get('thresholds', {}).items() if failed]
    row['result'] = 'PASS' if (row['exitCode'] == 0 and metric(row, 'iterations', 'count') and
                              metric(row, 'checks', 'passes') and not row['failedThresholds'] and not stopping) else 'FAIL'
    interrupted = re.search(r'(\d+) interrupted iterations', output)
    if interrupted and int(interrupted.group(1)):
        row['result'] = 'INCOMPLETE'
    if stopping:
        row['result'] = 'STOPPED'
    report('RUNNING' if not stopping else 'STOPPED')
    active = None
    # Recover between runs; never escalate a failed workload.
    if not stopping:
        time.sleep(30)
    return row['result'] == 'PASS'


def main():
    notes.append('Automatic campaign started. Existing manual runs are retained as separate evidence, not included as campaign passes.')
    report('STARTING')
    workloads = ['traffic', 'solo+analytics', 'multiplayer', 'solo-api-only']
    eligible = {}
    for workload in workloads:
        eligible[workload] = run(workload, 'smoke', 1)
        if stopping:
            return
    for workload in workloads:
        if not eligible[workload]:
            continue
        initial = 1 if workload == 'multiplayer' else 5
        if not run(workload, 'baseline', initial):
            continue
        highest = initial
        peak = 5 if workload == 'multiplayer' else 20
        if run(workload, 'ramp', peak):
            highest = peak
            # Keep full analytics below the per-IP rate limit; API-only explores higher solo load.
            levels = [] if workload == 'solo+analytics' else ([10, 20, 40, 80, 100] if workload == 'multiplayer' else [40, 80, 100])
            for units in levels:
                if stopping or not run(workload, 'baseline', units):
                    break
                highest = units
        if stopping:
            return
        safe = max(1, highest // 2)
        # Revalidate a lower level before burst/long-running tests, even after a failed escalation.
        if run(workload, 'baseline', safe) and run(workload, 'spike', safe):
            run(workload, 'soak', safe)
        if stopping:
            return
    notes.append('Scheduled campaign complete. Any untested higher levels remain unknown; failures were not bypassed.')


if __name__ == '__main__':
    print(OUT, flush=True)
    try:
        main()
    except Exception as error:
        notes.append(f'Orchestrator error: {type(error).__name__}: {error}')
        stopping = True
        if active and active.poll() is None:
            active.send_signal(signal.SIGINT)
            try:
                active.wait(timeout=120)
            except subprocess.TimeoutExpired:
                active.kill()
    finally:
        report('STOPPED / INCOMPLETE' if stopping else 'COMPLETE')
