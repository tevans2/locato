import { createRoot, type Root } from "react-dom/client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Binoculars,
  CalendarDays,
  Check,
  Crown,
  Eye,
  Flag,
  Globe,
  Hash,
  MapPin,
  MousePointerClick,
  Orbit,
  Palette,
  Puzzle,
  Shapes,
  Split,
  Trophy,
  Users,
} from "lucide-react";
import { getLocalDailyDate } from "../../core/dailyChallenge";
import { readDailyResult } from "../../storage/dailySave";
import { readSoloSave } from "../../storage/localSave";
import { isMapTapGameModeId, isPromptGameModeId, isStreetViewGameModeId, isWorldMapGameModeId, isWorldSplitGameModeId, type GameModeId } from "../../core/gameModes";
import type { Screen } from "../../app/router";
import { LandingSatelliteGlobe } from "../components/LandingSatelliteGlobe";
import { currentTheme, LOCATO_THEME_EVENT, toggleTheme, type LocatoTheme } from "../theme";

export interface LandingScreenOptions {
  readonly onHome: () => void;
  readonly onPlay: () => void;
  readonly onDailyChallenge: () => void;
  readonly onGameMode: (mode: GameModeId) => void;
  readonly onLeaderboard: () => void;
  readonly onMultiplayer: () => void;
  readonly storage?: Storage;
  readonly getAuthUser?: () => { readonly id: string } | null;
}

type LucideIcon = typeof Flag;

interface LandingMode {
  readonly id: GameModeId;
  readonly title: string;
  readonly icon: LucideIcon;
  readonly desc: string;
  readonly badge?: string;
}

interface LandingGroup {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly modes: readonly LandingMode[];
}

const MODE_GROUPS: readonly LandingGroup[] = [
  {
    id: "clues",
    name: "Guess the country",
    tagline: "One clue on screen — name the country it belongs to.",
    modes: [
      { id: "flags", title: "Flags", icon: Flag, desc: "Name the country from its flag.", badge: "Start here" },
      { id: "flag-colors", title: "Flag Colours", icon: Palette, desc: "Reveal the hidden flag, colour by colour." },
      { id: "shapes", title: "Country Outlines", icon: Shapes, desc: "Name a country from its outline alone." },
      { id: "codes", title: "Country Codes", icon: Hash, desc: "Decode the country behind its ISO code." },
      { id: "capitals", title: "Capitals", icon: Crown, desc: "See a capital city and name its country." },
      { id: "capital-recall", title: "Capital Recall", icon: MapPin, desc: "See a country and name its capital." },
    ],
  },
  {
    id: "map",
    name: "On the map",
    tagline: "Point, click and drag your way around the world.",
    modes: [
      { id: "worldsplit", title: "Worldsplit", icon: Split, desc: "Draw one line to divide a population in half.", badge: "New" },
      { id: "name-all", title: "Name All Countries", icon: Globe, desc: "Type every country you know." },
      { id: "click-country", title: "Click the Country", icon: MousePointerClick, desc: "Find the named country quickly." },
      { id: "spot-country", title: "Spot the Country", icon: Eye, desc: "Name the country that lights up." },
      { id: "puzzle", title: "Puzzle", icon: Puzzle, desc: "Rebuild a continent by hand." },
      { id: "map-tap", title: "MapTap", icon: Orbit, desc: "Pin cities and landmarks on the globe." },
    ],
  },
  {
    id: "streetview",
    name: "Street View",
    tagline: "Dropped on a random street somewhere on earth.",
    modes: [
      { id: "streetview-country", title: "Street View Country", icon: Binoculars, desc: "Look around and work out where you are." },
    ],
  },
];

const COUNTRY_COUNT = 196;

interface DailyStatus {
  readonly dateLabel: string;
  readonly playedScore: number | null;
}

function readDailyStatus(storage?: Storage, getAuthUser?: LandingScreenOptions["getAuthUser"]): DailyStatus {
  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  if (!storage) return { dateLabel, playedScore: null };
  const date = getLocalDailyDate(now);
  const userId = getAuthUser?.()?.id ?? null;
  const result = readDailyResult(storage, date, userId) ?? (userId ? readDailyResult(storage, date, null) : null);
  return { dateLabel, playedScore: result?.score ?? null };
}

function hasResumableSolo(storage?: Storage): boolean {
  if (!storage) return false;
  const save = readSoloSave(storage);
  if (!save) return false;
  const status = save.status ?? (save.currentCountryCode === null ? "complete" : "playing");
  return status !== "complete";
}

function routeMode(options: LandingScreenOptions, mode: GameModeId): void {
  if (isPromptGameModeId(mode) || isWorldMapGameModeId(mode) || isStreetViewGameModeId(mode) || isMapTapGameModeId(mode) || isWorldSplitGameModeId(mode)) {
    options.onGameMode(mode);
  }
}

function LandingThemeSwitch({ storage }: { readonly storage: Storage | undefined }) {
  const [theme, setThemeState] = useState<LocatoTheme>(() => currentTheme());

  useEffect(() => {
    const sync = () => setThemeState(currentTheme());
    window.addEventListener(LOCATO_THEME_EVENT, sync);
    return () => window.removeEventListener(LOCATO_THEME_EVENT, sync);
  }, []);

  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="theme-switch landing-theme-switch"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Use light mode" : "Use dark mode"}
      onClick={() => setThemeState(toggleTheme(storage))}
    >
      <span className="theme-switch-label">{dark ? "Light" : "Dark"}</span>
      <span className="theme-switch-track"><span className="theme-switch-thumb" /></span>
    </button>
  );
}

function LandingHome(options: LandingScreenOptions) {
  const totalModes = MODE_GROUPS.reduce((total, group) => total + group.modes.length, 0);
  const daily = readDailyStatus(options.storage, options.getAuthUser);
  const resumable = hasResumableSolo(options.storage);

  return (
    <div className="landing-root">
      <nav className="landing-topbar">
        <button type="button" onClick={options.onHome} className="brand-lockup compact brand-home-button" aria-label="Go to home page">
          <img src="/logo.svg" alt="" className="brand-logo" />
          <span className="brand-name">locato</span>
        </button>
        <div className="landing-nav-links" aria-label="Landing page sections">
          <a href="#games">Games</a>
          <button type="button" onClick={options.onDailyChallenge}>Daily challenge</button>
          <button type="button" onClick={options.onMultiplayer}>Multiplayer</button>
        </div>
        <div className="landing-topbar-actions">
          <LandingThemeSwitch storage={options.storage} />
          <button type="button" className="lp-btn lp-desktop-only" data-testid="button-leaderboard" onClick={options.onLeaderboard}>Leaderboards</button>
          <button type="button" className="lp-btn lp-btn-primary" data-testid="button-play-now" onClick={options.onPlay}>Play now</button>
        </div>
      </nav>

      <div className="landing-scroll">
        <section className="landing-hero">
          <motion.div className="landing-hero-copy" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <p className="landing-eyebrow">The map is the game</p>
            <h1 className="landing-title">Play your way <span>around the world.</span></h1>
            <p className="landing-sub">Race flags, rebuild continents, hunt landmarks and draw the line in Worldsplit. Quick geography games built on real maps.</p>
            <div className="landing-hero-actions">
              <button type="button" className="lp-btn lp-btn-primary" data-testid="button-play-worldsplit" onClick={() => routeMode(options, "worldsplit")}>
                Play Worldsplit <ArrowRight size={16} />
              </button>
              <button type="button" className="lp-btn" data-testid="button-start-exploring" onClick={options.onPlay}>
                {resumable ? "Continue last game" : "Start with flags"}
              </button>
            </div>
            <a className="landing-browse-link" href="#games">Browse all {totalModes} games <ArrowRight size={14} /></a>
            <p className="landing-free">Free to play · No account needed</p>
          </motion.div>

          <motion.div className="landing-globe-stage" initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.55, delay: 0.08 }} aria-label="Slowly rotating globe previewing Worldsplit">
            <span className="landing-globe-orbit" aria-hidden="true" />
            <LandingSatelliteGlobe />
            <span className="landing-hero-split-line" aria-hidden="true" />
            <span className="landing-hero-split-score is-a" aria-hidden="true">49.8%</span>
            <span className="landing-hero-split-score is-b" aria-hidden="true">50.2%</span>
            <button type="button" className="landing-featured-game" onClick={() => routeMode(options, "worldsplit")}>
              <span className="landing-featured-kicker"><Split size={14} /> New game</span>
              <strong>Worldsplit</strong>
              <span>One line. Two sides. How evenly can you divide the population?</span>
              <span className="landing-featured-play">Play now <ArrowRight size={14} /></span>
            </button>
          </motion.div>
        </section>

        <section className="landing-facts" aria-label="Locato facts">
          <span><strong>{totalModes}</strong> different game modes</span>
          <span><strong>{COUNTRY_COUNT}</strong> countries to learn</span>
          <span><strong>1</strong> new daily challenge</span>
        </section>

        <section className="landing-catalog" id="games">
          <header className="landing-section-head"><h2>Pick a game and start exploring.</h2><p>Start simple, or turn up the difficulty when you are ready.</p></header>
          {MODE_GROUPS.map((group, groupIndex) => (
            <motion.section className="landing-group" key={group.id} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: 0.3, delay: groupIndex * 0.04 }}>
              <header className="landing-group-head"><h3>{group.name}</h3><p>{group.tagline}</p></header>
              <div className="landing-mode-list">
                {group.modes.map((mode, index) => {
                  const Icon = mode.icon;
                  return (
                    <button type="button" className="landing-mode" key={mode.id} data-testid={`card-game-mode-${mode.id}`} onClick={() => routeMode(options, mode.id)}>
                      <span className="landing-mode-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className="landing-mode-icon"><Icon size={18} /></span>
                      <span className="landing-mode-name">{mode.title}{mode.badge ? <small>{mode.badge}</small> : null}</span>
                      <span className="landing-mode-desc">{mode.desc}</span>
                      <span className="landing-mode-play">Play <ArrowRight size={14} /></span>
                    </button>
                  );
                })}
              </div>
            </motion.section>
          ))}
        </section>

        <section className="landing-feature-row">
          <button type="button" className="landing-daily" data-testid="card-daily-challenge" onClick={options.onDailyChallenge}>
            <span className="landing-daily-head"><CalendarDays size={16} /><strong>Today&apos;s daily challenge</strong><span>{daily.dateLabel}</span></span>
            <span className="landing-daily-title">Ten questions. One trip around the world.</span>
            <span className="landing-daily-desc">Everyone gets the same mix of maps, flags, capitals and Street View.</span>
            <span className="landing-daily-state" data-played={daily.playedScore !== null}>
              {daily.playedScore !== null ? <><Check size={14} /> Played · {daily.playedScore}/100</> : <>Play today&apos;s challenge <ArrowRight size={14} /></>}
            </span>
          </button>

          <section className="landing-together">
            <div><span className="landing-online">Play live</span><h2>Play against friends.</h2><p>Create a private room, answer the same questions and see who knows the world best.</p></div>
            <div className="landing-together-actions">
              <button type="button" className="lp-btn" data-testid="button-hero-multiplayer" onClick={options.onMultiplayer}><Users size={15} /> Create a room</button>
              <button type="button" className="lp-btn lp-btn-ghost" data-testid="button-hero-leaderboard" onClick={options.onLeaderboard}><Trophy size={15} /> Leaderboards</button>
            </div>
          </section>
        </section>

        <footer className="landing-footer"><span className="brand-name">locato</span><span>{COUNTRY_COUNT} countries · {totalModes} games · one world</span></footer>
      </div>
    </div>
  );
}

export function createLandingScreen(options: LandingScreenOptions): Screen {
  const element = document.createElement("section");
  element.className = "landing-screen-shell";
  const root: Root = createRoot(element);
  root.render(<LandingHome {...options} />);
  return { element, destroy: () => root.unmount() };
}
