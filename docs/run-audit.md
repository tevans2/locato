# Run audit (Name all countries)

The server can't watch anyone play, so a posted time used to be taken on trust: any signed-in player could post `{ gameMode: "name-all", timeMs: 61234 }` from the browser console. Run audit keeps a record of **how** each run was played, checks it when the run ends, and shows it in the admin console.

## What gets recorded

- **A ticket from the server.** On the run's first country the browser calls `POST /api/runs/start`. The server stores the run with its own start time. That gives the run's real length, whatever the page's clock says.
- **A timeline** (`src/core/runAudit/recorder.ts`). Each country found becomes `[code, ms into the run, real input events, scripted input events]`, and the whole run adds paste count and time spent with the tab hidden. "Real" means the browser marked the event `isTrusted`, which happens for keyboards, on-screen keyboards and autocorrect. Page scripts can't produce trusted events.
- **Every run is kept**, practice included, in the `runs` table:
  - a timed finish sends its timeline with the leaderboard post;
  - any other ending sends it through `POST /api/runs/finish`: practice finished, given up, restarted, or the player left.

Only signed-in players are tracked (guests can't post anyway).

## Checks (`auditRun` in `src/core/runAudit/index.ts`)

**Hard checks** apply only to a timed run posted to the board. No honest run fails them.

| Check | Meaning |
|---|---|
| `no-ticket` | Posted without a run the server saw start (a console post, or a reused or someone else's ticket) |
| `server-time-short` | Claimed time longer than the run lasted by the server's clock |
| `time-mismatch` | The timeline's last country disagrees with the claimed time |
| `bad-countries` | No timeline, or countries repeated, unknown or missing |
| `below-floor` | Under 2:00 (the fastest honest run is 3:47) |
| `no-typing` | More than 10% of countries found with no real typing |

**Review flags** apply to every run. They're signs worth a look and never refuse anything.

| Flag | Meaning |
|---|---|
| `synthetic-input` | Input events created by page script |
| `fast-burst` | More than 72 countries in any 60 s (honest players stay under 1/s) |
| `even-pace` | Gaps between countries too even (spread under 35% of the mean) |
| `list-order` | Found in A–Z or the game's list order (correlation ≥ 0.9) |
| `clock-slow` | The game clock ran well behind the server's (paused or tampered) |
| `big-improvement` | A new best more than 25% faster than the previous one |
| `overlapping-run` | Started before the player's previous run ended |
| `tab-hidden`, `paste` | Tab hidden over 10 s, or pasting into the answer box |

The player is never told which checks fired, so a script can't learn what to avoid.

## Observe, then enforce

By default the server **observes**: every run is audited and recorded, but no post is refused. Set `RUN_AUDIT_ENFORCE=1` (for example `fly secrets set RUN_AUDIT_ENFORCE=1`) to refuse posts that fail a hard check. Refused runs stay in the trail. The admin System page shows which mode is on.

Before enforcing, check that real players' runs (Tate's and Kylian's) come out `ok` in the admin console, and adjust the thresholds in `src/core/runAudit/index.ts` if they don't.

## Admin console

- **Leaderboards → Flagged runs:** every run with a flag, across all players.
- **Users → a player → Runs:** their last 30 runs.

Each row shows the claimed time against the server's, the checks (hover one for details), input counts, and a curve of countries found over time. The dashed line is the fastest honest run so far. An honest curve climbs in uneven steps and flattens at the end; a script is a straight line, usually far steeper.

## Limits

A careful bot that drives a real browser from outside, with real keystrokes, human-like pacing and region order, can pass. What it can't avoid is leaving a full timeline to judge it by, and the "play one while I watch" test still works.

Other timed modes can reuse this: add the mode to `AUDITED_MODES`, record a timeline in its screen, and give it its own expected answers.
