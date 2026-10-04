# Navigation and site structure

Locato's screens are organised into six sections. Every screen belongs to one, uses one of three
layouts, and follows the same rules for Home, Back and leaving. This document is the contract the
shell components (`src/ui/shell/`) and every screen build against.

## Sections

| Section | Route(s) | What it holds |
| --- | --- | --- |
| **Play** (home) | `/` (landing), every game route | Every mode: split modes start as **practice**, single-run modes as the real thing: no clock, no leaderboard, play at your own pace. Resume. |
| **Daily** | `?view=daily-challenge` | Today's 10-round challenge, streak and result. |
| **Learn** | `?view=academy…`, `?view=atlas`, `?country=xx` | Academy, lessons, placement, and the Atlas: an index of every country (the old flag gallery) plus each country's profile. |
| **Multiplayer** | `?view=multiplayer[&create=1[&invite=]]`, `?room=CODE` | Live games with friends: open a room, share the link, play. |
| **Leaderboards** | `?view=leaderboards[&mode=&variant=]`, timed game routes | Every mode's global board and its ranked attempt. The phone TabBar labels it **Boards**. |
| **You** | `?view=stats`, `?view=friends` | Stats, achievements, friends, account. |

Old links keep working: `?view=leaderboard` and `?view=compete&tab=leaderboards` (or any
`?view=compete&mode=`) open Leaderboards, plain `?view=compete` opens Multiplayer, and `?view=flags`
opens the Atlas.

### Multiplayer

One page (`src/ui/screens/multiplayer/`) with four views, so there is one place to start, join
and play:

- **Home** (not in a room): pick a game (Quiz race, MapTap, GeoGuessr or Flyover) and the room
  opens straight away with that game's defaults; or join with a code (pasted invite links work).
  Friends online each get **Invite** (opens a room, then invites them: `&create=1&invite=<userId>`;
  the Friends page's Invite does the same). Guests pick a name, remembered on the device. Opening
  an invite link as a guest with no name puts a **Join room CODE** card first and asks for one.
- **Lobby**: the room code with **Copy invite link** (and **Share** where the browser has it),
  the players (host, watching, offline), and the game. The host edits everything in place,
  including switching the game type; everyone else reads a summary. There is **no ready check**:
  the host has one **Start game** button, guests see who they're waiting for.
- **Game**: the round view for the room's game. Someone who joins mid-game **watches** (a banner
  says so) and is seated for the next game.
- **Results**: standings, then the host's **Play again** (same players and settings, straight into
  the next game) or **Change game** (back to the lobby); guests see the host is choosing.

In a room the URL is the invite link (`?room=CODE`), so a refresh reclaims the seat. A link to a
different room wins over the seat a tab held. Errors and room events (a failed join, someone
leaving, a new host, a lost connection with **Try again**) show in one notice under the header,
in every view. Leaving the page leaves the room; when others are in it, or mid-game, the header
links, browser Back and the in-room Leave button ask first, and closing the tab mid-game asks too.

### Leaderboards

- **Leaderboards** (`?view=leaderboards[&mode=&variant=]`): the board is the page.
  A mode picker across the top covers **all 15 modes** (grouped Clues / Map / Street View; a
  sideways chip scroller on phones), variant pills appear only for modes that have them (flag set
  for Flags, continent for Puzzle), then the board: a podium for the top 3, ranked rows below,
  your row highlighted (and pinned to the bottom while you scroll when you rank below the rows
  shown), "Show more" for the next page, and loading / empty / error / offline states. Boards
  follow `src/core/leaderboards.ts`: **time** boards (fastest wins, shown as m:ss.t) and **score**
  boards (highest wins, shown as points out of the attempt's maximum, e.g. "38,420 / 50,000").
  The board header has the mode, one line describing an attempt, your rank and best in a slim
  line, and **one call to action**: "Start a timed run" (time boards) or "Play a ranked attempt"
  (score boards), which opens the game as a ranked attempt (`openGame(mode, "timed", variant)`);
  a small "or practise first" sits under it. On phones the button is fixed just above the
  TabBar. Guests get a slim "Sign in to post your scores" link (plus their best on this device
  for time modes), not a banner. Switching mode or variant replaces the URL.

### Practice vs timed

Each mode's board says how it is played (`runs` in `src/core/leaderboards.ts`):

- **Split modes** — the clue modes, Name all countries, Click the country, Spot the country,
  Puzzle, and MapTap — have a practice run and a timed / ranked run, because practice offers
  something a board can't. For the clue and map modes that's a resumable, clock-free run of the
  whole set with free hints and passes. For MapTap it's custom settings, so its practice is called
  **Custom** and the board run **Ranked**.
- **Single-run modes** — Worldsplit, Flyover, GeoGuessr, Street View country — have one way to
  play. Practice and ranked were the same game, so every finished run posts (guests see where it
  would place) and the board keeps your best. The GameBar shows a **Best** badge instead of a
  switch, the picker shows one button, and leaving mid-run never asks (an unfinished run just
  isn't counted). Old `&run=timed` links open the same game.

How you switch:

- **In a game**, a split mode's GameBar has a two-way switch, **Practice | Timed** (or
  **Custom | Ranked**). The other side opens that run of the same game (with the same flag set or
  puzzle continent) and asks first if a timed run is under way.
- **Play** starts a split mode's practice run. **Leaderboards** lists every board, and the board's
  call to action opens the timed run (`&run=timed`), or just "Play …" for a single-run mode.
- A timed run can't switch to practice mid-run without leaving it, and ends on a results screen
  that submits the time or score and shows your rank. Practice results offer "Try it timed →" and
  timed results "Practise this mode".

## Layouts

1. **Site page** — landing, Academy hub, Atlas and profiles, Multiplayer, Leaderboards, Stats,
   Friends, daily result. `SiteHeader`: logo (always Home) · the six section links with the current
   one marked · sound, theme and account on the right. On phones the section links move to a
   bottom `TabBar`.
2. **Game screen** — all 15 modes and a multiplayer game. `GameBar`: ← back · the game's name as a
   switcher (opens the game picker; switching never silently discards a run) · the run type
   (a Practice | Timed switch with the clock, or a Best badge on single-run modes) · a `⋯` menu with sound, theme, how to play, and the section
   links. The page-to-page links live in that menu, not across the bar.
3. **Focus screen** — lessons, placement, and each daily stage. `FocusBar`: ✕ · progress ·
   (optional) streak. The ✕ asks before discarding unsaved progress.

## Rules

- **Home**: the logo always goes to `/`. Nothing else is labelled Home.
- **Back**: ← / Back returns to where you came from (browser history); on a cold start it falls
  back to the section's home. Labels say where they go ("Back to Academy"), never "Back to game"
  unless that is true.
- **History**: navigating to a new place pushes an entry; changing what's shown inside the same
  place replaces it (Atlas prev/next, the Academy group panel, a lesson's "Next lesson", daily
  stages, switching world-map mode).
- **URLs**: every game URL carries its mode and run type, so refresh and Back land in the same
  place.
- **Never lose progress silently**: each mode keeps its own saved practice run; switching games
  keeps the others. Leaving something with unsaved progress (a timed run, a daily in progress, a
  lesson, a multiplayer room) asks first. The daily saves after every round and resumes where you
  left off.
- **Every run ends on a results screen**: score/time, what you missed (each links to its Atlas
  page), and Play again · Try another game · Share (plus the practice/timed cross-link).
- **Wording**: "Daily challenge", "Multiplayer", "Leaderboards", "Academy", "Atlas", "Stats",
  "Friends" — sentence case, the same everywhere.
- **Groupings**: game modes are grouped the same way everywhere (landing, switcher, Leaderboards):
  **Clues** (flags, flag colours, outlines, codes, capitals, capital recall), **Map** (name all,
  click, spot, puzzle, MapTap, Worldsplit), **Street View** (GeoGuessr, Street View country).
