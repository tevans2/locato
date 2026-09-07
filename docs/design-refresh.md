# Frontend design refresh

Branch: `codex/landing-design-refresh`, based on `origin/staging` at `214250f4dd00296f8d7022f94ca730fc31e2f206`.

## Design

The landing page opens with a game selector: browse Clues, Map, and Street View categories, preview any of the 14 modes, then launch the selected game. Daily and resume/multiplayer shortcuts sit alongside the selector. The former large slogan, promotional paragraph, and decorative atlas postcard are removed. It uses a warm paper and forest-green palette and self-hosted Manrope and Fraunces typography. Shared styles apply the same colours, controls, panels, focus states, and typography across the game and supporting screens, in light and dark themes.

The atlas artwork is generated from the existing world-map data with `python3 scripts/generate-landing-art.py`. Font licences are included in `public/assets/font-licenses/`.

## Fixes and performance

- Game and supporting-page URLs survive refresh and sharing. Landing anchors also survive reload, with the header remaining visible on mobile.
- Continue playing restores the saved mode; a link to another mode opens the requested mode. Completed saves start a new game.
- Account controls are available on the landing page and mobile. Mobile menus restore focus, support Escape, and contain keyboard focus.
- Header actions no longer overlap theme/account controls. Shared map-game navigation is available on mobile.
- Failed screen loads provide retry and home actions. MapTap can retry a failed target request. Unconfigured Street View screens explain availability and offer other games.
- Heavy game screens load on demand, and the landing page no longer starts a WebGL globe.
- World-map data is shared between screens, with failed requests remaining retryable.
- The interactive globe is created only when requested, draws only when its state changes, uses a smaller fill texture, and disposes its outline geometry. Resizing preserves a suitable fit; picking avoids countries behind the globe; light-mode colours no longer wash out.
- The favicon path is corrected, and compatible dependency security patches are applied.

| Production entry JavaScript | Staging baseline | Refresh |
| --- | ---: | ---: |
| Minified | 2,240.23 kB | 386.71 kB |
| Gzipped | 613.17 kB | 110.84 kB |

The entry is approximately 83% smaller before compression. Three.js and MapLibre still produce large chunks, loaded only for modes that need them; the build reports its size advisory for these chunks. This is a bundle-size comparison, not a measured frame-rate or network-speed claim.

## Verification

- Production build and TypeScript checks pass.
- 167 tests pass across 23 files, including 27 new route and map-data tests.
- `git diff --check` passes; the dependency audit reports zero vulnerabilities after compatible patches.
- Browser checks covered all 14 game routes, narrow layouts at 320/390 px, desktop at 1280 px, theme switching, game filtering, anchors, account-panel focus, and mobile menus.
- Played a flags answer and confirmed score/progress after refresh. Verified saved-mode continuation and a different-mode shared link.
- Verified flat-map modes defer their canvas, then opened and manipulated the globe and resized it between desktop and mobile.
- Submitted a MapTap guess and a Worldsplit round and checked their results and next-round controls.
- Created an isolated local multiplayer room, readied, and started a round. Opened the daily challenge and advanced a round.
- Checked leaderboard loading and signed-out stats/friends pages.

## Remaining verification

Google Maps keys are absent from this checkout. Actual Street View panoramas and the Google guess map require the configuration documented in `.env.example` and `docs/deployment.md`. Their unconfigured states were checked. The full daily sequence, authenticated social flows, external OAuth providers, and multi-player cross-device synchronisation were not exercised in the browser; existing automated tests remain green.

The review preview serves the production build from an isolated local test database. Changes have not been deployed.
