import { useEffect, useRef, useState } from "react";
import { ArrowRight, Mouse, RotateCcw } from "lucide-react";
import type { CountryIndex } from "../../../core/countries";
import { loadWorldCountryFeatures } from "../../../core/map";
import type { AtlasGlobe, AtlasHover } from "./renderAtlasGlobe";

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

  useEffect(() => {
    let cancelled = false;
    let view: AtlasGlobe | null = null;
    setStatus("loading");
    setHover(null);
    Promise.all([loadWorldCountryFeatures(), import("./renderAtlasGlobe")]).then(([features, { createAtlasGlobe }]) => {
      if (cancelled || !host.current) return;
      view = createAtlasGlobe(host.current, features, { countryIndex, onHover: setHover, onOpenCountry });
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
  }, [countryIndex, onOpenCountry, attempt]);

  const width = host.current?.clientWidth ?? 600;
  const height = host.current?.clientHeight ?? 540;
  const cardWidth = Math.min(208, width - 24);
  const left = hover ? Math.max(12, Math.min(width - cardWidth - 12, hover.x + 46)) : 0;
  const top = hover ? Math.max(12, Math.min(height - 98, hover.y - 18)) : 0;
  const countries = [...countryIndex.countries].sort((a, b) => a.name.localeCompare(b.name));

  return <div className="landing-atlas" data-testid="landing-atlas">
    <div className="landing-atlas-heading">
      <span>A world to explore</span>
      <button type="button" className="atlas-reset" aria-label="Reset globe view" title="Reset globe view" disabled={status !== "ready"} onClick={() => globe.current?.reset()}><RotateCcw size={18} strokeWidth={1.7} /></button>
    </div>
    <div className="atlas-globe-stage" data-state={status}>
      <div className="atlas-ground-shadow" aria-hidden="true" />
      <div className="atlas-globe-host" ref={host} data-testid="atlas-globe-host" />
      {status !== "ready" ? <div className="atlas-globe-placeholder" aria-hidden="true"><img src="/assets/landing/atlas-globe.svg" alt="" /></div> : null}
      {hover?.visible && status === "ready" ? <>
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
