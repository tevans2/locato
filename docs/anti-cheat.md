# Ranked game authority

All competitive results come from server-owned games. This closes raw final-score submission,
client speed/radius changes, forged flight positions/reaches, predictable ranked queues, answer
codes in clue URLs, exposed Street View origins, and full multiplayer route disclosure.
It does **not** prove that a human supplied the accepted controls or answers.

## Coverage

| Modes | Server verifies |
| --- | --- |
| Flags (countries, territories, both), Flag Colours, Shapes, Codes, Capitals, Capital Recall | One private current country; matching answers; elapsed server time; completed set |
| Name All | Unique valid country names; full set; elapsed server time |
| Click Country, Spot Country, Puzzle (all continents) | Private current challenge; click containment / puzzle placement / typed name; full set; elapsed server time |
| Map Tap, GeoGuessr | Fixed challenge count; valid pin; private scoring origin; recomputed distance/points |
| WorldSplit | Fixed rounds; valid line; server population split and points |
| Flyover | Fixed 90-second deadline; server simulation with stock speed, turn rate, boost and touch radius; server-detected touches |
| Daily | Private themed daily queue; server answers/pins; wrong-guess penalties; one reserved account attempt per date |
| Multiplayer | Existing server answer/pin scoring plus strict deadlines; server-simulated Flyover; private next targets; server-written account results |

Signed-in ranked play uses the original gameplay screens through `RankedGameScreen` and
`RankedSession`. Practice and timed games share their layouts, controls and results views;
ranked actions and result posting remain server-owned. Daily uses `VerifiedGameScreen`.
Guest/practice play continues locally and cannot upload its final values to ranked boards. Educational country data, public practice assets, and
map geography remain public: a browser needs visible geography to render a playable game.

## API boundaries

- `POST /api/ranked/start` validates mode/variant and creates a cryptographically random,
  account-bound game. Its queue and private random seed remain on the server.
- `POST /api/ranked/action` accepts the current question ID and a move. A server checks the
  answer, pin, placement, split line or flight controls. Hint, Pass and Reveal are also
  server actions. Puzzle drops record each piece offset; Check accuracy only completes a
  timed game after every piece is within the permitted placement tolerance. Stale question IDs, invalid moves and
  excessive requests fail. A flight never accepts client position, radius, speed or score.
- `POST /api/leaderboard` requires a completed, unexpired, account-owned run and the exact
  server result for that mode/variant. Changing final numbers or using an old audit ticket
  does not work. Exact retries within five minutes keep the original best timestamp and do
  not record duplicate account games.
- `POST /api/daily` takes only a completed daily run ID as authority. Uploaded score/time,
  marks and review details cannot replace server values. Attempts are reserved in SQLite's
  run trail, so reloading or restarting the server cannot reset a scored daily attempt.
- `/api/ranked/<run>/asset/<question>` requires its owner's session and current question.
  Multiplayer artwork uses opaque, short-lived capability URLs, revoked after the round.
  Flag/shape clues are raster images with no SVG names/IDs. Flag Colours sends only revealed
  pixels. Highlight clues send anonymous visible geometry rather than answer codes.
- GeoGuessr and Street View send proxied image bytes, with private coordinates/panorama IDs
  kept on the server. Four 90-degree look directions are available. Ranked play removes
  walking through Google's interactive panorama, which would expose its location to JS.
  Image requests are deduplicated, bounded and briefly cached in server memory; EXIF/IPTC
  location metadata is stripped. Public practice APIs no longer expose the generated ranked
  Street View pool.
- Multiplayer `FLYOVER_INPUT` contains turn, desired heading and boost. Legacy
  `FLYOVER_POSITION` / `FLYOVER_REACHED` messages cannot award points or teleport a server plane.
  Controls expire after one second of silence; reconnecting cannot bank that gap as movement.
- Authenticated writes reject cross-site origins. WebSocket upgrades default to same-origin;
  a configured `ALLOWED_ORIGINS` list can explicitly allow additional frontends.
- Multiplayer account wins are written by the room server. `/api/games` rejects browser
  multiplayer records. Noncompetitive practice counters and local achievements remain
  client-reported and must not be used as proof of competitive performance.

`RUN_AUDIT_ENFORCE` remains a legacy diagnostic setting. Turning it off does not bypass ranked
verification. Client timelines are useful signals for review, never proof that play was human.

## Deployment

This patch does not deploy or modify the live database by itself. Deploy backend and frontend
together; old clients must reload. Use the updated Dockerfile: server raster rendering needs
`@resvg/resvg-js` and `pngjs`, including the native library matching the runtime architecture.

Before deploying:

1. Back up the SQLite database and persistent Street View pool.
2. Configure a private `RANKED_CHALLENGE_SECRET` (at least 32 random bytes) so a date's private
   daily queue remains stable across restarts. Do not set a `VITE_` variable for this secret.
3. Enable Google Street View Static API and configure the server-only
   `GOOGLE_MAPS_STREETVIEW_STATIC_API_KEY`. The metadata key can use the same server credential.
   Retain the browser key for the original GeoGuessr guess map, practice views and the
   multiplayer pin map. MapTap uses its existing satellite globe without a Google browser key. Image requests use the billable static API;
   configure the Google project's quota as appropriate for traffic.
4. Run type checking, the full test suite and a production build. On Node 26, use
   `NODE_OPTIONS=--no-experimental-webstorage npm test` for Happy DOM tests.
5. Deploy a single server instance with the existing persistent volume. Active games/receipts
   live in memory. A server restart cancels an active game; an already reserved daily cannot
   restart that day. This intentionally fails closed. Multiple servers need shared game
   state or sticky routing before this design can be scaled horizontally.
6. Check a real signed-in round, private imagery, score posting and multiplayer reconnection
   in staging before deploying production.

The additive migration adds `verified` flags to saved best times, best scores and daily results.
All existing entries start unverified and are excluded from competitive standings. This includes
honest entries: their play cannot be established retroactively. Snapshot tables
`legacy_mode_best_times`, `legacy_mode_best_scores`, and `legacy_daily_challenge_results` retain
the original rows for administrator review. Valid new results can replace an old impossible best,
including a slower time or lower score. Account deletion also removes its archived rows.

Do not restore old standings merely by setting `verified = 1`; that flag means the backend
actually validated a game. A rollback to the old accepting backend also restores the vulnerability.

## Remaining automation

A script can recognize a visible flag/outline, match anonymous geometry to a public atlas,
identify a street image, type valid answers, or steer a plane with permitted controls. The
server can enforce rules and physics but cannot reliably distinguish those inputs from a
skilled person. Private future questions remove advance knowledge; visible clues cannot be
made secret from the person or software displaying them. Bot detection needs additional
behavioral signals, review and moderation, with false positives considered. Obfuscation or
"private" JavaScript variables are not an anti-cheat boundary.

## Regression checks

`rankedSecurity.test.ts` completes real server games across every ranked mode, rejects raw
submissions, verifies ownership/expiry/variant/result matching and private clue payloads, and
checks daily scoring/reservation. `rankedUI.test.ts` plays through the actual frontend and HTTP
handler in every regular mode, including original controls, Hint/Pass, restarts and score
posting. `rankedMigration.test.ts` runs the production migration/queries against real SQLite.
Flight/room tests enforce stock movement, silence/deadlines and private targets. Earlier cheat
scripts remain isolated reproduction fixtures; their browser-only score cannot post a ranked result.

Local validation passed all 637 tests and the production build. A separate native Bun/SQLite
HTTP run rejected forged Flyover scores of 93, 159 and 196, rendered a private PNG clue, and
accepted/persisted a completed 196-answer Codes game using its server receipt. This also
demonstrates the remaining boundary: software can still submit valid answers under the rules.
