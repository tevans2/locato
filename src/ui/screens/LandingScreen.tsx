import { createRoot, type Root } from "react-dom/client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Binoculars,
  CalendarDays,
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
  Shapes,
  Split,
  Users,
} from "lucide-react";
import type { ShellContext } from "../shell/types";
import { SiteHeaderMount } from "../shell/react";
import { isSoloSaveResumable, readLatestSoloSave, readSoloSave } from "../../storage/localSave";
import { readAcademyProgress } from "../../storage/academySave";
import { getAchievementState } from "../../storage/achievements";
import { dailyProgressKey } from "../../storage/dailySave";
import { academyLevel } from "../../core/academy/mastery";
import { DAILY_COUNTRY_COUNT, getLocalDailyDate } from "../../core/dailyChallenge";
import { dailyThemeForDate } from "../../core/dailyThemes";
import { GAME_MODE_GROUPS, gameModeCatalogueEntry, isPromptGameModeId, type GameModeCatalogueEntry, type GameModeGroup, type GameModeId } from "../../core/gameModes";
import type { Screen } from "../../app/router";
import type { CountryIndex } from "../../core/countries";
import { LandingGlobe } from "../components/landing/LandingGlobe";

/*
 * Play → the landing page (docs/navigation.md). Split modes start a PRACTICE run here: no clock,
 * nothing posted. Single-run modes (Worldsplit, Flyover, GeoGuessr, Street View country) have one
 * way to play, so they open the real thing. Timed runs live in Compete; the daily in Daily. The shared SiteHeader carries
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
}

function dayNumber(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null;
}

/** Today's daily from local storage: done, in progress, and the running streak. */
export function readDailyStatus(storage: Storage | undefined, now = new Date()): DailyStatus {
  if (!storage) return { done: false, roundsPlayed: 0, streak: 0 };
  const today = getLocalDailyDate(now);
  const days = new Set(getAchievementState(storage).dailyDates.map(dayNumber).filter((day): day is number => day !== null));
  const todayNumber = dayNumber(today);
  const done = todayNumber !== null && days.has(todayNumber);
  let streak = 0;
  if (todayNumber !== null) for (let day = done ? todayNumber : todayNumber - 1; days.has(day); day -= 1) streak += 1;
  let roundsPlayed = 0;
  if (!done) {
    try {
      const progress = JSON.parse(storage.getItem(dailyProgressKey(null)) ?? "null") as { date?: string; roundIndex?: number } | null;
      if (progress?.date === today && typeof progress.roundIndex === "number") roundsPlayed = Math.max(0, Math.min(DAILY_COUNTRY_COUNT, progress.roundIndex));
    } catch {
      roundsPlayed = 0;
    }
  }
  return { done, roundsPlayed, streak };
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
          <h1 id="landing-title">Choose a game.</h1>
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

function LandingMoreWays({ shell, storage, now }: LandingScreenOptions) {
  const today = now?.() ?? new Date();
  const daily = readDailyStatus(storage, today);
  const dailyLine = daily.done
    ? `Done for today${daily.streak > 1 ? ` · ${daily.streak}-day streak` : ""}. See your result.`
    : daily.roundsPlayed > 0
      ? `In progress · round ${daily.roundsPlayed + 1} of ${DAILY_COUNTRY_COUNT}. Pick up where you left off.`
      : `${dailyThemeForDate(getLocalDailyDate(today)).title} · ${DAILY_COUNTRY_COUNT} rounds, the same for everyone today.${daily.streak > 0 ? ` Keep your ${daily.streak}-day streak going.` : ""}`;
  return <section className="landing-more" aria-label="More ways to play">
    <button type="button" className="landing-more-card is-daily" data-testid="card-daily" data-state={daily.done ? "done" : daily.roundsPlayed > 0 ? "in-progress" : "new"} onClick={() => shell.openSection("daily")}>
      <span className="landing-more-icon" aria-hidden="true">{daily.done ? <Check size={22} strokeWidth={2} /> : <CalendarDays size={22} strokeWidth={1.6} />}</span>
      <span className="landing-more-copy"><strong>Today’s daily challenge</strong><span>{dailyLine}</span></span>
      {daily.streak > 0 ? <span className="landing-more-streak" aria-label={`${daily.streak}-day streak`}>{daily.streak}<small>day{daily.streak === 1 ? "" : "s"}</small></span> : null}
      <ArrowRight className="landing-more-arrow" size={18} />
    </button>
    <button type="button" className="landing-more-card is-compete" data-testid="card-compete" onClick={() => shell.openSection("compete")}>
      <span className="landing-more-icon" aria-hidden="true"><Users size={22} strokeWidth={1.6} /></span>
      <span className="landing-more-copy"><strong>Play friends live</strong><span>A real-time multiplayer race for up to 8, or a solo timed run for the leaderboards.</span></span>
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
