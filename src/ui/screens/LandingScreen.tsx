import { createRoot, type Root } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
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
  Users,
} from "lucide-react";
import { readSoloSave } from "../../storage/localSave";
import { isMapTapGameModeId, isPromptGameModeId, isStreetViewGameModeId, isWorldMapGameModeId, isWorldSplitGameModeId, type GameModeId } from "../../core/gameModes";
import type { Screen } from "../../app/router";
import { currentTheme, LOCATO_THEME_EVENT, toggleTheme, type LocatoTheme } from "../theme";

export interface LandingScreenOptions {
  readonly onHome: () => void;
  readonly accountControl: HTMLElement;
  readonly onPlay: () => void;
  readonly onDailyChallenge: () => void;
  readonly onGameMode: (mode: GameModeId) => void;
  readonly onLeaderboard: () => void;
  readonly onMultiplayer: () => void;
  readonly storage?: Storage;
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
      { id: "geoguessr", title: "GeoGuessr", icon: MapPin, desc: "Explore the street, then pin the exact spot.", badge: "New" },
      { id: "streetview-country", title: "Street View Country", icon: Binoculars, desc: "Look around and work out where you are." },
    ],
  },
];

const COUNTRY_COUNT = 196;

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

function LandingAccount({ control }: { readonly control: HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.append(control);
    return () => control.remove();
  }, [control]);
  return <div className="landing-account" ref={ref} />;
}

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

function LandingGamePicker(options: LandingScreenOptions) {
  const [group, setGroup] = useState(MODE_GROUPS[0]!);
  const [mode, setMode] = useState(group.modes[0]!);
  const resumable = hasResumableSolo(options.storage);
  const allModes = MODE_GROUPS.flatMap((item) => item.modes);
  const modeNumber = String(allModes.findIndex((item) => item.id === mode.id) + 1).padStart(2, "0");

  return <section className="landing-hero game-picker" aria-labelledby="landing-title">
    <div className="mode-picker-menu">
      <header className="mode-picker-heading"><h1 id="landing-title">Choose a game.</h1><span>{allModes.length} modes</span></header>
      <div className="mode-picker-tabs" role="group" aria-label="Game categories">
        {MODE_GROUPS.map((item, index) => <button type="button" key={item.id} aria-pressed={group.id === item.id} onClick={() => { setGroup(item); setMode(item.modes[0]!); }}>
          {["Clues", "Map", "Street View"][index]}<span>{item.modes.length}</span>
        </button>)}
      </div>
      <div className="mode-picker-options" role="group" aria-label={`${group.name} modes`}>
        {group.modes.map((item) => { const Icon = item.icon; return <button type="button" className="mode-picker-option" key={item.id} data-testid={`picker-mode-${item.id}`} aria-pressed={mode.id === item.id} aria-controls="mode-preview" onClick={() => setMode(item)}>
          <Icon size={19} strokeWidth={1.5} /><span>{item.title}</span><span className="mode-picker-indicator" aria-hidden="true">{mode.id === item.id ? <Check size={12} /> : null}</span>
        </button>; })}
      </div>
      <div className="mode-picker-shortcuts">
        <button type="button" onClick={options.onDailyChallenge}><CalendarDays size={16} /> Daily challenge <ArrowUpRight size={14} /></button>
        {resumable ? <button type="button" onClick={options.onPlay}>Resume game <ArrowRight size={15} /></button> : <button type="button" onClick={options.onMultiplayer}><Users size={16} /> Multiplayer <ArrowUpRight size={14} /></button>}
      </div>
    </div>
    <section className="mode-preview" id="mode-preview" aria-label="Selected game" aria-live="polite">
      <div className="mode-preview-head"><span>{group.name}</span><span>{modeNumber} / {allModes.length}</span></div>
      <div className={`mode-preview-art is-${mode.id}`} aria-hidden="true"><ModePreviewArtwork mode={mode.id} /><span className="mode-preview-caption">{isPromptGameModeId(mode.id) ? "Example clue" : "Mode preview"}</span></div>
      <div className="mode-preview-info"><h2>{mode.title}</h2><p>{MODE_PREVIEW_PROMPTS[mode.id]}</p></div>
      <button type="button" className="mode-picker-play" data-testid="button-play-selected" onClick={() => routeMode(options, mode.id)}>Play {mode.title}<ArrowRight size={19} /></button>
    </section>
  </section>;
}

function LandingHome(options: LandingScreenOptions) {
  const totalModes = MODE_GROUPS.reduce((total, group) => total + group.modes.length, 0);
  const [filter, setFilter] = useState("all");
  const groups = MODE_GROUPS.filter((group) => filter === "all" || group.id === filter);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id === "games" || id === "landing-title") document.getElementById(id)?.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);

  return (
    <div className="landing-root">
      <a className="landing-skip-link" href="#games">Skip to games</a>
      <nav className="landing-topbar" aria-label="Main navigation">
        <button type="button" onClick={options.onHome} className="brand-lockup compact brand-home-button" aria-label="Go to home page">
          <img src="/logo.svg" alt="" className="brand-logo" width="30" height="30" />
          <span className="brand-name">locato<span className="brand-period">.</span></span>
        </button>
        <div className="landing-nav-links">
          <a href="#games">Explore games</a>
          <button type="button" onClick={options.onDailyChallenge}>Daily challenge</button>
          <button type="button" onClick={options.onMultiplayer}>With friends <ArrowUpRight size={13} /></button>
        </div>
        <div className="landing-topbar-actions">
          <LandingThemeSwitch storage={options.storage} />
          <LandingAccount control={options.accountControl} />
          <button type="button" className="lp-btn lp-btn-primary landing-nav-play" data-testid="button-play-now" onClick={options.onPlay}>Let’s play <ArrowUpRight size={15} /></button>
        </div>
      </nav>

      <div className="landing-scroll">
        <LandingGamePicker {...options} />

        <section className="landing-facts" aria-label="Locato at a glance">
          <span><Globe size={19} strokeWidth={1.4} /><strong>{COUNTRY_COUNT}</strong> countries</span>
          <span><Shapes size={19} strokeWidth={1.4} /><strong>{totalModes}</strong> game modes</span>
          <span><CalendarDays size={19} strokeWidth={1.4} />Daily challenge</span>
        </section>

        <section className="landing-catalog" id="games" aria-labelledby="catalog-title" tabIndex={-1}>
          <header className="landing-section-head"><h2 id="catalog-title">All games</h2></header>
          <div className="landing-filters" role="group" aria-label="Filter games">
            {[{ id: "all", name: "All games", count: totalModes }, ...MODE_GROUPS.map((group) => ({ id: group.id, name: group.name, count: group.modes.length }))].map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.name}<span>{item.count}</span></button>)}
          </div>
          <div className="landing-library" aria-live="polite">
            {groups.map((group) => <section className="landing-group" key={group.id} aria-labelledby={`group-${group.id}`}>
              <h3 className="landing-group-title" id={`group-${group.id}`}>{group.name}</h3>
              <div className="landing-mode-list">{group.modes.map((mode) => { const Icon = mode.icon; return <button type="button" className="landing-mode" key={mode.id} data-testid={`card-game-mode-${mode.id}`} onClick={() => routeMode(options, mode.id)}>
                <span className={`landing-mode-icon is-${group.id}`}><Icon size={21} strokeWidth={1.5} /></span>
                <span className="landing-mode-copy"><span className="landing-mode-name">{mode.title}{mode.badge ? <small>{mode.badge}</small> : null}</span><span className="landing-mode-desc">{mode.desc}</span></span>
                <ArrowUpRight className="landing-mode-arrow" size={17} />
              </button>; })}</div>
            </section>)}
          </div>
        </section>

        <footer className="landing-footer">
          <span className="brand-name">locato<span className="brand-period">.</span></span>
          <nav className="landing-footer-links" aria-label="More links">
            <button type="button" className="landing-text-link" onClick={options.onDailyChallenge}>Daily challenge</button>
            <button type="button" className="landing-text-link" onClick={options.onMultiplayer}>Multiplayer</button>
            <button type="button" className="landing-text-link" onClick={options.onLeaderboard}>Leaderboards</button>
            <a href="#landing-title" className="landing-text-link">Back to top ↑</a>
          </nav>
        </footer>
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
