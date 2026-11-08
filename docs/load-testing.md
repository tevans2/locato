# Load testing Locato

Run the k6 generator on your laptop or another machine, targeting staging. Run it
from this repository's root. The launcher defaults to `https://locato-staging.fly.dev`;
the scripts also permit HTTP localhost/127.0.0.1 for local development. Other targets,
including production, are rejected. HTTP redirects are disabled.

## First run on macOS

Install a current k6 release with the stable `k6/websockets` module, plus Node 22+:

```sh
brew install k6
k6 version
npm run loadtest:check
npm run loadtest -- traffic smoke --dry-run
npm run loadtest -- traffic smoke
npm run loadtest -- solo smoke
npm run loadtest -- multiplayer smoke
```

No npm dependencies are needed for this suite. The generator does not need Fly
credentials. Fly dashboard access is needed separately to watch the target machine.
Complete the three smoke runs before increasing load. They validate frontend asset
discovery, MapTap requests and analytics persistence, and a room's join/start/answer
flow. A smoke run uses one VU regardless of `UNITS`, followed by a 30-second ramp
down and time for active iterations to finish.

All scenarios warm `/health` once before measurement. Cold-start latency is not part
of their steady-state threshold. Test a cold start separately, observing the first
real page load after staging has stopped.

## Match the environment

Before collecting capacity numbers, record the staging deployment/image, machine
size, number of machines, volume size, database size, and the generator's location.
Use the same code and machine size as production: currently one shared vCPU and
512 MB, in Johannesburg. Staging has its own SQLite volume; production data is not
required. A small staging database can make database results optimistic compared
with a larger production database. Seed only staging/local test accounts if needed.

```sh
fly status -a locato-staging
fly machine status <staging-machine-id> -a locato-staging
fly logs -a locato-staging
```

Open Fly Metrics in another window. Note CPU, memory, network traffic, errors and
restarts at each plateau. Watch the generator's CPU/network too. Use wired networking
if possible, and repeat from the same location. Network latency from the laptop to
Johannesburg is included in k6's results. Shared CPU allocation can also vary; repeat
interesting results at another time rather than assuming one run is definitive.

## What each scenario measures

| Scenario | One VU represents | Requests/work | Default peak outside smoke |
| --- | --- | --- | --- |
| `traffic` | Repeated new arrivals | Landing page plus up to 10 same-origin JS/CSS/module-preload assets discovered from its HTML; then 12–18 seconds of idle time | 20 VUs |
| `solo` | Repeated guest MapTap sessions | Get a real target, think for 8–12 seconds, score a guess, write 3 analytics events, idle 18–22 seconds | 20 VUs |
| `multiplayer` | One active quiz room | Four guest sockets create/join a flags room, start 3 ten-second rounds, submit an intentionally wrong answer per player per round, replay after results | 5 rooms / 20 sockets |

Multiplayer uses the stable `k6/websockets` global event loop so the host and guests
run concurrently within one VU. It measures join readiness and answer reply latency,
and checks that games start and answers receive replies. Sessions last 60 seconds
and send `LEAVE_ROOM` before closing. Failures close all sockets for that room; the
server may retain an empty room until its normal cleanup sweep. Forced interruption
can also leave rooms until cleanup. Check Admin → Live between runs if necessary.

Analytics writes use the `loadtest` source and `capacity` campaign. The response must
confirm all 3 events were accepted; a bot-filtered `202` with zero writes fails a check.
Synthetic visitors will appear in **staging** Growth reports. No account registration,
login, leaderboard submission, personal data export or admin writes are performed.

These are protocol tests: k6 does not execute the frontend, render maps, or load the
full asset dependency graph like a browser. The traffic case repeatedly downloads
assets without browser cache reuse, approximating new visitors. The solo case covers
MapTap and the analytics SQLite write path, not every solo game. Multiplayer covers
guest quiz rooms, not Flyover's high-frequency position updates, signed-in presence,
ranked runs or ratings writes. Google Maps/Street View APIs are not called. Add those
workloads separately before making capacity claims about them.

## Profiles and configuration

`UNITS` is the peak HTTP VU count or multiplayer **room** count, not requests/second.
HTTP pacing means requests/second depends on response time and workload. In particular,
these closed-loop tests reduce throughput as the server slows; they do not prove the
server can accept a fixed arrival rate indefinitely.

| Profile | Shape, before final 30-second ramp to zero |
| --- | --- |
| `smoke` | 1 VU for 1 minute |
| `baseline` | 30-second ramp to `UNITS`, hold 5 minutes |
| `ramp` | Plateaus at 1, ceil(UNITS/4), ceil(UNITS/2), UNITS; each gets a 30-second ramp and a 5-minute hold |
| `spike` | 1 VU for 1 minute, 10-second rise to UNITS, hold 2 minutes, 30-second return to 1, hold 2 minutes |
| `soak` | 1-minute ramp to UNITS, hold 30 minutes |

Active iterations finish during graceful ramp-down, so actual active VUs/sockets can
lag target reductions. Use the observed metrics when interpreting a step.

Supported environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | staging origin | Staging or HTTP loopback origin only |
| `UNITS` | 20 HTTP, 5 multiplayer | Peak units, 1–100 |
| `PLAYERS_PER_ROOM` | 4 | 2–8; multiply rooms by this for peak sockets |
| `SESSION_SECONDS` | 60 | Multiplayer lifetime, 15–300 seconds |
| `ANALYTICS` | enabled | Set `0` to omit solo analytics writes |
| `HTTP_P95_MS` | 1000 | HTTP p95 threshold in milliseconds |

The launcher also accepts `TEST_SCENARIO` and `PROFILE` from the environment; positional
arguments take precedence. Use `--dry-run` to print the exact schedule without network
traffic. All settings are validated before k6 starts.

## Increase load deliberately

Start with a 5-user HTTP baseline, then a ramp to 20. Test solo separately so you can
distinguish static serving from API/database pressure. Run these commands one at a time:

```sh
UNITS=5 npm run loadtest -- traffic baseline
UNITS=20 npm run loadtest -- traffic ramp
UNITS=5 npm run loadtest -- solo baseline
UNITS=20 npm run loadtest -- solo ramp
UNITS=1 PLAYERS_PER_ROOM=4 npm run loadtest -- multiplayer baseline
UNITS=5 PLAYERS_PER_ROOM=4 npm run loadtest -- multiplayer ramp
```

If a plateau remains healthy, try a separate run with a higher peak, for example 40
HTTP VUs or 10 four-player rooms. Do not jump to the 100-unit cap without examining
lower stages. Repeat the last healthy plateau before increasing it.

Only after finding a stable level, test its burst and long-run behavior:

```sh
UNITS=20 npm run loadtest -- traffic spike
UNITS=5 npm run loadtest -- multiplayer soak
```

For a mixed workload, run HTTP and multiplayer in separate terminals at already
validated levels. Record both run IDs and the combined interval. This is a combined
stress experiment, not a measured real-world traffic mix. Adjust proportions using
actual production usage later.

## Stop criteria and rate limits

HTTP tests fail/abort after a 30-second evaluation delay if cumulative request errors
reach 1% or p95 crosses `HTTP_P95_MS`. Checks and rate-limit response thresholds must
also pass. Multiplayer aborts on a room failure rate of 1% after a 90-second delay;
readiness p95 must be under 5 seconds and answer reply p95 under 1 second. Counts must
confirm rounds and answers actually happened. These are initial test targets, not
promises about production latency.

Thresholds use cumulative data and k6 evaluates them periodically; they do not give
instant protection or automatically stop on CPU/memory pressure. Press **Ctrl+C** if
CPU is sustained near saturation, memory grows toward 512 MB, latency keeps rising,
the app restarts, or logs show repeated errors. Stop increasing load at the first
degraded plateau, even if the aggregate thresholds still pass.

Solo analytics has an existing **5,000 events/IP/hour** limit and a 600-events/visitor/hour
limit. A single generator shares an IP, so it can hit the former before server capacity.
Three events per iteration means roughly 1,666 successful solo iterations per IP/hour,
including earlier tests in that window. `rate_limited` distinguishes 429s; do not call
that a CPU limit. For API-only comparisons use:

```sh
ANALYTICS=0 UNITS=20 npm run loadtest -- solo ramp
```

This excludes the analytics write load and must be labeled accordingly. Do not spoof
forwarded IP headers or disable production limits to make a test pass.

## Results and capacity decisions

Each launcher run saves an ignored directory under `loadtest/results/` containing:

- `run.json`: timestamp, target and exact scenario/profile settings.
- `summary.json`: k6 aggregates and threshold outcomes.
- `metrics.json.gz`: timestamped metric samples for examining individual plateaus.

k6 prints its summary and returns a nonzero exit code for threshold failures. Also
check for interrupted iterations: a prematurely stopped run is not a passing capacity
measurement. A missing k6 executable or aborted initialization may leave only run.json.

The full-run p95 is not a per-plateau result. Use the timestamped samples with Fly's
graphs, or rerun a selected level with `baseline`, to identify the first degraded step.
Save these observations with the run ID:

| Run ID / image | Workload | Observed VUs / sockets | Requests/s | p95 HTTP / answer reply | Error / 429 rate | Peak CPU / RAM | Restarts | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |

For a first operating target, use at most half the highest repeatably healthy load
for the same workload, then validate that target with a mixed run and a soak. This
is a provisional buffer, not a guarantee. Report separate capacity numbers for page
arrivals, solo sessions and multiplayer sockets. Daily visitor totals cannot be
converted directly into simultaneous players. Staging's test data/cache state and
the shared CPU environment limit how precisely results transfer to production.

If CPU saturates, compare a larger machine on staging. If memory climbs during a
steady soak, inspect room cleanup and memory before buying more RAM. If latency
increases while CPU stays low, examine database operations, external waits and network
latency. Multiple machines require changes to the app's in-memory room/ranked state
and SQLite persistence before they are a suitable scaling strategy.

Higher traffic can increase bandwidth and keep staging awake. Compute cost depends
on the provisioned machine and running time; do not treat the test as cost-free.
No machine resizing, deployment or live load run is performed by adding this suite.

Implementation references: [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
and [concurrent WebSockets](https://grafana.com/docs/k6/latest/javascript-api/k6-websockets/).
