# Locato profile setup (TikTok, Instagram, YouTube)

## Images (in this folder)

| File | Use | Size |
|---|---|---|
| `profile-picture.png` | Profile photo on all three (they crop it to a circle) | 1080×1080 |
| `youtube-banner.png` | YouTube channel banner (text sits in the area every device shows) | 2560×1440 |
| `highlight-flags.png`, `-maps`, `-capitals`, `-daily` | Instagram Story highlight covers | 1080×1920 |

They use the same colours, grid, pin and font as the videos. To change them: `src/locato/brandkit.tsx`, then
`npx remotion still LocatoAvatar social/profile-picture.png` (or `LocatoBanner`, `LocatoHighlight --props='{"label":"Flags","code":"jp"}'`).

## Names

- **Display / name field:** `Locato | Geography Quiz`. The name field is searchable on Instagram and TikTok, so the keywords help people find you.
- **Handle:** the same everywhere if you can: `@locato`, else `@locatoquest`, else `@playlocato`.

## Bios

**TikTok** (80 characters max)
```
Daily geography challenges 🌍 Can you get 5/5? Play free 👇
```

**Instagram** (150 max)
```
Geography challenges every day 🌍
Flags · maps · capitals · borders
Can you get 5/5? Play the full game free ↓
```

**YouTube** (channel description)
```
Geography challenges you can play along with: flags, country outlines, capitals, maps, borders and more.
Every Short is a quick quiz: easy start, boss finish. Comment your score!

Play the full game free in your browser: https://locato.quest/?ref=yt-about
New challenges every day.
```

## Links (one per platform, so you can see where players come from)

| Platform | Bio link |
|---|---|
| TikTok | `https://locato.quest/?ref=tt-bio` |
| Instagram | `https://locato.quest/?ref=ig-bio` |
| YouTube (about + banner link) | `https://locato.quest/?ref=yt-about` |
| Per video (from `.caption.txt`) | `https://locato.quest/?ref=<video>` |

Check that the game records the `ref` parameter, for example in Locato's analytics, before relying on these numbers.

## Account settings

- **TikTok: switch to a Business Account.** It allows a clickable website link in the bio and gives analytics. It limits you to TikTok's Commercial Music Library, which is fine: our videos carry their own licensed music.
- **Instagram: Professional account (Creator or Business).** Use **Trial Reels** for new formats and hook tests; they're shown to non-followers first, so a weak test doesn't hit your followers' feeds.
- **YouTube:** add the website link to the channel (Customise channel → Links), and use YouTube Studio to schedule Shorts.

## Automatic posting (the promo service → Buffer)

You make and check the week by hand. Posting is automatic after that, in the **promo service**: a Cloudflare Worker with
its own database, separate from the game (`promo.locato.quest`; set up with `infra/README.md`).

```bash
npm run new:week && npm run render -- videos/2026-11-16-*.json   # make + render (manual, as before)
npm run stage -- videos/2026-11-16-*.json --dry-run              # preview the times
npm run stage -- videos/2026-11-16-*.json                        # upload + queue. Done.
```

Every 4 hours the service tops each Buffer channel back up to 10 scheduled posts from the queue, in time order. So you
can stage a whole week, or several, though Buffer's free plan holds 10. It makes no Buffer requests when nothing is waiting.

```bash
npm run queue                           # every queued video: waiting / in Buffer / on hold / problems
npm run queue -- --hold <name>          # don't post it (yet); --release <name> to undo
npm run queue -- --remove <name>        # take it out (its unsent Buffer posts are deleted; the record stays)
npm run queue -- --run                  # top up Buffer now instead of waiting for the timer
npm run queue -- --last-run             # what the last run did
npm run queue -- --done                 # posted videos, with their live links
npm run publish -- videos/x.json        # stage with a start of "now" and post straight away (--every 15 for a batch)
```

**Videos you made yourself** (CapCut, a screen recording, an explainer…) go through the same queue:

```bash
npm run stage -- --video ~/Desktop/road-trip.mp4 --caption "How many countries can you name? 👇 #geography #maps #quiz" \
  [--title "YouTube title"] [--name road-trip] [--channels tiktok,youtube] [--start 2026-11-20T19:00] [--hold] [--dry-run]
npm run publish -- --video ~/Desktop/road-trip.mp4 --caption "…"     # post it now
```
Or from anywhere, in the admin: **Promo → Queue → Upload a video** (file, caption, optional YouTube title, channels, time, hold).
Both check the file first: portrait (9:16), at most 60 MB and 10 minutes, with warnings for anything platforms may crop or not
treat as a Short/Reel. The name becomes its tracking link (`locato.quest/?ref=roadtrip`), so it shows with visitors in Posted.
A video that's already in Buffer or posted can't have its file swapped: upload a new take under another name.
`--channels` works for rendered videos too.

The same controls are in the admin: **Promo** → Queue, Posted (with visitors, plays and sign-ups per video from its
`?ref=` link), Content, Voices, Music, Runs.

- **Times:** 13:00 and 19:00 Johannesburg. `<date>-am-…` is 13:00 and `<date>-pm-…` is 19:00. Other names take the next free slot after everything already queued.
  - For one batch, use `--times 12:00,18:00` or `--start now|HH:MM|YYYY-MM-DDTHH:MM --every 60`.
  - The service's own times are `TIMES` in `worker/wrangler.jsonc`.
- **Late videos:** if a video's time passes while Buffer was full, it moves to the next free slot instead of being skipped.
- **What it posts:**
  - TikTok and Instagram: the `.caption.txt` line plus "link in bio". Instagram posts as a Reel, also shared to the feed. TikTok is **not** marked as AI content.
  - YouTube: a title (or the spec's `youtubeTitle`) and a description with the `?ref=` link, category Education.
- **After posting:** once every channel's time has passed, the service asks Buffer how each post went. Sent posts get their live link and time, and the video is marked posted. Nothing is deleted: the video file keeps its link, and the record stays. A channel that failed or was deleted in Buffer shows a ⚠ until you deal with it.
- **To fix a post** already in Buffer, edit it in Buffer. Before that, `--remove` it and stage it again.
- **Keys (`promo/.env`):** `PROMO_SERVICE_TOKEN` is all the Mac tools need. `BUFFER_API_KEY` lives in the service as a secret. `CLOUDFLARE_*` are only for infrastructure and deploys.

## Pinned posts (pin 3 on TikTok and Instagram)

1. Your best-performing quiz (after week one; until then, the **every-mode mix**, which shows the whole game).
2. A **One Life** video (strong comment driver).
3. A **Daily warm-up**, so new visitors see there's something new every day.

## Instagram highlights

Flags · Maps · Capitals · Daily, using the covers in this folder. Add your story reposts of each series.

## First week checklist

- [ ] Upload the profile picture to all three; the banner to YouTube
- [ ] Set display names, handles and bios
- [ ] TikTok Business Account + bio link; Instagram Professional + link; YouTube link
- [ ] Generate the week: `npm run new:week`, check, render
- [ ] Queue them: `npm run stage -- videos/<week>-*.json` (see Automatic posting above), then check Promo → Queue in the admin
- [ ] Pin your own "Drop your score" comment on every post
- [ ] Use Instagram Trial Reels for the hook tests
- [ ] End of week: log views, % viewed, comments and site visits per video, and keep the winning hook
