import { createRoot, type Root } from "react-dom/client";
import { ArrowRight, ArrowUpRight, Flag } from "lucide-react";
import type { Screen } from "../../app/router";
import type { Country, CountryIndex } from "../../core/countries";
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

interface FlagGroup {
  readonly letter: string;
  readonly countries: readonly Country[];
}

export function buildAlphabeticalFlagGroups(countryIndex: CountryIndex): readonly FlagGroup[] {
  const countries = [...countryIndex.countries].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  const grouped = new Map<string, Country[]>();

  for (const country of countries) {
    const letter = country.name.charAt(0).toLocaleUpperCase("en");
    const group = grouped.get(letter);
    if (group) group.push(country);
    else grouped.set(letter, [country]);
  }

  return [...grouped.entries()].map(([letter, groupedCountries]) => ({ letter, countries: groupedCountries }));
}

function FlagsHome(options: FlagsScreenOptions) {
  const groups = buildAlphabeticalFlagGroups(options.countryIndex);
  const totalFlags = groups.reduce((total, group) => total + group.countries.length, 0);

  const jumpToLetter = (letter: string) => {
    document.getElementById(`flags-${letter}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
              <p>Browse every flag in Locato’s country set in one clear, alphabetical view.</p>
            </div>
            <div className="flags-count" aria-label={`${totalFlags} flags`}>
              <strong>{totalFlags}</strong>
              <span>flags · A–Z</span>
            </div>
          </header>

          <nav className="flags-letter-nav" aria-label="Jump to country initial">
            {groups.map((group) => (
              <button key={group.letter} type="button" onClick={() => jumpToLetter(group.letter)} aria-label={`Jump to countries beginning with ${group.letter}`}>
                {group.letter}
              </button>
            ))}
          </nav>

          <div className="flags-directory">
            {groups.map((group) => (
              <section className="flags-group" id={`flags-${group.letter}`} key={group.letter} aria-labelledby={`flags-heading-${group.letter}`}>
                <header className="flags-group-head">
                  <h2 id={`flags-heading-${group.letter}`}>{group.letter}</h2>
                  <span>{group.countries.length} {group.countries.length === 1 ? "country" : "countries"}</span>
                </header>
                <ul className="flags-grid">
                  {group.countries.map((country) => (
                    <li className="flags-card" key={country.code}>
                      <div className="flags-card-art">
                        <img src={`/${country.flagSrc}`} alt={`${country.name} flag`} loading="lazy" decoding="async" />
                      </div>
                      <div className="flags-card-name">{country.name}</div>
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
              <p>Jump straight into the flag guessing mode when you’re ready.</p>
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
