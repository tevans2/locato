import { createRoot, type Root } from "react-dom/client";
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
  Trophy,
  Users,
} from "lucide-react";
import { getLocalDailyDate } from "../../core/dailyChallenge";
import { readDailyResult } from "../../storage/dailySave";
import { readSoloSave } from "../../storage/localSave";
import { isMapTapGameModeId, isPromptGameModeId, isStreetViewGameModeId, isWorldMapGameModeId, type GameModeId } from "../../core/gameModes";
import type { Screen } from "../../app/router";

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
  readonly wide?: boolean;
}

// One entry per game family. Adding a mode is one line in `modes`; adding a
// family is one entry here plus a `data-hue` rule in landing.css.
interface LandingGroup {
  readonly id: string;
  readonly hue: "lime" | "earth" | "route";
  readonly name: string;
  readonly tagline: string;
  readonly modes: readonly LandingMode[];
}

const MODE_GROUPS: readonly LandingGroup[] = [
  {
    id: "clues",
    hue: "lime",
    name: "Guess the country",
    tagline: "One clue on screen — name the country it belongs to.",
    modes: [
      { id: "flags", title: "Flags", icon: Flag, desc: "Name the country from its flag.", badge: "Start here" },
      { id: "flag-colors", title: "Flag Colours", icon: Palette, desc: "Guess countries to uncover the hidden flag, colour by colour." },
      { id: "shapes", title: "Country Outlines", icon: Shapes, desc: "Name the country from its outline alone." },
      { id: "codes", title: "Country Codes", icon: Hash, desc: "Name the country hiding behind the ISO code." },
      { id: "capitals", title: "Capitals", icon: Crown, desc: "A capital city on screen — name its country." },
      { id: "capital-recall", title: "Capital Recall", icon: MapPin, desc: "A country on the map — name its capital." },
    ],
  },
  {
    id: "map",
    hue: "earth",
    name: "On the map",
    tagline: "Point, click and drag your way around the world.",
    modes: [
      { id: "name-all", title: "Name All Countries", icon: Globe, desc: "Type every country you know and light up the map." },
      { id: "click-country", title: "Click the Country", icon: MousePointerClick, desc: "Find the named country on the map — quickly." },
      { id: "spot-country", title: "Spot the Country", icon: Eye, desc: "One country lights up. Type what it was." },
      { id: "puzzle", title: "Puzzle", icon: Puzzle, desc: "Rebuild a continent, one country at a time." },
      { id: "map-tap", title: "MapTap", icon: Orbit, desc: "Spin the satellite globe and pin cities and landmarks." },
    ],
  },
  {
    id: "streetview",
    hue: "route",
    name: "Street View",
    tagline: "Dropped on a random street somewhere on earth.",
    modes: [
      {
        id: "streetview-country",
        title: "Street View Country",
        icon: Binoculars,
        desc: "Look around three street-level frames and work out which country you're standing in.",
        wide: true,
      },
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
  // Best-effort hint: check the signed-in scope first, then the guest scope.
  // App.startDailyChallenge remains the authority for what actually opens.
  const result = readDailyResult(storage, date, userId) ?? (userId ? readDailyResult(storage, date, null) : null);
  return { dateLabel, playedScore: result?.score ?? null };
}

function hasResumableSolo(storage?: Storage): boolean {
  if (!storage) return false;
  const save = readSoloSave(storage);
  if (!save) return false;
  // Older saves have no status; mirror hydrateGameState's inference from the current country.
  const status = save.status ?? (save.currentCountryCode === null ? "complete" : "playing");
  return status !== "complete";
}

function routeMode(options: LandingScreenOptions, mode: GameModeId): void {
  if (isPromptGameModeId(mode) || isWorldMapGameModeId(mode) || isStreetViewGameModeId(mode) || isMapTapGameModeId(mode)) {
    options.onGameMode(mode);
  }
}

const LANDING_STARS = Array.from({ length: 56 }, (_, index) => ({
  left: (index * 37 + (index % 7) * 11) % 100,
  top: (index * 61 + (index % 5) * 13) % 100,
  size: index % 13 === 0 ? 2.6 : index % 5 === 0 ? 1.7 : 1,
  opacity: 0.28 + (index % 6) * 0.1,
  delay: -(index % 9) * 0.47,
}));

function LandingSpaceBackdrop() {
  return (
    <div className="landing-space-backdrop" aria-hidden="true">
      <div className="landing-star-field">
        {LANDING_STARS.map((star, index) => (
          <span
            key={index}
            className={star.size > 2 ? "landing-star is-bright" : "landing-star"}
            style={{
              left: `${star.left}%`,
              top: `${star.top}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              opacity: star.opacity,
              animationDelay: `${star.delay}s`,
            }}
          />
        ))}
      </div>
      <span className="landing-space-nebula landing-space-nebula-one" />
      <span className="landing-space-nebula landing-space-nebula-two" />
      <svg className="landing-space-globe" viewBox="0 0 760 760">
        <defs>
          <radialGradient id="landing-planet-light" cx="31%" cy="24%" r="75%">
            <stop offset="0%" stopColor="#466a42" />
            <stop offset="38%" stopColor="#1d3c31" />
            <stop offset="76%" stopColor="#0a1c19" />
            <stop offset="100%" stopColor="#040a09" />
          </radialGradient>
          <linearGradient id="landing-atmosphere" x1="16%" y1="10%" x2="84%" y2="90%">
            <stop offset="0%" stopColor="#b8e36d" stopOpacity="0.7" />
            <stop offset="48%" stopColor="#68d9bd" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#68d9bd" stopOpacity="0" />
          </linearGradient>
          <clipPath id="landing-planet-clip">
            <circle cx="380" cy="380" r="246" />
          </clipPath>
        </defs>

        <ellipse className="landing-space-orbit" cx="380" cy="380" rx="348" ry="136" transform="rotate(-20 380 380)" />
        <ellipse className="landing-space-orbit is-secondary" cx="380" cy="380" rx="326" ry="116" transform="rotate(28 380 380)" />
        <circle className="landing-space-orbit-dot" cx="693" cy="225" r="5" />
        <circle className="landing-space-atmosphere" cx="380" cy="380" r="264" stroke="url(#landing-atmosphere)" />
        <circle className="landing-space-planet" cx="380" cy="380" r="246" fill="url(#landing-planet-light)" />

        <g clipPath="url(#landing-planet-clip)" transform="rotate(-9 380 380)">
          <path className="landing-space-land" d="M116 264c45-45 95-72 146-78l35 18 33-1 21 28-14 34-40 14-18 42-30 10-17 52-35 8-18-39-31-18-18-36-14-34z" />
          <path className="landing-space-land is-dim" d="M282 380l38 15 32 37-6 46 27 36-18 81-33 42-17-38 7-54-31-47-18-48z" />
          <path className="landing-space-land" d="M350 194l53-27 97 5 48 29 61 12 53 40-9 36-55 8-31 30-52-5-24 29-46-14-43 12-31-31 17-47-34-28z" />
          <path className="landing-space-land is-dim" d="M443 342l49-6 32 33 9 56-29 39-12 69-44 54-35-25 13-63-25-38 2-54z" />
          <path className="landing-space-land" d="M568 501l39-16 48 23 5 34-47 17-40-19z" />

          <g className="landing-space-grid">
            <ellipse cx="380" cy="380" rx="176" ry="246" />
            <ellipse cx="380" cy="380" rx="86" ry="246" />
            <ellipse cx="380" cy="380" rx="246" ry="176" />
            <ellipse cx="380" cy="380" rx="246" ry="86" />
            <line x1="134" y1="380" x2="626" y2="380" />
            <line x1="380" y1="134" x2="380" y2="626" />
          </g>
          <ellipse className="landing-space-terminator" cx="507" cy="380" rx="176" ry="246" />
        </g>
        <circle className="landing-space-rim" cx="380" cy="380" r="246" />
      </svg>
    </div>
  );
}

function LandingHome(options: LandingScreenOptions) {
  const totalModes = MODE_GROUPS.reduce((total, group) => total + group.modes.length, 0);
  const daily = readDailyStatus(options.storage, options.getAuthUser);
  const resumable = hasResumableSolo(options.storage);

  return (
    <div className="landing-root">
      <LandingSpaceBackdrop />
      <nav className="landing-topbar">
        <button type="button" onClick={options.onHome} className="brand-lockup compact brand-home-button" aria-label="Go to home page">
          <img src="/logo.svg" alt="" className="brand-logo" />
          <span className="brand-name">locato</span>
        </button>
        <div className="landing-topbar-actions">
          <button type="button" className="lp-btn" data-testid="button-daily-challenge" onClick={options.onDailyChallenge}>
            <span className="lp-wide-only">Daily Challenge</span>
            <span className="lp-narrow-only">Daily</span>
          </button>
          <button type="button" className="lp-btn lp-desktop-only" data-testid="button-leaderboard" onClick={options.onLeaderboard}>
            Leaderboards
          </button>
          <button type="button" className="lp-btn lp-desktop-only" data-testid="button-multiplayer" onClick={options.onMultiplayer}>
            Multiplayer
          </button>
          <button type="button" className="lp-btn lp-btn-primary" data-testid="button-play-now" onClick={options.onPlay}>
            Play now
          </button>
        </div>
      </nav>

      <div className="landing-main">
        <aside className="landing-hero">
          <motion.div
            className="landing-hero-inner"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <p className="landing-eyebrow">A geography arcade</p>
            <h1 className="landing-title">
              Know the <em>world</em> by heart.
            </h1>
            <p className="landing-sub">
              Quick games of flags, capitals, borders and mystery streets — played out on the real map of the world.
            </p>

            <div className="landing-hero-actions">
              <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" data-testid="button-start-exploring" onClick={options.onPlay}>
                {resumable ? "Continue playing" : "Start playing"} <ArrowRight size={16} />
              </button>

              <button type="button" className="landing-daily" data-testid="card-daily-challenge" onClick={options.onDailyChallenge}>
                <span className="landing-daily-head">
                  <CalendarDays size={15} />
                  <span>Today&apos;s Daily</span>
                  <span className="landing-daily-date">{daily.dateLabel}</span>
                </span>
                <span className="landing-daily-desc">Ten shared rounds, flags to Street View. Same for everyone, one run per day.</span>
                <span className="landing-daily-state" data-played={daily.playedScore !== null}>
                  {daily.playedScore !== null ? (
                    <>
                      <Check size={14} /> Played · {daily.playedScore}/100 — see your result
                    </>
                  ) : (
                    <>
                      Play today&apos;s route <ArrowRight size={14} />
                    </>
                  )}
                </span>
              </button>
            </div>

            <ul className="landing-facts">
              <li>{COUNTRY_COUNT} countries</li>
              <li>{totalModes} game modes</li>
              <li>Free — no account needed</li>
            </ul>
          </motion.div>
        </aside>

        <main className="landing-catalog">
          <div className="landing-catalog-inner">
            <p className="landing-catalog-label">Pick a game</p>
            {MODE_GROUPS.map((group, gi) => (
              <motion.section
                key={group.id}
                className="landing-group"
                data-hue={group.hue}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.08 + gi * 0.09 }}
              >
                <header className="landing-group-head">
                  <h2>{group.name}</h2>
                  <p>{group.tagline}</p>
                </header>
                <div className="landing-grid">
                  {group.modes.map((mode, mi) => {
                    const Icon = mode.icon;
                    return (
                      <motion.button
                        key={mode.id}
                        type="button"
                        className={mode.wide ? "landing-card wide" : "landing-card"}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.14 + gi * 0.09 + mi * 0.03 }}
                        whileHover={{ y: -2, transition: { duration: 0.15 } }}
                        data-testid={`card-game-mode-${mode.id}`}
                        onClick={() => routeMode(options, mode.id)}
                      >
                        <span className="landing-card-icon">
                          <Icon size={17} />
                        </span>
                        {mode.badge ? <span className="landing-card-badge">{mode.badge}</span> : null}
                        <span className="landing-card-body">
                          <span className="landing-card-title">{mode.title}</span>
                          <span className="landing-card-desc">{mode.desc}</span>
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.section>
            ))}

            <motion.section
              className="landing-together"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
            >
              <div className="landing-together-copy">
                <h2>Play it together</h2>
                <p>Host a room and race friends live in any mode, or chase the global leaderboards.</p>
              </div>
              <div className="landing-together-actions">
                <button type="button" className="lp-btn" data-testid="button-hero-multiplayer" onClick={options.onMultiplayer}>
                  <Users size={15} /> Host a room
                </button>
                <button type="button" className="lp-btn lp-btn-ghost" data-testid="button-hero-leaderboard" onClick={options.onLeaderboard}>
                  <Trophy size={15} /> Leaderboards
                </button>
              </div>
            </motion.section>
          </div>
        </main>
      </div>
    </div>
  );
}

export function createLandingScreen(options: LandingScreenOptions): Screen {
  const element = document.createElement("section");
  element.className = "landing-screen-shell";
  const root: Root = createRoot(element);
  root.render(<LandingHome {...options} />);

  return {
    element,
    destroy: () => root.unmount(),
  };
}
