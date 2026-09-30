# Navigation and site structure

Locato's screens are organised into five sections. Every screen belongs to one, uses one of three
layouts, and follows the same rules for Home, Back and leaving. This document is the contract the
shell components (`src/ui/shell/`) and every screen build against.

## Sections

| Section | Route(s) | What it holds |
| --- | --- | --- |
| **Play** (home) | `/` (landing), every game route | All 14 modes as **practice**: no clock, no leaderboard, play at your own pace. Resume. |
| **Daily** | `?view=daily-challenge` | Today's 10-round challenge, streak and result. |
| **Learn** | `?view=academy…`, `?view=atlas`, `?country=xx` | Academy, lessons, placement, and the Atlas: an index of every country (the old flag gallery) plus each country's profile. |
| **Compete** | `?view=compete[&tab=leaderboards][&mode=&variant=]`, timed game routes, `?view=multiplayer[&create=1]`, `?room=` | Two ways to play for keeps: **Multiplayer** (a live match with friends, the default tab) and **Leaderboards** (a solo timed attempt that posts to a global board). |
| **You** | `?view=stats`, `?view=friends` | Stats, achievements, friends, account. |

`?view=leaderboard` and `?view=flags` stay as aliases (to Compete and Atlas) so old links work.

### Compete: Multiplayer vs Leaderboards

Compete opens on two tabs, and the words keep them apart: **Multiplayer · Live match with friends**
and **Leaderboards · Solo ranked attempts**. Multiplayer is the default and the most prominent.

- **Multiplayer** (`?view=compete`): "Create a room" opens the lobby straight into a new room with
  the default settings (`?view=multiplayer&create=1`, replaced by `?view=multiplayer` once it
  opens); "Have a code?" joins (`?room=CODE`, pasted invite links work); friends online each get
  **Invite** (creates a room, then invites them: `&invite=<userId>`); "Pick modes, rounds and timer
  first" opens the full setup. Guests can play: they pick a name (remembered on the device).
  A tab still seated in a room gets "Back to room".
- **Leaderboards** (`?view=compete&tab=leaderboards[&mode=&variant=]`): the board is the page.
  A mode picker across the top covers **all 14 modes** (grouped Clues / Map / Street View; a
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
  for time modes), not a banner. Any `&mode=` (old board links, "Try it timed →") also opens this
  tab. Switching tab, mode or variant replaces the URL. Boards are fetched only once this tab is
  shown.
- The lobby's heading reads **Compete › Multiplayer**.

### Practice vs timed

Practice and competition are separate places, not a dropdown inside a game.

- **Play** always starts a practice run: no clock, hints and passes are free, nothing is posted.
- **Compete** lists every mode's board. Picking one shows its board, and the board's call to
  action opens the game as a ranked attempt (`&run=timed` on the game URL). Time modes show the
  clock prominently; score modes show "Ranked" and play the fixed-length attempt described on the
  board. A ranked attempt cannot switch to practice mid-run, and ends on a results screen that
  submits the time or score and shows your rank. Guests are told to sign in to post (time bests
  are kept locally).
- A practice run offers "Try it timed →" (to that mode in Compete) on its results screen, and a
  timed run offers "Practise this mode" back.

## Layouts

1. **Site page** — landing, Academy hub, Atlas and profiles, Compete, Stats, Friends, multiplayer
   lobby, daily result. `SiteHeader`: logo (always Home) · the five section links with the current
   one marked · sound, theme and account on the right. On phones the section links move to a
   bottom `TabBar`.
2. **Game screen** — all 14 modes and a multiplayer game. `GameBar`: ← back · the game's name as a
   switcher (opens the game picker; switching never silently discards a run) · the run type
   (Practice / Timed with the clock) · a `⋯` menu with sound, theme, how to play, and the section
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
- **Groupings**: game modes are grouped the same way everywhere (landing, switcher, Compete):
  **Clues** (flags, flag colours, outlines, codes, capitals, capital recall), **Map** (name all,
  click, spot, puzzle, MapTap, Worldsplit), **Street View** (GeoGuessr, Street View country).
