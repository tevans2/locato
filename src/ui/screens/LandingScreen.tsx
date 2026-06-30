import { createRoot, type Root } from "react-dom/client";
import { motion } from "framer-motion";
import { CalendarDays, Map, Target, Users, Zap, Compass, Flag, Crown, ArrowRight, Eye, Hash, LayoutGrid, MousePointer, Layers, Trophy, Radio, Globe, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isMapTapGameModeId, isPromptGameModeId, isStreetViewGameModeId, isWorldMapGameModeId, type GameModeId } from "../../core/gameModes";
import type { Screen } from "../../app/router";

export interface LandingScreenOptions {
  readonly onHome: () => void;
  readonly onPlay: () => void;
  readonly onDailyChallenge: () => void;
  readonly onGameMode: (mode: GameModeId) => void;
  readonly onLeaderboard: () => void;
  readonly onMultiplayer: () => void;
}

const GAME_CATEGORIES = [
  {
    category: "Prompt Games",
    color: "text-green-400",
    bg: "bg-green-400/10",
    border: "border-green-400/20",
    dot: "bg-green-400",
    modes: [
      { id: "flags", title: "Flags", icon: <Flag className="w-4 h-4" />, desc: "Name the country from its flag." },
      { id: "flag-colors", title: "Flag Colours", icon: <Layers className="w-4 h-4" />, desc: "Guess countries to reveal matching colours in the hidden target flag." },
      { id: "shapes", title: "Country Outlines", icon: <Target className="w-4 h-4" />, desc: "Name the country from its outline." },
      { id: "codes", title: "Country Codes", icon: <Hash className="w-4 h-4" />, desc: "Name the country from its ISO code." },
      { id: "capitals", title: "Capitals", icon: <Crown className="w-4 h-4" />, desc: "Name the country whose capital city is shown." },
      { id: "capital-recall", title: "Capital Recall", icon: <MapPin className="w-4 h-4" />, desc: "Name the capital city for the country shown." },
    ],
  },
  {
    category: "World Map Games",
    color: "text-lime-400",
    bg: "bg-lime-400/10",
    border: "border-lime-400/20",
    dot: "bg-lime-400",
    modes: [
      { id: "name-all", title: "Name All Countries", icon: <Globe className="w-4 h-4" />, desc: "Type as many country names as you can and reveal the whole world map." },
      { id: "click-country", title: "Click on the Country", icon: <MousePointer className="w-4 h-4" />, desc: "A random country name appears — click the matching country on the map." },
      { id: "spot-country", title: "Spot the Country", icon: <Eye className="w-4 h-4" />, desc: "A country flashes on the map — type its name before moving on." },
      { id: "puzzle", title: "Puzzle", icon: <LayoutGrid className="w-4 h-4" />, desc: "Choose a continent, place every country by hand, then check your accuracy." },
      { id: "map-tap", title: "MapTap", icon: <Map className="w-4 h-4" />, desc: "Rotate a satellite globe and click the named city, landmark, or point of interest." },
    ],
  },
  {
    category: "Street View Games",
    color: "text-green-300",
    bg: "bg-green-300/10",
    border: "border-green-300/20",
    dot: "bg-green-300",
    modes: [
      { id: "streetview-country", title: "Street View Country", icon: <Compass className="w-4 h-4" />, desc: "Guess the hidden country from up to 3 moveable Street View frames." },
    ],
  },
] satisfies ReadonlyArray<{
  readonly category: string;
  readonly color: string;
  readonly bg: string;
  readonly border: string;
  readonly dot: string;
  readonly modes: ReadonlyArray<{ readonly id: GameModeId; readonly title: string; readonly icon: React.ReactNode; readonly desc: string }>;
}>;

function routeMode(options: LandingScreenOptions, mode: GameModeId): void {
  if (isPromptGameModeId(mode) || isWorldMapGameModeId(mode) || isStreetViewGameModeId(mode) || isMapTapGameModeId(mode)) {
    options.onGameMode(mode);
  }
}

function LandingHome(options: LandingScreenOptions) {
  const totalModes = GAME_CATEGORIES.reduce((total, group) => total + group.modes.length, 0) + 1;

  return (
    <div className="landing-root h-screen flex flex-col bg-background text-foreground overflow-hidden dark">
      {/* Navbar */}
      <nav className="landing-topbar shrink-0 px-6 md:px-10 h-14 flex justify-between items-center border-b border-border/40 backdrop-blur-md bg-background/80">
        <button type="button" onClick={options.onHome} className="brand-lockup compact brand-home-button" aria-label="Go to home page">
          <img src="/logo.svg" alt="" className="brand-logo" />
          <span className="brand-name">locato</span>
        </button>
        <div className="hidden md:flex gap-1 items-center">
          <button type="button" onClick={() => document.querySelector(".landing-game-modes")?.scrollTo({ top: 0, behavior: "smooth" })} className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-primary transition-colors rounded-lg hover:bg-muted/30 border-0 min-h-0 bg-transparent">Modes</button>
          <button type="button" onClick={options.onPlay} className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-primary transition-colors rounded-lg hover:bg-muted/30 border-0 min-h-0 bg-transparent">About</button>
          <Button variant="outline" size="sm" data-testid="button-leaderboard" onClick={options.onLeaderboard} className="ml-2 gap-1.5 font-bold text-xs border-border/50 hover:border-primary/50 hover:text-primary h-8">
            <Trophy className="w-3.5 h-3.5" /> Leaderboard
          </Button>
          <Button variant="outline" size="sm" data-testid="button-multiplayer" onClick={options.onMultiplayer} className="gap-1.5 font-bold text-xs border-border/50 hover:border-secondary/50 hover:text-secondary h-8">
            <Radio className="w-3.5 h-3.5" /> Multiplayer
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" data-testid="button-daily-challenge" onClick={options.onDailyChallenge} className="gap-1.5 font-bold text-xs border-border/50 hover:border-primary/50 hover:text-primary h-8 px-3">
            <CalendarDays className="w-3.5 h-3.5" /> Daily
          </Button>
          <Button data-testid="button-play-now" size="sm" onClick={options.onPlay} className="font-bold rounded-full px-5 h-8 text-sm">
            Play Now
          </Button>
        </div>
      </nav>

      {/* Main content */}
      <div className="landing-main-layout flex-1 flex overflow-hidden">
        {/* Left panel — hero */}
        <div className="landing-hero-panel w-72 shrink-0 flex flex-col justify-center px-8 border-r border-border/30 bg-card/30 relative overflow-hidden">
          {/* Grid bg */}
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{ backgroundImage: "linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: "40px 40px" }}
          />

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="relative z-10 space-y-5"
          >
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-bold">
              <Compass className="w-3 h-3" />
              Geo Trivia Atlas
            </div>

            <p className="landing-hero-copy text-sm text-muted-foreground leading-relaxed">
              Test your map sense across flags, capitals, country outlines, Street View clues, and globe-tapping challenges.
            </p>

            <div className="landing-quiz-strip" aria-label="Locato quiz clues">
              <div>
                <Flag className="w-3.5 h-3.5" />
                <span>Flags</span>
              </div>
              <div>
                <Crown className="w-3.5 h-3.5" />
                <span>Capitals</span>
              </div>
              <div>
                <Map className="w-3.5 h-3.5" />
                <span>Maps</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button data-testid="button-start-exploring" onClick={options.onPlay} className="w-full rounded-full font-bold text-sm shadow-[0_0_20px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.5)] transition-shadow">
                Start Playing <ArrowRight className="ml-1.5 w-4 h-4" />
              </Button>
              <div className="landing-hero-actions grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" data-testid="button-hero-leaderboard" onClick={options.onLeaderboard} className="gap-1.5 font-bold text-xs border-border/50 hover:text-primary">
                  <Trophy className="w-3.5 h-3.5" /> Leaderboard
                </Button>
                <Button variant="outline" size="sm" data-testid="button-hero-multiplayer" onClick={options.onMultiplayer} className="gap-1.5 font-bold text-xs border-border/50 hover:text-secondary">
                  <Users className="w-3.5 h-3.5" /> Multiplayer
                </Button>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-primary" />
                <span>195-country atlas</span>
              </div>
              <div className="flex items-center gap-1">
                <Globe className="w-3 h-3 text-emerald-400" />
                <span>{totalModes} quiz modes</span>
              </div>
            </div>

            <div className="landing-daily-route">
              <CalendarDays className="w-4 h-4" />
              <span>Daily route: flags, MapTap, then Street View.</span>
            </div>
          </motion.div>
        </div>

        {/* Right panel — game modes */}
        <div className="landing-game-modes flex-1 overflow-y-auto p-6">
          <div className="h-full flex flex-col gap-5">
            {GAME_CATEGORIES.map((group, gi) => (
              <motion.div
                key={group.category}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: gi * 0.08 }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2 h-2 rounded-full ${group.dot}`} />
                  <span className={`text-xs font-bold tracking-widest uppercase ${group.color}`}>{group.category}</span>
                </div>

                <div className="landing-mode-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {group.modes.map((mode, mi) => (
                    <motion.button
                      key={mode.id}
                      type="button"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.25, delay: gi * 0.08 + mi * 0.04 }}
                      whileHover={{ y: -2, transition: { duration: 0.15 } }}
                      data-testid={`card-game-mode-${gi}-${mi}`}
                      onClick={() => routeMode(options, mode.id)}
                      className={`landing-mode-card group relative text-left p-4 rounded-xl bg-card border ${group.border} hover:bg-card/80 transition-all cursor-pointer overflow-hidden`}
                    >
                      <div className={`w-8 h-8 rounded-lg ${group.bg} ${group.color} flex items-center justify-center mb-3`}>
                        {mode.icon}
                      </div>
                      <div className="font-display text-sm font-bold mb-1 leading-tight">{mode.title}</div>
                      <div className="text-xs text-muted-foreground leading-relaxed">{mode.desc}</div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
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
