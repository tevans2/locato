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
  Puzzle,
  RotateCcw,
  Shapes,
  Split,
  Timer,
} from "lucide-react";
import type { ShellContext } from "../shell/types";
import { SiteHeaderMount } from "../shell/react";
import { isSoloSaveResumable, readLatestSoloSave, readSoloSave } from "../../storage/localSave";
import { readAcademyProgress } from "../../storage/academySave";
import { getAchievementState } from "../../storage/achievements";
import { dailyProgressKey } from "../../storage/dailySave";
import { academyLevel } from "../../core/academy/mastery";
import { DAILY_COUNTRY_COUNT, getLocalDailyDate } from "../../core/dailyChallenge";
import { GAME_MODE_GROUPS, gameModeCatalogueEntry, isPromptGameModeId, type GameModeCatalogueEntry, type GameModeGroup, type GameModeId } from "../../core/gameModes";
import type { Screen } from "../../app/router";

/*
 * Play → the landing page (docs/navigation.md). Every mode here starts a PRACTICE run: no clock,
 * nothing posted. Timed runs live in Compete; the daily in Daily. The shared SiteHeader carries
 * the navigation, so the page itself has no nav links of its own.
 */

export interface LandingScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell: ShellContext;
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
  geoguessr: MapPin,
  "streetview-country": Binoculars,
};

const MODE_BADGES: Partial<Record<GameModeId, string>> = { flags: "Start here", worldsplit: "New", geoguessr: "New" };

const COUNTRY_COUNT = 196;
const DAY_MS = 86_400_000;

const MODE_PREVIEW_PROMPTS: Record<GameModeId, string> = {
  flags: "Which country flies this flag?",
  "flag-colors": "Reveal a colour. Name the country.",
  shapes: "Recognise the outline?",
  codes: "Which country uses this code?",
  capitals: "Name the country, given its capital.",
  "capital-recall": "Name this country’s capital.",
  "name-all": "How many countries can you name?",
  "click-country": "Find the country on the map.",
  "spot-country": "Name the highlighted country.",
  puzzle: "Put the countries back in place.",
  "map-tap": "Find the landmark. Place your pin.",
  worldsplit: "Draw a line. Split the population 50/50.",
  geoguessr: "Explore a street. Pin your location.",
  "streetview-country": "Use the street clues to name the country.",
};

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

function ModePreviewArtwork({ mode }: { readonly mode: GameModeId }) {
  if (mode === "flags" || mode === "flag-colors") return <div className={`picker-flag ${mode === "flag-colors" ? "is-partial" : ""}`}><img src="/assets/flags/it.svg" alt="" width="300" height="200" /></div>;
  if (mode === "shapes" || mode === "puzzle" || mode === "spot-country") return <img className={`picker-outline is-${mode}`} src="/assets/country-shapes/it.svg" alt="" width="260" height="260" />;
  if (mode === "codes" || mode === "capitals" || mode === "capital-recall") return <span className={`picker-clue ${mode === "codes" ? "is-code" : ""}`}>{mode === "codes" ? "ITA" : mode === "capitals" ? "Rome" : "Italy"}</span>;
  return <div className={`picker-globe is-${mode}`}>
    <img src="/assets/landing/atlas-globe.svg" alt="" width="320" height="320" />
    {mode === "worldsplit" ? <span className="picker-split-line"><span>50</span><span>50</span></span> : null}
    {mode === "map-tap" || mode === "geoguessr" || mode === "streetview-country" ? <span className="picker-map-pin"><MapPin size={32} strokeWidth={1.5} /></span> : null}
  </div>;
}

function LandingGamePicker({ shell, storage }: LandingScreenOptions) {
  const [group, setGroup] = useState<GameModeGroup>(GAME_MODE_GROUPS[0]!);
  const [mode, setMode] = useState<GameModeCatalogueEntry>(GAME_MODE_GROUPS[0]!.modes[0]!);
  const allModes = GAME_MODE_GROUPS.flatMap((item) => item.modes);
  const modeNumber = String(allModes.findIndex((item) => item.id === mode.id) + 1).padStart(2, "0");
  const resume = modeResumeProgress(storage, mode.id);
  const latest = latestResume(storage);
  const play = (id: GameModeId) => shell.openGame(id, "practice");

  return <section className="landing-hero game-picker" id="games" aria-labelledby="landing-title">
    <div className="mode-picker-menu">
      <header className="mode-picker-heading">
        <div>
          <h1 id="landing-title">Choose a game.</h1>
          <p className="mode-picker-sub">Practice at your own pace: no clock, nothing posted.</p>
        </div>
        <span>{allModes.length} games</span>
      </header>
      <div className="mode-picker-tabs" role="group" aria-label="Game groups">
        {GAME_MODE_GROUPS.map((item) => <button type="button" key={item.id} aria-pressed={group.id === item.id} onClick={() => { setGroup(item); setMode(item.modes[0]!); }}>
          {item.label}<span>{item.modes.length}</span>
        </button>)}
      </div>
      <div className="mode-picker-options" role="group" aria-label={`${group.label} games`}>
        {group.modes.map((item) => { const Icon = MODE_ICONS[item.id]; const saved = modeResumeProgress(storage, item.id); return <button type="button" className="mode-picker-option" key={item.id} data-testid={`picker-mode-${item.id}`} aria-pressed={mode.id === item.id} aria-controls="mode-preview" onClick={() => setMode(item)}>
          <Icon size={19} strokeWidth={1.5} /><span className="mode-picker-option-label">{item.label}{saved ? <small className="mode-picker-saved" aria-label={`, saved run ${saved}`}>{saved}</small> : null}</span><span className="mode-picker-indicator" aria-hidden="true">{mode.id === item.id ? <Check size={12} /> : null}</span>
        </button>; })}
      </div>
      {latest ? <div className="mode-picker-shortcuts">
        <button type="button" data-testid="button-resume-latest" onClick={() => play(latest.mode)} aria-label={`Resume ${latest.label}`}><RotateCcw size={15} /> Resume {latest.label} <ArrowRight size={15} /></button>
      </div> : null}
    </div>
    <section className="mode-preview" id="mode-preview" aria-label="Selected game" aria-live="polite">
      <div className="mode-preview-head"><span>{group.label}{MODE_BADGES[mode.id] ? <small className="mode-preview-badge">{MODE_BADGES[mode.id]}</small> : null}</span><span>{modeNumber} / {allModes.length}</span></div>
      <div className={`mode-preview-art is-${mode.id}`} aria-hidden="true"><ModePreviewArtwork mode={mode.id} /><span className="mode-preview-caption">{isPromptGameModeId(mode.id) ? "Example clue" : "Game preview"}</span></div>
      <div className="mode-preview-info"><h2>{mode.label}</h2><p>{MODE_PREVIEW_PROMPTS[mode.id]}</p></div>
      <button type="button" className="mode-picker-play" data-testid="button-play-selected" onClick={() => play(mode.id)}>
        <span>{resume ? `Resume ${mode.label}` : `Play ${mode.label}`}{resume ? <small>{resume}</small> : null}</span><ArrowRight size={19} />
      </button>
    </section>
  </section>;
}

function LandingMoreWays({ shell, storage, now }: LandingScreenOptions) {
  const daily = readDailyStatus(storage, now?.() ?? new Date());
  const dailyLine = daily.done
    ? `Done for today${daily.streak > 1 ? ` · ${daily.streak}-day streak` : ""}. See your result.`
    : daily.roundsPlayed > 0
      ? `In progress · round ${daily.roundsPlayed + 1} of ${DAILY_COUNTRY_COUNT}. Pick up where you left off.`
      : `${DAILY_COUNTRY_COUNT} rounds, the same for everyone today.${daily.streak > 0 ? ` Keep your ${daily.streak}-day streak going.` : ""}`;
  return <section className="landing-more" aria-label="More ways to play">
    <button type="button" className="landing-more-card is-daily" data-testid="card-daily" data-state={daily.done ? "done" : daily.roundsPlayed > 0 ? "in-progress" : "new"} onClick={() => shell.openSection("daily")}>
      <span className="landing-more-icon" aria-hidden="true">{daily.done ? <Check size={22} strokeWidth={2} /> : <CalendarDays size={22} strokeWidth={1.6} />}</span>
      <span className="landing-more-copy"><strong>Today’s daily challenge</strong><span>{dailyLine}</span></span>
      {daily.streak > 0 ? <span className="landing-more-streak" aria-label={`${daily.streak}-day streak`}>{daily.streak}<small>day{daily.streak === 1 ? "" : "s"}</small></span> : null}
      <ArrowRight className="landing-more-arrow" size={18} />
    </button>
    <button type="button" className="landing-more-card is-compete" data-testid="card-compete" onClick={() => shell.openSection("compete")}>
      <span className="landing-more-icon" aria-hidden="true"><Timer size={22} strokeWidth={1.6} /></span>
      <span className="landing-more-copy"><strong>Race the clock</strong><span>Timed runs post to the leaderboards.</span></span>
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
