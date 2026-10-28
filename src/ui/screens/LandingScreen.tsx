import { createRoot, type Root } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Binoculars,
  CalendarDays,
  Compass,
  Check,
  Crown,
  Eye,
  Flag,
  Globe,
  GraduationCap,
  Hash,
  MapPin,
  MousePointerClick,
  Orbit,
  Palette,
  Plane,
  Puzzle,
  RotateCcw,
  Route,
  Shapes,
  Share2,
  Split,
  Users,
} from "lucide-react";
import type { ShellContext } from "../shell/types";
import { SiteHeaderMount } from "../shell/react";
import { isSoloSaveResumable, readLatestSoloSave, readSoloSave } from "../../storage/localSave";
import { readAcademyProgress } from "../../storage/academySave";
import { getAchievementState } from "../../storage/achievements";
import { readDailyOnDevice, type DailyResultSave } from "../../storage/dailySave";
import { academyLevel } from "../../core/academy/mastery";
import { DAILY_COUNTRY_COUNT, DAILY_FORMAT, DAILY_MAX_SCORE, getLocalDailyDate, type DailyRoundMark } from "../../core/dailyChallenge";
import { overlandDailyNumber } from "../../core/overland/routes";
import { mysteryDailyNumber } from "../../core/mystery/round";
import { shareLink } from "../../core/shareLink";
import { shareResult } from "../shell/ResultsCard";
import { dailyThemeForDate } from "../../core/dailyThemes";
import { GAME_MODE_GROUPS, gameModeCatalogueEntry, isPromptGameModeId, type GameModeCatalogueEntry, type GameModeGroup, type GameModeId } from "../../core/gameModes";
import type { Screen } from "../../app/router";
import type { CountryIndex } from "../../core/countries";
import { LandingGlobe } from "../components/landing/LandingGlobe";

/*
 * Play → the landing page (docs/navigation.md). It leads with today's daily challenge (the
 * thing new visitors arrive for), then the game library. Split modes start a PRACTICE run here: no clock,
 * nothing posted. Single-run modes (Worldsplit, Flyover, GeoGuessr, Street View country) have one
 * way to play, so they open the real thing. Timed runs live in Leaderboards, live games in Multiplayer; the daily in Daily. The shared SiteHeader carries
 * the navigation, so the page itself has no nav links of its own.
 */

export interface LandingScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell: ShellContext;
  readonly countryIndex: CountryIndex;
  readonly storage?: Storage;
  /** Clock override for tests. */
  readonly now?: () => Date;
}

type LucideIcon = typeof Flag;

const MODE_ICONS: Readonly<Record<GameModeId, LucideIcon>> = {
  flags: Flag,
  "flag-colors": Palette,
  shapes: Shapes,
  codes: Hash,
  capitals: Crown,
  "capital-recall": MapPin,
  "name-all": Globe,
  "click-country": MousePointerClick,
  "spot-country": Eye,
  puzzle: Puzzle,
  "map-tap": Orbit,
  worldsplit: Split,
  flyover: Plane,
  overland: Route,
  mystery: Compass,
  geoguessr: MapPin,
  "streetview-country": Binoculars,
};

const COUNTRY_COUNT = 196;
const DAY_MS = 86_400_000;

/** "42/196" for a mode's saved practice run, or null when there is nothing to resume. */
export function modeResumeProgress(storage: Storage | undefined, mode: GameModeId): string | null {
  if (!storage || !isPromptGameModeId(mode)) return null;
  const save = readSoloSave(storage, [mode]);
  if (!save || !isSoloSaveResumable(save) || save.guessedCountryCodes.length === 0) return null;
  return `${save.guessedCountryCodes.length}/${save.poolCountryCodes.length}`;
}

/** The most recently played practice run: its mode and "Flags · 42/196", or null. */
function latestResume(storage?: Storage): { readonly mode: GameModeId; readonly label: string } | null {
  if (!storage) return null;
  const save = readLatestSoloSave(storage);
  const id = save?.categoryIds.length === 1 ? save.categoryIds[0] : undefined;
  if (!save || !id || !isPromptGameModeId(id)) return null;
  return { mode: id, label: `${gameModeCatalogueEntry(id).label} · ${save.guessedCountryCodes.length}/${save.poolCountryCodes.length}` };
}

export interface DailyStatus {
  readonly done: boolean;
  /** Rounds finished in today's unfinished daily (0 when not started). */
  readonly roundsPlayed: number;
  /** Consecutive days completed, counting today or (if today isn't done yet) up to yesterday. */
  readonly streak: number;
  /** Today's result as this device has it, once done. */
  readonly result: DailyResultSave | null;
}

function dayNumber(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null;
}

/** Today's daily from local storage: done, in progress, and the running streak. */
export function readDailyStatus(storage: Storage | undefined, now = new Date()): DailyStatus {
  if (!storage) return { done: false, roundsPlayed: 0, streak: 0, result: null };
  const today = getLocalDailyDate(now);
  const days = new Set(getAchievementState(storage).dailyDates.map(dayNumber).filter((day): day is number => day !== null));
  const todayNumber = dayNumber(today);
  const onDevice = readDailyOnDevice(storage, today);
  const done = onDevice.result !== null || (todayNumber !== null && days.has(todayNumber));
  if (done && todayNumber !== null) days.add(todayNumber);
  let streak = 0;
  if (todayNumber !== null) for (let day = done ? todayNumber : todayNumber - 1; days.has(day); day -= 1) streak += 1;
  return { done, roundsPlayed: done ? 0 : onDevice.roundsPlayed, streak, result: onDevice.result };
}

const FORMAT_ICONS: Readonly<Record<(typeof DAILY_FORMAT)[number]["icon"], LucideIcon>> = {
  flag: Flag, crown: Crown, shapes: Shapes, "map-pin": MapPin, route: Route, globe: Orbit, binoculars: Binoculars,
};

const MARK_LABELS: Readonly<Record<DailyRoundMark, string>> = { correct: "correct", hint: "with a hint", miss: "missed" };

/** "9h 12m" until the next local midnight, when a new daily starts. */
export function untilNextDaily(now: Date): string {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const minutes = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** The page's lead: today's daily, to play, continue or share. */
function LandingDaily({ shell, storage, now }: LandingScreenOptions) {
  const [clock, setClock] = useState(() => now?.() ?? new Date());
  const [shareNote, setShareNote] = useState<string | null>(null);
  useEffect(() => {
    // Keeps the countdown current, and rolls the card over at midnight on an open page.
    const timer = window.setInterval(() => setClock(now?.() ?? new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [now]);
  const date = getLocalDailyDate(clock);
  const theme = dailyThemeForDate(date);
  const daily = readDailyStatus(storage, clock);
  const state = daily.done ? "done" : daily.roundsPlayed > 0 ? "in-progress" : "new";
  const dateLabel = clock.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const result = daily.result;
  const open = () => shell.openSection("daily");
  const share = () => {
    if (!result) return;
    void shareResult({ text: `${result.shareText}\n${shareLink({ view: "daily-challenge" })}`, title: "Locato daily challenge" }).then((outcome) => {
      if (outcome === "shared") return;
      setShareNote(outcome === "copied" ? "Copied" : "Couldn't share");
      window.setTimeout(() => setShareNote(null), 1600);
    });
  };

  return <section className="landing-daily" data-testid="landing-daily" data-state={state} aria-labelledby="landing-daily-title">
    <div className="landing-daily-main">
      <p className="landing-daily-kicker"><CalendarDays size={15} strokeWidth={1.8} aria-hidden="true" /> Daily challenge <span aria-hidden="true">·</span> <time dateTime={date}>{dateLabel}</time></p>
      <h1 id="landing-daily-title">{state === "done" ? "Today's challenge, done." : "Today's geography challenge"}</h1>
      <p className="landing-daily-theme"><strong>{theme.title}.</strong> {state === "done" ? "A new one starts at midnight. Same puzzle for everyone, so compare with friends." : `${theme.description} Ten rounds, the same for everyone today. Free, no sign-up.`}</p>
      <div className="landing-daily-actions">
        {state === "done"
          ? <>
            <button type="button" className="lp-btn lp-btn-primary" data-testid="button-daily-result" onClick={open}>See your result <ArrowRight size={17} /></button>
            {result ? <button type="button" className="lp-btn" data-testid="button-daily-share" onClick={share}><Share2 size={16} /> {shareNote ?? "Share"}</button> : null}
          </>
          : <button type="button" className="lp-btn lp-btn-primary landing-daily-play" data-testid="button-daily-play" onClick={open}>
            {state === "in-progress" ? `Continue · round ${daily.roundsPlayed + 1} of ${DAILY_COUNTRY_COUNT}` : "Play today's challenge"} <ArrowRight size={17} />
          </button>}
        {daily.streak > 0 ? <span className="landing-daily-streak" data-testid="daily-streak">{daily.streak}-day streak{state === "done" ? "" : " · keep it going"}</span> : null}
      </div>
      <p className="landing-daily-more">
        <span>Also today:</span>
        <button type="button" data-testid="button-daily-overland" onClick={() => shell.openDailyPuzzle?.("overland")}><Route size={14} aria-hidden="true" /> Overland #{overlandDailyNumber(date)}</button>
        <button type="button" data-testid="button-daily-mystery" onClick={() => shell.openDailyPuzzle?.("mystery")}><Compass size={14} aria-hidden="true" /> Mystery country #{mysteryDailyNumber(date)}</button>
      </p>
    </div>
    <div className="landing-daily-side">
      {result
        ? <div className="landing-daily-score">
          <p><strong>{result.score}</strong><span>/{DAILY_MAX_SCORE}</span></p>
          <ol className="landing-daily-grid" aria-label="Your rounds">
            {result.marks.map((mark, index) => <li key={index} className={`is-${mark}`} aria-label={`Round ${index + 1}: ${MARK_LABELS[mark]}`} />)}
          </ol>
          <p className="landing-daily-next">Next challenge in {untilNextDaily(clock)}</p>
        </div>
        : <ol className="landing-daily-format" aria-label="Today's rounds">
          {DAILY_FORMAT.map((stage) => { const Icon = FORMAT_ICONS[stage.icon]; const first = Number(stage.rounds.split("–")[0]); return <li key={stage.label} data-done={first <= daily.roundsPlayed ? "true" : undefined}>
            <Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span>{stage.label}</span><small>{stage.rounds.includes("–") ? "Rounds" : "Round"} {stage.rounds}</small>
          </li>; })}
        </ol>}
    </div>
  </section>;
}

function LandingGamePicker({ shell, storage, countryIndex }: LandingScreenOptions) {
  const [group, setGroup] = useState<GameModeGroup>(GAME_MODE_GROUPS[0]!);
  const [mode, setMode] = useState<GameModeCatalogueEntry>(GAME_MODE_GROUPS[0]!.modes[0]!);
  const allModes = GAME_MODE_GROUPS.flatMap((item) => item.modes);
  const latest = latestResume(storage);
  const play = (id: GameModeId) => shell.openGame(id, "practice");

  return <section className="landing-hero game-picker" id="games" aria-labelledby="landing-title">
    <div className="mode-picker-menu">
      <header className="mode-picker-heading">
        <div>
          <h2 id="landing-title">Or pick a game.</h2>
          <p className="mode-picker-sub">Practice at your own pace. Score games like GeoGuessr and Flyover post your best.</p>
        </div>
        <span>{allModes.length} games</span>
      </header>
      <div className="mode-picker-tabs" role="group" aria-label="Game groups">
        {GAME_MODE_GROUPS.map((item) => <button type="button" key={item.id} aria-pressed={group.id === item.id} onClick={() => { setGroup(item); setMode(item.modes[0]!); }}>
          {item.label}<span>{item.modes.length}</span>
        </button>)}
      </div>
      <div className="mode-picker-options" role="group" aria-label={`${group.label} games`}>
        {group.modes.map((item) => { const Icon = MODE_ICONS[item.id]; const saved = modeResumeProgress(storage, item.id); return <button type="button" className="mode-picker-option" key={item.id} data-testid={`picker-mode-${item.id}`} aria-pressed={mode.id === item.id} onClick={() => { setMode(item); play(item.id); }}>
          <Icon size={19} strokeWidth={1.5} /><span className="mode-picker-option-label">{item.label}{saved ? <small className="mode-picker-saved" aria-label={`, saved run ${saved}`}>{saved}</small> : null}</span><span className="mode-picker-indicator" aria-hidden="true">{mode.id === item.id ? <Check size={12} /> : null}</span>
        </button>; })}
      </div>
      {latest ? <div className="mode-picker-shortcuts">
        <button type="button" data-testid="button-resume-latest" onClick={() => play(latest.mode)} aria-label={`Resume ${latest.label}`}><RotateCcw size={15} /> Resume {latest.label} <ArrowRight size={15} /></button>
      </div> : null}
    </div>
    <section className="mode-atlas-preview" id="mode-preview" aria-label="Explore the world">
      <LandingGlobe countryIndex={countryIndex} onOpenCountry={shell.openCountry} />
    </section>
  </section>;
}

function LandingMoreWays({ shell }: LandingScreenOptions) {
  return <section className="landing-more" aria-label="More ways to play">
    <button type="button" className="landing-more-card is-compete" data-testid="card-multiplayer" onClick={() => shell.openSection("multiplayer")}>
      <span className="landing-more-icon" aria-hidden="true"><Users size={22} strokeWidth={1.6} /></span>
      <span className="landing-more-copy"><strong>Play friends live</strong><span>Open a room, share the link, and race up to 7 friends in real time.</span></span>
      <ArrowRight className="landing-more-arrow" size={18} />
    </button>
  </section>;
}

function LandingAcademyBanner({ shell, storage }: LandingScreenOptions) {
  const progress = readAcademyProgress(storage);
  const started = progress.placementCompletedAt !== null || Object.keys(progress.cards).length > 0;
  const rank = academyLevel(progress);
  return <section className="landing-academy" aria-labelledby="landing-academy-title">
    <span className="landing-academy-icon" aria-hidden="true"><GraduationCap size={24} strokeWidth={1.5} /></span>
    <div className="landing-academy-copy">
      <h2 id="landing-academy-title">{started ? `Academy · ${rank.level.title}` : "New to geography? Start in the Academy."}</h2>
      <p>{started ? `${rank.mastered} of ${COUNTRY_COUNT} countries mastered. Pick up where you left off.` : "Take a two-minute placement quiz, then learn the world one region at a time, at your own pace."}</p>
    </div>
    <button type="button" className="lp-btn lp-btn-primary landing-academy-cta" data-testid="button-academy" onClick={() => shell.openSection("learn")}>{started ? "Continue in the Academy" : "Find your level"}<ArrowRight size={17} /></button>
  </section>;
}

function LandingHome(options: LandingScreenOptions) {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id === "games" || id === "landing-title") document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);

  return (
    <div className="landing-root">
      <a className="landing-skip-link" href="#games">Skip to games</a>
      <SiteHeaderMount ctx={options.shell} section="play" />
      <main className="landing-scroll" id="landing-main">
        <LandingDaily {...options} />
        <LandingGamePicker {...options} />
        <LandingMoreWays {...options} />
        <LandingAcademyBanner {...options} />
      </main>
    </div>
  );
}

export function createLandingScreen(options: LandingScreenOptions): Screen {
  const element = document.createElement("section");
  element.className = "landing-screen-shell";
  element.dataset.shell = "site";
  element.dataset.section = "play";
  const root: Root = createRoot(element);
  root.render(<LandingHome {...options} />);
  return { element, destroy: () => root.unmount() };
}
