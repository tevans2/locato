import { createRoot, type Root } from "react-dom/client";
import { useMemo, useState } from "react";
import { ArrowRight, ArrowUpRight, Flag } from "lucide-react";
import type { Screen } from "../../app/router";
import type { CountryIndex } from "../../core/countries";
import { territoryFlags } from "../../core/territoryFlags";
import { LandingAccount, LandingThemeSwitch } from "./LandingScreen";

export interface FlagsScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly accountControl: HTMLElement;
  readonly storage?: Storage;
  readonly onHome: () => void;
  readonly onPlay: () => void;
  readonly onDailyChallenge: () => void;
  readonly onMultiplayer: () => void;
}

type FlagCollection = "countries" | "territories";

export interface FlagReference {
  readonly name: string;
  readonly code: string;
  readonly flagSrc: string;
}

interface FlagGroup {
  readonly letter: string;
  readonly flags: readonly FlagReference[];
}

function flagInitial(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toLocaleUpperCase("en");
}

export function buildAlphabeticalFlagGroups(flags: readonly FlagReference[]): readonly FlagGroup[] {
  const sorted = [...flags].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const grouped = new Map<string, FlagReference[]>();

  for (const flag of sorted) {
    const letter = flagInitial(flag.name);
    const group = grouped.get(letter);
    if (group) group.push(flag);
    else grouped.set(letter, [flag]);
  }

  return [...grouped.entries()].map(([letter, groupedFlags]) => ({ letter, flags: groupedFlags }));
}

function FlagsHome(options: FlagsScreenOptions) {
  const [collection, setCollection] = useState<FlagCollection>("countries");
  const countryFlags = useMemo<readonly FlagReference[]>(
    () => options.countryIndex.countries.map(({ name, code, flagSrc }) => ({ name, code, flagSrc })),
    [options.countryIndex],
  );
  const activeFlags = collection === "countries" ? countryFlags : territoryFlags;
  const groups = useMemo(() => buildAlphabeticalFlagGroups(activeFlags), [activeFlags]);
  const isCountries = collection === "countries";

  const jumpToLetter = (letter: string) => {
    document.getElementById(`flags-${letter}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const chooseCollection = (nextCollection: FlagCollection) => {
    if (nextCollection === collection) return;
    setCollection(nextCollection);
    document.querySelector(".flags-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="landing-root flags-root">
      <nav className="landing-topbar" aria-label="Main navigation">
        <button type="button" onClick={options.onHome} className="brand-lockup compact brand-home-button" aria-label="Go to home page">
          <img src="/logo.svg" alt="" className="brand-logo" width="30" height="30" />
          <span className="brand-name">locato<span className="brand-period">.</span></span>
        </button>
        <div className="landing-nav-links">
          <button type="button" onClick={options.onHome}>Explore games</button>
          <span className="flags-nav-current" aria-current="page">Flags</span>
          <button type="button" onClick={options.onDailyChallenge}>Daily challenge</button>
          <button type="button" onClick={options.onMultiplayer}>With friends <ArrowUpRight size={13} /></button>
        </div>
        <div className="landing-topbar-actions">
          <LandingThemeSwitch storage={options.storage} />
          <LandingAccount control={options.accountControl} />
          <button type="button" className="lp-btn lp-btn-primary landing-nav-play" onClick={options.onPlay}>Play flags <ArrowUpRight size={15} /></button>
        </div>
      </nav>

      <div className="landing-scroll flags-scroll">
        <main className="flags-page">
          <header className="flags-hero">
            <div className="flags-hero-copy">
              <span className="flags-eyebrow"><Flag size={15} strokeWidth={1.7} /> World flag reference</span>
              <h1>Flags of the world.</h1>
              <p>
                {isCountries
                  ? "Browse every official country flag in Locato’s country set in one clear, alphabetical view."
                  : "Browse territory, dependency and special-area flags in the same clear, alphabetical format."}
              </p>
            </div>
            <div className="flags-count" aria-label={`${activeFlags.length} flags`}>
              <strong>{activeFlags.length}</strong>
              <span>{isCountries ? "country flags" : "territory flags"} · A–Z</span>
            </div>
          </header>

          <section className="flags-collection" aria-label="Flag collection">
            <div className="flags-collection-toggle" role="group" aria-label="Choose which flags to show">
              <button
                type="button"
                className={isCountries ? "is-active" : undefined}
                aria-pressed={isCountries}
                onClick={() => chooseCollection("countries")}
              >
                <span>Countries</span>
                <small>{countryFlags.length}</small>
              </button>
              <button
                type="button"
                className={!isCountries ? "is-active" : undefined}
                aria-pressed={!isCountries}
                onClick={() => chooseCollection("territories")}
              >
                <span>Territories &amp; dependencies</span>
                <small>{territoryFlags.length}</small>
              </button>
            </div>
            <p className="flags-collection-note">
              {isCountries
                ? "The country list stays exactly as it appears elsewhere in Locato."
                : "Includes ISO territory and special-area entries, with separately flagged Caribbean Netherlands and Saint Helena group territories shown individually."}
            </p>
          </section>

          <nav className="flags-letter-nav" aria-label={`Jump to ${isCountries ? "country" : "territory"} initial`}>
            {groups.map((group) => (
              <button
                key={group.letter}
                type="button"
                onClick={() => jumpToLetter(group.letter)}
                aria-label={`Jump to ${isCountries ? "countries" : "territories"} beginning with ${group.letter}`}
              >
                {group.letter}
              </button>
            ))}
          </nav>

          <div className="flags-directory">
            {groups.map((group) => (
              <section className="flags-group" id={`flags-${group.letter}`} key={group.letter} aria-labelledby={`flags-heading-${group.letter}`}>
                <header className="flags-group-head">
                  <h2 id={`flags-heading-${group.letter}`}>{group.letter}</h2>
                  <span>
                    {group.flags.length} {group.flags.length === 1
                      ? (isCountries ? "country" : "territory")
                      : (isCountries ? "countries" : "territories")}
                  </span>
                </header>
                <ul className="flags-grid">
                  {group.flags.map((flag) => (
                    <li className="flags-card" key={flag.code}>
                      <div className="flags-card-art">
                        <img src={`/${flag.flagSrc}`} alt={`${flag.name} flag`} loading="lazy" decoding="async" />
                      </div>
                      <div className="flags-card-name">
                        <span>{flag.name}</span>
                        {!isCountries && <small>{flag.code}</small>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <section className="flags-play-cta" aria-label="Practice world flags">
            <div>
              <span className="flags-eyebrow">Ready to practise?</span>
              <h2>Know the flags. Test the flags.</h2>
              <p>Choose countries, territories & dependencies, or combine both when you play.</p>
            </div>
            <button type="button" className="lp-btn lp-btn-primary" onClick={options.onPlay}>Play flags <ArrowRight size={17} /></button>
          </section>
        </main>

        <footer className="landing-footer flags-footer">
          <span className="brand-name">locato<span className="brand-period">.</span></span>
          <nav className="landing-footer-links" aria-label="More links">
            <button type="button" className="landing-text-link" onClick={options.onHome}>Games</button>
            <button type="button" className="landing-text-link" onClick={options.onDailyChallenge}>Daily challenge</button>
            <button type="button" className="landing-text-link" onClick={options.onMultiplayer}>Multiplayer</button>
            <button type="button" className="landing-text-link" onClick={() => document.querySelector(".flags-scroll")?.scrollTo({ top: 0, behavior: "smooth" })}>Back to top ↑</button>
          </nav>
        </footer>
      </div>
    </div>
  );
}

export function createFlagsScreen(options: FlagsScreenOptions): Screen {
  const element = document.createElement("section");
  element.className = "landing-screen-shell flags-screen-shell";
  const root: Root = createRoot(element);
  root.render(<FlagsHome {...options} />);
  return { element, destroy: () => root.unmount() };
}
