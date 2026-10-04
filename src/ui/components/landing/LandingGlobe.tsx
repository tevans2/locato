import { useEffect, useRef, useState } from "react";
import { ArrowRight, Mouse, RotateCcw } from "lucide-react";
import type { CountryIndex } from "../../../core/countries";
import { loadWorldCountryFeatures } from "../../../core/map";
import type { AtlasGlobe, AtlasHover } from "./renderAtlasGlobe";
import { getCountryOfTheDay, UTC_DAY_MS } from "./countryOfTheDay";

interface LandingGlobeProps {
  readonly countryIndex: CountryIndex;
  readonly onOpenCountry: (code: string) => void;
}

export function LandingGlobe({ countryIndex, onOpenCountry }: LandingGlobeProps) {
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<AtlasGlobe | null>(null);
  const [hover, setHover] = useState<AtlasHover | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [attempt, setAttempt] = useState(0);
  const [today, setToday] = useState(() => Date.now());
  const featured = getCountryOfTheDay(countryIndex, today);
  const featuredCode = featured?.code;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const now = Date.now();
      setToday(now);
      clearTimeout(timer);
      timer = setTimeout(refresh, UTC_DAY_MS - (now % UTC_DAY_MS) + 50);
    };
    refresh();
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let view: AtlasGlobe | null = null;
    setStatus("loading");
    setHover(null);
    Promise.all([loadWorldCountryFeatures(), import("./renderAtlasGlobe")]).then(([features, { createAtlasGlobe }]) => {
      if (cancelled || !host.current) return;
      view = createAtlasGlobe(host.current, features, { countryIndex, featuredCountryCode: featuredCode, onHover: setHover, onOpenCountry });
      globe.current = view;
      setStatus("ready");
    }).catch(() => {
      if (!cancelled) { host.current?.replaceChildren(); setStatus("unavailable"); }
    });
    return () => {
      cancelled = true;
      globe.current = null;
      view?.destroy();
    };
  }, [countryIndex, onOpenCountry, attempt, featuredCode]);

  const width = host.current?.clientWidth ?? 600;
  const height = host.current?.clientHeight ?? 540;
  const cardWidth = Math.min(208, width - 24);
  const left = hover ? Math.max(12, Math.min(width - cardWidth - 12, hover.x + 46)) : 0;
  const top = hover ? Math.max(12, Math.min(height - 98, hover.y - 18)) : 0;
  const showDaily = featured && (!hover?.visible || hover.country.code === featured.code);
  const dailyWidth = Math.min(288, width - 24);
  const dateLabel = new Date(today).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const countries = [...countryIndex.countries].sort((a, b) => a.name.localeCompare(b.name));

  return <div className="landing-atlas" data-testid="landing-atlas">
    <div className="landing-atlas-heading">
      <span>{featured ? "Country of the day" : "A world to explore"}</span>
      <div className="atlas-heading-actions">
        {featured ? <time dateTime={new Date(today).toISOString().slice(0, 10)} title="A new country every day at midnight UTC">{dateLabel}</time> : null}
        <button type="button" className="atlas-reset" aria-label="Reset globe view" title={featured ? `Return to ${featured.country.name}, today’s country` : "Reset globe view"} disabled={status !== "ready"} onClick={() => globe.current?.reset()}><RotateCcw size={18} strokeWidth={1.7} /></button>
      </div>
    </div>
    <div className="atlas-globe-stage" data-state={status}>
      <div className="atlas-ground-shadow" aria-hidden="true" />
      <div className="atlas-globe-host" ref={host} data-testid="atlas-globe-host" />
      {status !== "ready" ? <div className="atlas-globe-placeholder" aria-hidden="true"><img src="/assets/landing/atlas-globe.svg" alt="" /></div> : null}
      {showDaily ? <>
        {hover?.visible && status === "ready" ? <svg className="atlas-card-connector" aria-hidden="true"><path d={`M ${hover.x} ${hover.y} L ${width - dailyWidth - 12} ${height - 125}`} /></svg> : null}
        <article className="atlas-country-card atlas-daily-card" data-testid="atlas-daily-card" aria-labelledby="atlas-daily-country">
          <div className="atlas-daily-country">
            <img src={featured.country.flagSrc} alt={`${featured.country.name} flag`} width="36" height="24" />
            <div className="atlas-country-copy"><strong id="atlas-daily-country">{featured.country.name}</strong><span>{featured.country.continent} <span aria-hidden="true">·</span> {featured.country.capital}</span></div>
          </div>
          <p className="atlas-daily-fact">{featured.fact}</p>
          <div className="atlas-daily-footer">
            <button type="button" onClick={() => onOpenCountry(featured.code)} aria-label={`Explore ${featured.country.name}`}>Explore country <ArrowRight size={14} /></button>
            <a href={featured.source} target="_blank" rel="noopener noreferrer" aria-label={`Fact source: ${featured.sourceName} (opens in a new tab)`}>Source <ArrowRight size={11} /></a>
          </div>
        </article>
      </> : hover?.visible && status === "ready" ? <>
        <svg className="atlas-card-connector" aria-hidden="true"><path d={`M ${hover.x} ${hover.y} L ${left} ${top + 35}`} /></svg>
        <div className="atlas-country-card" style={{ left, top, width: cardWidth }} data-testid="atlas-country-card">
          <img src={hover.country.flagSrc} alt={`${hover.country.name} flag`} width="36" height="24" />
          <div className="atlas-country-copy"><strong>{hover.country.name}</strong><span>Capital · {hover.country.capital}</span><button type="button" onClick={() => onOpenCountry(hover.country.code)} aria-label={`Explore ${hover.country.name}`}>Explore <ArrowRight size={14} /></button></div>
        </div>
      </> : null}
    </div>
    <div className="atlas-interaction-hint" id="atlas-hint">
      {status === "loading" ? <span role="status">Loading the world…</span> : status === "unavailable" ? <><span>Explore a country below</span><button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry globe</button></> : <><Mouse size={23} strokeWidth={1.4} /><span><span className="atlas-drag-hint">Drag to rotate</span><span className="atlas-hover-hint">Hover to discover</span></span></>}
    </div>
    <div className={`atlas-keyboard-picker ${status === "unavailable" ? "is-visible" : ""}`}>
      <label htmlFor="atlas-country-picker">Explore a country</label>
      <select id="atlas-country-picker" aria-describedby="atlas-keyboard-help" value={hover?.country.code ?? ""} onChange={(event) => { if (status === "ready") globe.current?.selectCountry(event.target.value); else if (event.target.value) onOpenCountry(event.target.value); }}>
        <option value="">Choose a country</option>
        {countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
      </select>
      <span id="atlas-keyboard-help">Arrow keys rotate the globe. Choose a country here, then use its Explore button.</span>
    </div>
  </div>;
}
