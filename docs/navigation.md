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
| **Compete** | `?view=compete[&mode=&variant=]`, timed game routes, `?view=multiplayer`, `?room=` | Timed runs that post to a leaderboard, the leaderboards themselves, and multiplayer. |
| **You** | `?view=stats`, `?view=friends` | Stats, achievements, friends, account. |

`?view=leaderboard` and `?view=flags` stay as aliases (to Compete and Atlas) so old links work.

### Practice vs timed

Practice and competition are separate places, not a dropdown inside a game.

- **Play** always starts a practice run: no clock, hints and passes are free, nothing is posted.
- **Compete** lists every leaderboard mode. Picking one shows its board and your best, and **Start
  timed run** opens the game in timed mode (`&run=timed` on the game URL). A timed run shows the
  clock prominently, cannot switch to practice mid-run, and ends on a results screen that submits
  the time and shows your rank. Guests are told to sign in to post (their best is kept locally).
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
