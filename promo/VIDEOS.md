# Making Locato videos

Every video is a small JSON file in `videos/`. Make one with `npm run new`, check it, render it.

```sh
npm run new -- quiz --kind flags          # 1. write videos/flags-score-a-<date>.json (+ .caption.txt)
npm run check -- videos/<file>.json       # 2. stills every 0.5s -> out/check/<file>/sheets/
npm run render -- videos/<file>.json      # 3. -> out/<file>.mp4 (add --open to play it)
```

Preview and tweak any template live: `npm run studio`.
Render several at once: `npm run render -- videos/2026-11-*.json`.
A week of posts in one go: `npm run new:week` (14 videos, 2 a day, in the research report's mix; edit `tools/locato/week.ts`).
One voiced sample of every format: `./tools/locato/make-samples.sh`.

## Templates

| Command | What it makes | Useful options |
|---|---|---|
| `new quiz` | The **Score Challenge**: every Locato mode as a play-along quiz (see below) | `--kind …` or `--modes flag,shape,route` `--mode one-life` `--hook a–f` `--count 5` `--seconds 2` + choosing countries (below) |
| `new lookalikes` | "Can you tell these apart?": unlabeled look-alikes, then names + the tell-tale difference (Locato's Academy data) | `--skill flag\|shape` `--count 3` `--seconds 4` |
| `new daily` | "Warm up for today's Daily": themed mini-quiz that never uses that day's real Daily countries | `--date today\|tomorrow\|YYYY-MM-DD` `--count 5` |
| `new speedrun` | Your screen recording with a hook title, running clock, captions and slow push-ins | `--video rec.mp4 --title "..."` `--start 1.2 --stop 47.9` (clock, clip seconds) `--callout "12=No hints"` `--zoom "3-7@0.5,0.4x1.5"` `--trim-start` `--trim-end` `--speed 2` |
| `new versus` | Two recordings of the same race, then the winner (phone recordings side by side, desktop stacked) | `--top a.mp4 --top-name Alex --bottom b.mp4 --bottom-name Sam --winner top` `--top-result "4:29"` `--top-emoji 🌋` |
| `new leaderboard` | Podium + top 10 from the live board | `--mode flags\|capitals\|shapes\|name-all\|map-tap…` `--variant` `--limit 10` `--hide name1,name2` `--anon` |

All commands also take `--title`, `--badge`, `--question` (asked before the end card), `--cta` (line on the end card), `--seed` (same seed = same picks) and `--name` (file name).
Quizzes prefer countries no earlier spec has used, so a series doesn't repeat (`--no-fresh` to allow repeats).
Quiz, daily and look-alike videos are built from a **recipe** (see *Recipes and content*); add `--print` to preview the picks without writing anything.

## The Score Challenge (`new quiz`)

Built from the research report (`public/locato/research/content-strategy-deep-research.md`):

- **The challenge is on screen at frame 0**: hook title + the first question already visible, no intro.
- **Easy → boss ladder**: 5 rounds by default, rising through Locato's fame tiers; the last is marked **BOSS**.
- **Visible progress**: a `3 / 5` counter (and `♥ 1 life` in One Life mode).
- **Short timers on easy rounds**, longer as it gets harder (about 1.5s → 3.5s for pictures, more for maps).
- **No dead air**: each reveal flows straight into the next round. A 5-round flag quiz runs about 22s.
- **CTA as "level two"**: "What did you score?" then "Got 5/5? Prove it in the full game" + locato.quest.
- **Captions**: everything the voice says is also on screen.

Formats (`--kind`), one per Locato mode:

| `--kind` | Locato mode | The round |
|---|---|---|
| `flags` | Flags | Name the flag |
| `shapes` | Country outlines | Name the outline |
| `capitals` | Capital recall | "Capital of Kenya?" |
| `capital-of` | Capitals | "Whose capital is this? Bern" |
| `codes` | Country codes | "Which country is KZ?" |
| `colours` | Flag colours | The flag fills in colour by colour: "name it before the last colour" |
| `which` | Look-alikes | "Which one is it?": a flag with 2–3 look-alike names |
| `spot` | Spot the country | A country lights up on the map: name it (tiny countries get a ring) |
| `find` | Click the country | "Where is Moldova?": then the pin drops |
| `pin` | MapTap | "Where is Mount Kilimanjaro?": then the pin drops, "In Tanzania" |
| `route` | Overland | "Iran → Kuwait: fewest countries between?": the route lights up |
| `split` | Worldsplit | "Which side has more people?": a line at a new angle each round, then each side shaded with its share |
| `mix` | Every mode | One round from each mode, ending on an Overland boss |

Modes and hooks:

```sh
npm run new -- quiz --kind shapes --mode one-life   # "Miss one and you're out" → "Where did you get eliminated?"
npm run new -- quiz --kind flags --hook b           # hook variants from the report:
#   a "Can you get 5/5?"   b "Only geography nerds get #5"   c "Miss one and you're out"
#   d "This starts easy. It doesn't stay easy."   e "Beat my score: 4/5" (needs --score 4: only a score you really got)   f no hook
npm run new -- quiz --kind route --count 3          # fewer, longer rounds
```

## Studio (build and preview in the admin)
Admin → Promo → **Create**: pick a format, modes, countries, hook, caption, voice and music; the preview plays the real template
with the voice library's lines (any line not recorded yet is listed and silent). 🎲 picks new countries. **Save draft** keeps the
recipe; **Render** queues it. Renders run on the Mac:

    npm run render-runner            # waits for jobs (keeps the Mac awake); Ctrl-C to stop
    npm run render-runner -- --once  # render what's queued, then stop

Each job builds the spec with the same seed as the preview (`--no-fresh`, so the picks match), renders it, and stages it for
posting (on hold if you ticked that). Its status, log and video link show in the Studio's list.

## Recipes and content

A **recipe** says what a video is; `compile()` turns it into the exact spec the template renders. Same recipe + same seed = same video.
The CLI flags just build a recipe, so these are equivalent:

```sh
npm run new -- quiz --modes flag,shape,route --continent Africa --mode one-life --pick "kenya" --boss "eswatini"
```
```json
{"format": "quiz", "modes": ["flag", "shape", "route"], "count": 5,
 "countries": {"include": ["continent:africa"]}, "picks": ["kenya"], "boss": "eswatini",
 "rules": {"mode": "one-life"}, "copy": {"hook": "miss-one"}}
```
Save one as a file and run `npm run new -- quiz --recipe my.json`, or store it as a preset (`--preset <id>`). Other flags override either.
The full format is `src/content/types.ts` (`npm run content -- schema` prints it as JSON Schema).

| Recipe part | What it sets |
|---|---|
| `modes` / `count` / `rounds` | Which modes (cycled), how many rounds, or every round spelled out (`{mode, from, exclude, pick, level, seconds}`). `"mix"` = one of each, Overland boss |
| `countries` | `include` / `exclude` / `require` for the whole video (below) |
| `picks`, `boss` | Exact countries (placed easiest first so the ladder still climbs) and the final round's country |
| `rules` | `mode` score/one-life · `ladder` ladder/thirds · `timer` ladder or `{fixed: 3}` · `baseSeconds` · `boss` |
| `copy` | `hook`, `answer`, `question`, `note`, `cta`, `caption`: a phrase id/alias, or `{text}` for one-off text · `title`, `badge` literal |
| `style` | `music`, `musicVolume`, `effects`, `voice`, `intensity`, `engine` |
| `vars` | Values for placeholders, e.g. `{score: 4}` for hook E |

**Choosing countries.** References: a code or name (`JP`, `"south africa"`), `continent:europe`, `theme:islands` (the game's daily themes),
`level:easy|medium|hard` (fame tier), `list:<id>` (a country list from content), `all`. In `include`, alternatives of the same kind
combine with *or* and different kinds narrow each other: `continent:asia,continent:europe,level:easy` = easy countries in Asia or Europe.
`exclude` removes any match from the whole video, including Overland stops and look-alike options.

```sh
npm run new -- quiz --kind flags --from continent:asia,level:easy      # easy Asian flags
npm run new -- quiz --kind flags --list my-picks --exclude FR,GB       # from a saved country list, minus two
npm run new -- quiz --kind which --pick chad                           # the look-alike set Chad belongs to
```

**Content** is data, not code: **phrases** (every hook, spoken answer, outro question, note, CTA and caption, with `suits` rules so
"Miss one and you're out" only goes on One Life videos), **lists** (named country lists), **presets** (saved recipes) and **plans**
(the week: `new:week` builds from `plans.json`, default plan `default`). Defaults live in `content/*.json` (in git). The promo
service holds online additions and overrides, merged by id (`"disabled": true` hides a default), so the set can grow without code
changes. Edit them in the admin (Promo → Content) or from here; the tools read a local copy, so making videos works offline.

```sh
npm run content                          # what's loaded (default / R2)
npm run content -- list phrases          # or lists, presets, plans
npm run content -- validate              # schemas, references, every preset/plan recipe compiles
npm run content -- pull                  # refresh the local copy of the online items (.cache/content)
npm run content -- export lists > my-lists.json      # edit, then:
npm run content -- push lists my-lists.json          # save online (each item added or replaced by id)
npm run content -- rm lists my-list                  # remove an online item
```

A new game mode is one `ModeDef` in `src/content/modes/` (label, hashtags, timer base, spoken answer, builder) plus its renderer
in `src/locato/templates/Quiz.tsx`.

## Results tracking

Every spec records its creative variables in `props.meta` (format, mode, hook, count, timers) for comparing results,
and writes `<name>.caption.txt` with a short caption, 3 hashtags and a tracking link (`locato.quest/?ref=<name>`).
Paste the caption when posting. Use a TikTok Business account (link in bio), Instagram Trial Reels for new hooks, and judge videos on engaged views / % viewed, not raw views.

Data comes from the game: map shapes, borders (Overland), MapTap places, population (Worldsplit) and look-alikes are exported by `npm run locato:sync`. Overland follows the game's own border rules, including edge cases like Spain–Morocco (Ceuta): correct by the game, and good for comments.

## Voiceover (free, runs on your Mac)

`npm run new` adds a short, energetic spoken voiceover automatically, made locally with **Chatterbox** (Resemble AI, MIT licence: free for commercial use, no account). Its *exaggeration* setting makes it sound like a quiz host rather than a narrator. A full quiz takes about 2–3 minutes to voice.

What it says:

| Moment | Line |
|---|---|
| Opening (over the title) | the hook: "Can you name these 6 flags?" / "Warm up for today's Daily: Across Africa!" / "The top 3 on the Flags leaderboard." |
| Each reveal | "That's Kyrgyzstan!" (look-alikes: the names in order) |
| Winner (versus, leaderboard) | "Alex wins!" / "atlas_amy takes first place!" |
| Closing question | "How many did you get out of 6? Comment your score!" |
| End card | "Play it free at locato dot quest!" |

Timings stretch to fit the speech (long names never get cut off), and the music dips under the voice.
Every new line is transcribed with local Whisper; if a word comes out garbled it is regenerated (up to 3 tries) and you're warned if it's still unclear.

```sh
npm run new -- quiz                           # lively (default)
npm run new -- quiz --intensity hype          # most excited; also: calm
npm run new -- quiz --voice am_michael        # a different voice (male); default is Chatterbox's own
npm run new -- quiz --voice none              # no voiceover
npm run new -- quiz --engine kokoro           # the older, faster, calmer engine (seconds instead of minutes)
npm run voice -- videos/<file>.json --check   # re-voice a spec after editing it; --check prints what Whisper hears per line
```

`--voice` takes any Kokoro voice name (`af_heart`, `af_bella`, `am_michael`, `am_fenrir`, `bm_george`, `bf_emma`, …): Chatterbox copies that voice's timbre from a short sample (saved in `tools/voice/refs/`), then adds the energy. It also takes a path to a `.wav` of any voice you have the rights to (10 seconds of clear speech). Note that `hype` raises pitch for every voice.

Change a line by adding `"voiceText": {"hook": "...", "result": "...", "outro": "...", "cta": "..."}` to the spec's props, then `npm run voice -- videos/<file>.json`.
Names that come out wrong are respelled in `SAY` at the top of `tools/voice/voice.mjs`. Usernames are read phonetically, so override `result` for odd ones.

Setup (already done on this Mac): Chatterbox lives in its own Python environment, `tools/voice/.venv` (`uv venv tools/voice/.venv --python 3.11 && uv pip install --python tools/voice/.venv/bin/python chatterbox-tts "setuptools<81"`). Without it, the tools fall back to Kokoro automatically.

### Voice library

**The default voice is George** (`PROMO_VOICE_LIBRARY=george` in `.env`): `npm run new` / `new:week` take every line George
already has from the library and only record what's missing (with George's settings), adding those to the library too.
Fill a whole voice in one go (every line the templates can say, about 1,000), checked and uploaded as it goes, resumable:

```sh
npm run voices:build -- george --list           # what it would record (and which names are respelled)
caffeinate -dimsu npm run voices:build -- george   # record; lines that keep failing go to out/voice-build/george/report.json
```

**Pronunciation:** `content/pronunciations.json` holds respellings for names voices get wrong (Ouagadougou → "Wah-gah-doo-goo").
Every voice uses it. Each take is checked by Whisper: fixed words must be heard in order, names are judged by their consonant
sounds (so odd spellings of a correct name pass, mispronunciations don't; British dropped r's are fine). Add a name only when a
voice gets it wrong: respelling a name it already says well can make it worse.


A shared **voice library**: one clip per line per voice, reused by every video that says it ("That's Kenya!" is recorded once).
Clips are made on the Mac (`npm run voice`) or recorded by a person, then uploaded through the promo service, which keeps the audio
in the public bucket (media.locato.quest) and the record in its database. Nothing is generated on a server. A new voice or line is
selectable in the admin (Promo → Voices) the moment it's uploaded, and you can upload from there too.

```sh
npm run voices                                           # voices and how many lines each has
npm run voices -- create tate --name "Tate" --engine human
npm run voices -- add tate "That's Kenya!" kenya.wav     # one line (wav, mp3, m4a; --replace for a new take)
npm run voices -- missing tate videos/2026-11-16-*.json --csv sheet.csv   # what these videos need; a recording sheet
npm run voices -- import tate sheet.csv                  # after recording: columns text,file (paths relative to the CSV)
npm run voices -- from-spec chatterbox-lively videos/x.json   # upload clips `npm run voice` already made on the Mac
npm run voices -- apply tate videos/x.json               # point a video's voice at the library (--partial keeps old clips for missing lines)
npm run voices -- ls tate --search kenya   ·   rm tate "That's Kenya!"   ·   hide tate
```

A clip's key comes from the line's text (case and spacing don't matter); a new take gets a new file name, so no cache serves an
old take. The audio is public: only upload clips you're happy to share. `npm run render` downloads library clips into
`public/locato/voice-cache/` and renders from there (Remotion mixes remote audio slightly quieter; a local copy keeps renders identical).

## Sound

Every video has sound by default:

- **Game sounds**, recreated from Locato's own `sfx.ts` (same notes and waveforms): a soft whoosh as each round arrives, a tick for every second of the countdown, the game's "correct" chime on the reveal, a ping for captions and the closing question, and the victory fanfare on the end card, when a speedrun clock stops, or when a versus winner is shown.
- **Background music**, a different licensed track per template, fading in and out:

| Template | Default track | File |
|---|---|---|
| quiz | Gummies (Michael Ramir C.) | `gummies` |
| daily | PlaceIt World 01 (Lily J) | `placeit-world` |
| lookalikes | Close Up (Michael Ramir C.) | `close-up` |
| speedrun | Running Out of Time (Ahjay Stelino) | `running-out-of-time` |
| versus | What About Action? (Diego Nava) | `what-about-action` |
| leaderboard | Motivating Mornings (Ahjay Stelino) | `motivating-mornings` |

All are from Mixkit under its free stock-music license (commercial and social-media use, no attribution needed; not for use inside the game itself). Details: `public/locato/music/LICENSES.md`. To swap tracks, edit `tools/locato/fetch-music.py` and re-run it.

Change it per video:

```sh
npm run new -- quiz --music running-out-of-time   # any track in the library, by name
npm run new -- quiz --music none                  # no music, keep the game sounds
npm run new -- quiz --music ~/Music/track.mp3 --music-volume 0.5   # your own track
npm run new -- quiz --effects off                 # no game sounds
```

or edit the JSON: `"music": false`, `"music": {"src": "locato/music/track.mp3", "volume": 0.4}`, `"effects": false`.
Recordings in speedrun/versus are muted unless you pass `--sound true`.
The sounds are generated by `python3 tools/locato/make-sounds.py`; edit it to change them (for example the music bed's chords or tempo).
Platforms (TikTok, Reels, Shorts) also let you add a trending sound on top when posting: use `--music none` for those.

## Posting (automatic, free)

Posting runs in the **promo service** (a Cloudflare Worker, separate from the game). Stage a rendered batch; its timer keeps
Buffer topped up and records what went out.

```bash
npm run stage -- videos/2026-11-16-*.json      # upload + queue (13:00 and 19:00 Johannesburg by default)
npm run queue                                  # status; --hold / --release / --remove <name>; --run; --done
npm run queue -- --move <name> 2026-11-12T18:00  # a new time (posts already in Buffer are moved too; or Promo → Queue → Move)
npm run publish -- videos/x.json               # stage with a start of "now", then post straight away
npm run stage -- --video ~/Desktop/clip.mp4 --caption "…"   # any finished mp4 you made yourself (or Promo → Queue → Upload a video)
```

Also in the admin: Promo → Queue, Posted (with visitors per video from its ?ref= link), Runs.
Details: `social/profile-setup.md` → Automatic posting. Infrastructure: `infra/README.md`.

## Editing a video by hand

Open the JSON and change anything: titles, answers, notes, order, `secondsPerRound`. Durations follow the content automatically.

## Keeping it right

- **Leaderboards show real usernames.** The tool replaces names that match a blocklist with "Player N" and prints them, but always read the names before posting. Use `--hide` or `--anon`, and ideally ask top players before featuring them.
- **No Street View imagery and no "GeoGuessr" name** in promo videos (Google's terms; someone else's trademark).
- **Recordings for speedrun/versus:** record the game in a phone-sized browser window (or on your phone) with the seeded dev data (`npm run dev:seeded` in the locato repo) or your own account. `ffmpeg` is not needed; the tool reads size and length itself.

## Keeping in sync with the game

`npm run locato:sync` copies flags, outlines, the logo and the country/capital/difficulty/look-alike/theme data from the game (the Locato repo this folder lives in). Run it after changing those in the game.

## Where things live

- `src/locato/`: brand (colours, fonts), shared pieces, one file per template in `templates/`
- `src/content/`: the data model and `compile()` (pure TypeScript, no Node: runs in the CLI, server or browser). `types.ts` (schemas), `game.ts` (data, seeds, choosing countries), `phrases.ts`, `modes/` (one definition per game mode)
- `content/`: default phrases, lists, presets and plans (R2 adds to these)
- `tools/locato/`: `sync.ts`, `new.ts`, `week.ts`, `content.ts`, `env.ts` (Node side: loading data and content, writing specs), `queue.ts`, `autopost.ts`, `publish.ts` (posting)
- `tools/voice/`: local voiceover (Chatterbox, Kokoro fallback, Whisper check)
- `tools/render.mjs`: render or check any spec
- `worker/`: the promo service (Cloudflare Worker + D1): API for the tools and the admin, and the posting timer
- `infra/`: Terraform for the Cloudflare resources (see its README)

Narrated explainers (Higgsfield pictures, ElevenLabs voice) are a separate project: `video-experimentation`.
To post one on the Locato channels, stage its spec from here: `npm run stage -- ../../video-experimentation/videos/<name>.json`
(a spec's `"file"` path is relative to its own project).
