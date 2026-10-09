# Geographer / GeoGuessr redesign

Reference review: https://www.geoguessr.com/ (home and Maps catalogue) and https://www.openguessr.com/ (World play, map layers, menu). The chosen direction is GeoGuessr-style: full-screen Street View, minimal overlays, a light Google map, and a prominent green guess button. The interface now follows Locato’s saved light/dark theme.

## Experience

- Immersive panorama with small navigation and round/score overlays; return to start and help stay in the lower corner.
- The screenshots supplied on October 8 guide the five-slot scoreboard, circular exploration controls, live heading compass and separate green pill Guess button. Individual round scores fill the slots as the trip progresses.
- Compact guess map expands on hover or keyboard focus, with an explicit pin-open toggle. Touch uses the open/expand controls. Standard, Terrain and Satellite switch real Google map types. Zoom, world reset and return-to-pin controls remain simple.
- Results turn the Google map into the full-screen canvas. The correct country is outlined, both pins are connected, and a compact score panel presents country, distance, points and Next round.
- Five-round recap preserves the existing 25,000-point scoring, personal best, leaderboard posting, round review and Atlas links.
- Phone layouts use the same immersive canvas with a map sheet and compact result panel. Keyboard and reduced-motion support remain available.

## Google Maps configuration

The deployed frontend receives its browser configuration from GitHub Actions secrets `VITE_GOOGLE_MAPS_JAVASCRIPT_API_KEY` / `VITE_GOOGLE_MAPS_EMBED_API_KEY`, passed to Docker as build arguments. Local Vite development reads `VITE_GOOGLE_MAPS_JAVASCRIPT_API_KEY` from `.env.local`. Local environment files are ignored by Git. Server-side Static Street View keys remain separate.

`tests/fixtures/geoguessr.html` now uses the production Google map and Street View implementations, with real catalogue locations and no leaderboard posting; `?fixed=1` keeps fixed points for comparisons. It requires the browser key; it contains no substitute SVG map or stock photograph. `tests/fixtures/geoguessr-mobile.html` embeds that page at 390 × 844 for mobile review.

## Map responsiveness

- Explicit Google vector rendering with fractional zoom (https://developers.google.com/maps/documentation/javascript/vector-map), with tilt/rotation disabled to keep guessing simple. Google controls device fallback and tile caching.
- Load maps and marker libraries concurrently; initialize the guess map alongside the panorama and reuse one instance across all rounds.
- Coalesce map resize notifications into one animation frame and skip unchanged dimensions. Map expansion changes dimensions once, without animating width/height and repainting every intermediate size.
- Reframing results only updates the camera; it no longer destroys/recreates pins and route lines. Re-selecting the current map layer is a no-op.
- The world is not bulk-prefetched. New areas and imagery still depend on Google tile delivery and the connection.

## Sound and motion

Original synthesized Web Audio cues cover pin placement, guess confirmation, round starts, score reveals and trip completion. The circular sound toggle shares the app's saved sound preference and stays synchronized with the GameBar menu. Muting also silences scheduled audio immediately. Input unlocks browser audio; unsupported/blocked audio does not block play.

Pins drop into place, round intros briefly appear, result cards enter, score bars fill and scores count up over 850ms. High-scoring rounds and trips get a short decorative confetti burst. Navigation/hidden tabs cancel pending effects. OS and saved reduced-motion preferences skip the animation; assistive technology receives the final score immediately. Map width/height and panorama rendering remain unanimated.

## Between-round loading

A CSS globe with rotating meridians, orbiting lights and a floating pin replaces the small loading spinner. Five journey stops mark completed rounds and the upcoming round. After readiness checks, an audible 3–2–1 countdown keeps the full-size panorama covered for three seconds, then a Go cue and 300ms fade reveal the round. Guessing stays disabled until the countdown completes. It exposes no destination hints; error/retry states retain their simpler layout. Reduced motion uses a static globe and countdown numbers without movement; the three-second timing remains the same. Countdown timers cancel on navigation and restart.

Ranked imagery now waits for `HTMLImageElement.decode()` before beginning the countdown; stalled/failed images lead to Retry. Interactive Google Street View waits for the viewer’s `status_changed`/OK after `setPano`, explicitly resizes after becoming visible, and renders behind the countdown. Google does not expose an all-tiles-painted event in its [public panorama API](https://developers.google.com/maps/documentation/javascript/reference/street-view); the additional three seconds provide rendering time, but unusually slow tile delivery still needs live validation. The private image surface also has an explicit full-screen size, preventing the shared relative-position rule from collapsing it.

## Clearer result route, custom pins and richer audio

Result routes use charcoal 4px dashes over a continuous 7px white casing, with matched geodesic paths and non-interactive overlays. Both line layers are reused during reframing and removed together on reset. This follows Google’s [polyline symbol approach](https://developers.google.com/maps/documentation/javascript/examples/overlay-symbol-dashed).

Original teal SVG compass pins identify player guesses; amber flag pins identify the actual location. Each has a white outline, an accurately anchored tip, and a readable result label. Result framing reserves additional horizontal space for the labels; phone labels use a narrower layout. Multiplayer colours and player names are preserved. The actual marker SVGs were rasterized and inspected against ocean-blue, light and dark backgrounds; this checks the artwork, not the live Google renderer.

Sound cues now combine filtered air/percussion, short bass impacts and multi-partial chimes. Pin placement has a tactile tap and bright pluck, submission has a rising whoosh, the countdown has clear clock strikes, and scores resolve into chords. All layers share the existing mute control and cancellation on navigation. The small noise buffer is reused; no audio downloads or dependencies are added.

## Verification

Build, scoring/map/Street View tests, and the wider regression suite. Map tests cover style switching, pin controls, outline reveal/reset and delayed loads. Screen tests cover five-round scoring, replay, persisted styles, country review and keyboard submission. Result camera padding reserves space for the floating overlays.

Latest checks after route, pin and sound refinement: production build passed; 84 test files / 764 tests passed with `NODE_OPTIONS=--no-experimental-webstorage npm test` (the flag avoids the local Node runtime's experimental Web Storage conflict with happy-dom). The computer-use connection still reports a native pipe startup failure, so the screenshot-matched layout, live Google pan/zoom performance, and sound/animation mix have not been visually/audibly rechecked. The new tests cover hover expansion/pinning, individual round scores, live compass/zoom wiring, persistent map instances, and result reframing without rebuilding overlays. Desktop and mobile preview pages are available through the local Vite server for that remaining review.


## Final trip screen

The completed trip uses one static theme-aware summary card with a sans-serif heading, a clear total out of 25,000, a restrained score bar, personal best, two supporting statistics and five compact flag/score rows. Selecting a row reviews its two pins. Replay, Choose a map, leaderboard and sharing stay available; a second visited-country list is omitted. Posting feedback sits at the bottom.

The completed map switches to Standard and hides the country/layer/zoom toolbars and duplicate score HUD using `hidden`, including for keyboard and screen-reader navigation. Starting another trip restores the saved layer preference and normal game controls. The final card has no entrance animation or confetti. Mobile keeps the map above a scrolling summary panel. The shared map geometry URL is absolute so real-panorama validation also works from the nested development preview.

## Locato light and dark palettes

The game inherits the shared `tokens.css` palette and root `data-theme`; it no longer forces dark mode or replaces the application’s theme tokens. Light mode uses warm ivory surfaces with forest-green actions and muted teal artwork. Dark mode uses deep forest surfaces, warm off-white text and sage actions. The existing Menu → Dark mode toggle applies immediately without recreating Google Maps or Street View, restarting a round, or clearing a pin.

Lobby cards, search, filters, HUD, compass, map controls, loading globe, countdown, round results and final recap all follow these tokens. Region thumbnails have separate light/dark SVG palettes; country silhouettes use the existing SVGs as colorable masks. Player pins and their legend use teal; actual-location pins use amber, with white outlines and a forest-ink dashed route.

For local visual review, `tests/fixtures/geoguessr.html?theme=light` and `?theme=dark` override the fixture’s theme without changing the saved site preference. The normal preview remains `/?game=geoguessr`; its existing menu toggles and saves the theme.

The active trip has no top-left Change map control or menu shortcut. Map selection is available in the lobby and again from the finished trip’s Choose a map action. Round reveals hide the left-side location header and layer picker, and omit View country/Both pins; the GeoGuessr navigation control remains, with zoom/world controls on the right. Playing the next round restores the guess map’s controls.

## Frosted game controls

Navigation, round HUD, compass, exploration buttons, map controls and the inactive guess button use translucent theme-tinted glass with a 22px backdrop blur, gentle saturation, a diagonal sheen, bright inner rim and soft shadow. Light and dark modes use different tint opacity and highlight strength. The active Guess action retains its green fill. Browsers without backdrop filtering and visitors requesting reduced transparency receive solid theme surfaces; no background distortion shaders or continuous filter animations are used.

## Multiplayer

Multiplayer GeoGuessr uses the same full-screen canvas, shared light/dark glass controls, reusable expandable Google map, loading globe, sound preference, compass-shaped player pins and dashed result routes. A compact live standings panel supplements the local round-score HUD. Reveals hide the left-side map settings and display each player's distance and server-awarded points. Completion keeps the map behind a static standings card; returning to the lobby restores the normal site layout.

Street View stays behind the existing private asset endpoint, with opaque image URLs and server-controlled scoring. Images decode before guessing becomes available. Left/right controls request another heading of that private panorama; image zoom is local. The server gives every player the same three-second countdown before the full round timer starts, rejecting guesses and skip votes during that countdown. A late image remains covered until it decodes, without extending the server deadline.

Release checks: production build passed; 87 test files / 789 tests passed. Multiplayer checks cover countdown timing, decoding and cancellation, spectators and expired rounds, reveal pins, persistent map instances, completed-game layout and restoration of the lobby and other game results. Live visual verification remains unavailable because the computer-use connection fails to start.
