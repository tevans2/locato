# Ranked game authority

Competitive results except Flyover come from server-owned games. This closes raw final-score
submission in those modes, predictable ranked queues, answer codes in clue URLs and exposed
Street View origins. Flyover deliberately uses its original local gameplay again: movement,
touches, targets and skips do not wait for HTTP responses or reconcile to server positions.
Its scores are client-reported and its multiplayer route is public. This restores the earlier
Flyover cheating opportunities, including altered physics, autopilot and fabricated in-range
solo totals. Flyover must not be described as cheat-proof or server-verified.
It does **not** prove that a human supplied the accepted controls or answers.

## Coverage

| Modes | Server verifies |
| --- | --- |
| Flags (countries, territories, both), Flag Colours, Shapes, Codes, Capitals, Capital Recall | Server-chosen current country; original answer matching; elapsed server time; completed set |
| Name All | Unique valid country names, aliases and country-code shortcuts; full set; elapsed server time |
| Click Country, Spot Country, Puzzle (all continents) | Private current challenge; click containment / puzzle placement / typed name; full set; elapsed server time |
| Map Tap, GeoGuessr | Fixed challenge count; valid pin; private scoring origin; recomputed distance/points |
| WorldSplit | Fixed rounds; valid line; server population split and points |
| Flyover | Local 90-second game; authenticated, bounded client score submissions; improvements only |
| Daily | Private themed daily queue; server answers/pins; wrong-guess penalties; one reserved account attempt per date |
| Multiplayer | Existing server answer/pin scoring plus strict deadlines; Flyover route order/location/coarse travel-time checks; server-written account results |

Signed-in ranked play outside Flyover uses the original gameplay screens through `RankedGameScreen` and
`RankedSession`. Practice and timed games share their layouts, controls and results views;
ranked actions and result posting remain server-owned. Daily uses `VerifiedGameScreen`.
Timed completion games stay at zero until the first submitted guess (including a wrong
manual guess) or first map/puzzle placement. Partial automatic input, Hint and Pass do not
start the clock. The backend uses its receipt time; browser timestamps never set the result.
Score games retain their original start/deadline rules, including Flyover's Take off.

Flyover runs its original physics once per animation frame on a steady local clock. Keyboard,
boost and held map-pointer steering work immediately. Local touches advance targets and scores
on that frame, solo skips subtract five seconds, and multiplayer skips apply the original
five-second holding pattern. Multiplayer position reports only draw other players; delayed
echoes never overwrite your plane. Repeated targets leave the country card animation alone.
The active Flyover screen never starts or polls a ranked server session. The older ranked
Flyover endpoints remain available for compatibility with older clients.

Correct answers and map finds update the screen synchronously using the original practice
matchers. No typing debounce, transport spacing or minimum guess delay is added; requests
still have an abuse rate limit. Name All queues rapid answers without dropping them.
The current clue includes an `answerToken` fingerprint for that immediate feedback.
**This is dictionary-recoverable current-answer information, not a secret or an anti-bot
boundary.** It exposes no future questions and never authorizes a move, timing or score.
The backend independently rechecks every action; rejected predictions roll back and cannot
finish or post a run. The next private clue and completed result still require a server
response. Keeping every current answer secret from JavaScript would require waiting for
server validation before correct-answer feedback.
Guest/practice play continues locally. Outside Flyover it cannot upload final values to ranked boards. Educational country data, public practice assets, and
map geography remain public: a browser needs visible geography to render a playable game.

## API boundaries

- `POST /api/ranked/start` validates mode/variant and creates a cryptographically random,
  account-bound game. Its queue and private random seed remain on the server.
- `POST /api/ranked/action` accepts the current question ID and a move. A server checks the
  answer, pin, placement, split line or flight controls. Hint, Pass and Reveal are also
  server actions. Puzzle drops record each piece offset; Check accuracy only completes a
  timed game after every piece is within the permitted placement tolerance. Stale question IDs, invalid moves and
  excessive requests fail. The legacy ranked flight API never accepts client position, radius, speed or score; the active Flyover screen does not use it.
- `POST /api/leaderboard` outside Flyover requires a completed, unexpired, account-owned run and the exact
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
- Flyover `POST /api/leaderboard` without a run ID accepts authenticated client totals within
  the current mode's score bounds. SQLite marks these entries `verified = 0`. A supplied legacy
  run ID still requires its completed server result. No other mode accepts raw final values.
- Multiplayer Flyover sends `FLYOVER_POSITION`, `FLYOVER_REACHED` and `FLYOVER_SKIP`, as before
  security changes. The server relays positions and checks route order, touch location, coarse
  travel time, skip holds and deadlines. It does not simulate or correct the player's plane.
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

Historical results remain visible on leaderboards, personal ranks, placement previews and daily
history. The `verified` field preserves provenance: historical entries are not retroactively
marked as server-verified. New submissions outside Flyover still require a completed server-owned game.
Only improvements replace existing best scores/times, and completed daily results stay immutable.

The earlier quarantine migration hid all old results and allowed weaker verified results to
replace them. A one-time transactional repair restores historical bests and original daily
results from `legacy_mode_best_times`, `legacy_mode_best_scores`, and
`legacy_daily_challenge_results`, preserving stronger new results and original timestamps.
Its migration marker prevents later restarts from undoing administrator corrections; deleted
accounts are excluded. Snapshot rows remain available for review and are removed on account
deletion. Historical scores, including previously cheated scores, are restored as requested;
server verification applies to new submissions outside Flyover, not retroactively to old records.

## Remaining automation

A script can recognize a visible flag/outline, match anonymous geometry to a public atlas,
identify a street image, type valid answers, or steer a plane with permitted controls. Outside Flyover the
server can enforce rules and physics but cannot reliably distinguish those inputs from a
skilled person. Private future questions remove advance knowledge; visible clues cannot be
made secret from the person or software displaying them. Bot detection needs additional
behavioral signals, review and moderation, with false positives considered. Obfuscation or
"private" JavaScript variables are not an anti-cheat boundary.
The immediate-feedback fingerprint also allows a script to identify the current answer
without image recognition. Outside Flyover, server authority prevents fabricated results and altered physics;
it does not prevent a bot from submitting valid answers quickly.

## Regression checks

`rankedSecurity.test.ts` completes real server games across every ranked mode and rejects raw
submissions outside the intentional Flyover exception. It verifies ownership, expiry, variant
and result matching, private clue payloads and daily reservation. `rankedUI.test.ts` plays the
actual frontend and HTTP handler, including original controls, country shortcuts, idle timers,
Hint/Pass and immediate feedback while responses are held back. `rankedMigration.test.ts`
checks historical restoration, timestamps, improvements, provenance and pagination in SQLite.

Flyover tests compare signed-in and guest movement frame by frame while all HTTP responses
are stalled, exercise local reaches/skips/results and ensure multiplayer echoes cannot move
the local plane. Original Flyover room tests cover position relays, plausible reaches, skip
holds and deadlines. The isolated score-forgery fixture explicitly documents that raw Flyover
totals are accepted again; invalid values and unauthenticated submissions remain rejected.
