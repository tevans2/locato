import { loadGeoCatalogueLocations } from "../components/GeoLocationCatalogue";
import { createGeoMapPicker } from "../components/GeoMapPicker";
import { GEO_GAME_MAPS, geoGameMap, locationInGeoMap } from "../../core/geoguessr/maps";
import { GEO_WORLD_LOCATIONS } from "../../core/geoguessr/locations";
import { sampleGeoLocations, hasGeoCoordinates } from "../../core/geoguessr";
import { runGeoCountdown } from "../components/GeoCountdown";
import { createGeoRoundJourney } from "../components/GeoRoundJourney";
import { createGeoGuessrFeedback } from "../components/GeoGuessrFeedback";
import { isSoundEnabled, setSoundEnabled, SOUND_CHANGE_EVENT } from "../dom/sfx";
import type { Screen } from "../../app/router";
import type { ShellContext } from "../shell/types";
import type { CountryIndex } from "../../core/countries";
import { GEOGUESSR_MAX_GAME_SCORE, GEOGUESSR_MAX_ROUND_SCORE, GEOGUESSR_ROUND_LIMIT, scoreGeoGuessrGuess, type GeoGuessrGuessResult, type GeoGuessrLocation, type GeoGuessrCandidate } from "../../core/geoguessr";
import type { GameModeId } from "../../core/gameModes";
import type { LngLatPoint } from "../../core/maptap/distance";
import { createGeoGuessMap, googleMapsJavaScriptApiKey, type GeoMapStyle } from "../components/GeoGuessMap";
import { createGeoStreetView } from "../components/GeoStreetView";
import { createPrivateStreetView } from "../components/PrivateStreetView";
import type { RankedSession } from "./RankedSession";
import { el } from "../dom/createElement";
import { createRunList, formatKm, formatNumber, insertIntoResults, shareSquare, shellOrFallback } from "./practiceRun";
import { createBestBar, createRankedResults, readSingleBest, submitRankedAttempt, type PostRankedAttempt } from "./rankedAttempt";


export interface GeoGuessrScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly countryIndex: CountryIndex;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onHome: () => void;
  readonly onDailyChallenge: () => void;
  /** Keeps the local best for a five-round total. */
  readonly storage?: Storage;
  readonly ranked?: RankedSession;
  readonly initialMap?: string;
}

/** Injectable surfaces keep the full game flow testable without Google credentials. */
export interface GeoGuessrScreenServices {
  readonly createMap: typeof createGeoGuessMap;
  readonly createPanorama: typeof createGeoStreetView;
  readonly countdown: typeof runGeoCountdown;
  readonly loadLocations: (signal: AbortSignal, mapId: string) => Promise<GeoGuessrCandidate[]>;
  /** False when no Google Maps key is configured: the screen shows a friendly "not set up" state. */
  readonly isConfigured: () => boolean;
  /** Posts a ranked attempt's total (defaults to the leaderboard API). */
  readonly postAttempt?: PostRankedAttempt;
}

type GameStatus = "selecting" | "loading" | "playing" | "result" | "complete" | "error" | "unconfigured";
type MapSize = "collapsed" | "compact" | "expanded";

function icon(name: "back" | "pin" | "expand" | "collapse" | "reset" | "settings" | "arrow" | "map" | "close" | "plus" | "minus" | "globe" | "help" | "check" | "sound" | "mute"): SVGSVGElement {
  const paths = {
    sound: "M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
    mute: "M11 4 6 8H3v8h3l5 4Zm5 5 6 6m0-6-6 6",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z",
    help: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2M12 16h.01",
    check: "m5 12 4 4L19 6",
    back: "m14 6-6 6 6 6M8 12h12",
    pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
    collapse: "M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5",
    reset: "M3 10a9 9 0 1 1 2 8M3 4v6h6",
    settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    map: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16m6-14v16",
    close: "m6 6 12 12M6 18 18 6",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}

function action(label: string, symbol: Parameters<typeof icon>[0], className = ""): HTMLButtonElement {
  return el("button", { className: `geo-button ${className}`, attrs: { type: "button", "aria-label": label, title: label }, children: [icon(symbol)] });
}

function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isGeoLocation(value: unknown): value is GeoGuessrCandidate {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<GeoGuessrCandidate>;
  return typeof location.countryCode === "string" && isFiniteNumber(location.heading) && typeof location.label === "string" &&
    ((isFiniteNumber(location.lat) && Math.abs(location.lat) <= 90 && isFiniteNumber(location.lng) && Math.abs(location.lng) <= 180) ||
      (location.lat === undefined && location.lng === undefined && typeof location.panoId === "string" && /^[A-Za-z0-9_-]{22}$/.test(location.panoId)));
}
async function fetchLocations(signal: AbortSignal, mapId: string): Promise<GeoGuessrCandidate[]> {
  try {
    const response = await fetch(`/api/geoguessr/locations?map=${encodeURIComponent(mapId)}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
    if (!response.ok) return loadGeoCatalogueLocations(signal, mapId);
    const value: unknown = await response.json();
    return Array.isArray(value) && value.every(isGeoLocation) && value.length >= 5 ? value : loadGeoCatalogueLocations(signal, mapId);
  } catch { return loadGeoCatalogueLocations(signal, mapId); }
}
function fallbackLocations(mapId: string): GeoGuessrLocation[] {
  const map = geoGameMap(mapId)!;
  return sampleGeoLocations(`solo:${Date.now()}:${Math.random()}`, GEO_WORLD_LOCATIONS.filter(location => locationInGeoMap(location, map)), 20);
}
const formatDistance = formatKm;

export function createGeoGuessrScreen(options: GeoGuessrScreenOptions, overrides: Partial<GeoGuessrScreenServices> = {}): Screen {
  const services: GeoGuessrScreenServices = {
    createMap: createGeoGuessMap,
    createPanorama: createGeoStreetView,
    countdown: runGeoCountdown,
    loadLocations: fetchLocations,
    // An injected panorama (tests, previews) brings its own imagery.
    isConfigured: () => overrides.createPanorama !== undefined || Boolean(googleMapsJavaScriptApiKey()),
    ...overrides,
  };
  const controller = new AbortController();
  const shell = shellOrFallback(options.shell, options.onHome);
  const bestStorage = options.storage ?? shell.storage ?? null;
  const signal = controller.signal;
  const narrow = window.matchMedia("(max-width: 760px)");
  let locations: GeoGuessrCandidate[] = [];
  let roundIndex = 0;
  let status: GameStatus = "selecting";
  let selectedMap = GEO_GAME_MAPS[0]!;
  let pickerShown = true;
  let reserveLocations: GeoGuessrCandidate[] = [];
  let guess: LngLatPoint | null = null;
  let mapSize: MapSize = narrow.matches ? "collapsed" : "compact";
  let mapPinned = false;
  const hoverPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  let requestId = 0;
  let countdownController: AbortController | null = null;
  signal.addEventListener("abort", () => countdownController?.abort(), { once: true });
  let results: GeoGuessrGuessResult[] = [];
  let retry: () => void;
  let reviewIndex = 0;
  let preferenceStorage: Storage | null = bestStorage;
  try { preferenceStorage ??= window.localStorage; } catch { /* Storage is optional. */ }
  try { selectedMap = geoGameMap(options.initialMap ?? preferenceStorage?.getItem("locato:geoguessr:selected-map") ?? "") ?? selectedMap; } catch { /* Storage is optional. */ }
  const feedback = createGeoGuessrFeedback(signal, preferenceStorage);
  let mapStyle: GeoMapStyle = "roadmap";
  try {
    const saved = preferenceStorage?.getItem("locato:geoguessr:map-style");
    if (saved === "terrain" || saved === "hybrid") mapStyle = saved;
  } catch { /* Storage is optional. */ }

  const panorama = options.ranked ? createPrivateStreetView(options.ranked, signal) : services.createPanorama(signal);
  const roundLabel = el("strong", { text: "01", className: "geo-round-number" });
  const scoreLabel = el("strong", { text: "0", className: "geo-total-score" });
  const steps = el("ol", { className: "geo-round-steps", attrs: { "aria-label": "Round progress" }, children: Array.from({ length: GEOGUESSR_ROUND_LIMIT }, (_, i) => el("li", { attrs: { "aria-label": `Round ${i + 1}` }, children: [el("span", { className: "geo-step-pin", text: String(i + 1) }), el("span", { className: "geo-step-score" })] })) });
  const session = el("div", { className: "geo-session", children: [el("div", { className: "geo-round", children: [el("span", { className: "geo-label", text: "Round" }), roundLabel, el("span", { className: "geo-round-limit", text: "/ 05" })] }), steps, el("div", { className: "geo-score", children: [scoreLabel, el("span", { text: "Total", className: "geo-label" })] })] });
  const fullscreenEnabled = typeof document !== "undefined" && document.fullscreenEnabled === true;
  const topbar = el("div", { className: "geo-topbar" });

  const pinStatus = el("span", { className: "geo-pin-status", text: "Click anywhere on the map" });
  const mapTitle = el("strong", { text: "Your guess" });
  const submitButton = el("button", { className: "geo-button geo-lock", attrs: { type: "button", disabled: "true" }, children: [el("span", { text: "Place your pin" })] });
  const mapExpand = action("Expand guess map", "expand");
  const mapCollapse = action("Hide guess map", "close");
  const mapPin = action("Keep map expanded", "pin", "geo-pin-map");
  mapPin.setAttribute("aria-pressed", "false");
  const map = services.createMap({ signal, nativeControls: false,
    revealPadding: () => {
      const mobile = narrow.matches;
      const height = element.clientHeight || window.innerHeight;
      const padding = status === "complete" ? (mobile
        ? { top: 90, right: 90, bottom: Math.round(height * 0.56) + 55, left: 90 }
        : { top: 90, right: 100, bottom: 80, left: (resultPanel.clientWidth || 360) + 70 })
        : { top: mobile ? 170 : 120, right: mobile ? 130 : 180, bottom: (resultPanel.offsetHeight || (mobile ? 220 : 170)) + 76, left: mobile ? 100 : 180 };
      // Leave drawable space even on short landscape screens.
      const scale = Math.min(1, Math.max(0, height - 100) / (padding.top + padding.bottom));
      return { ...padding, top: Math.round(padding.top * scale), bottom: Math.round(padding.bottom * scale) };
    }, onGuessChange(point) {
    if (pickerShown || status !== "playing") return;
    guess = point;
    feedback.play("pin");
    pinStatus.textContent = "Pin placed. Looking good?";
    mapDock.dataset.hasPin = "true";
    returnPin.disabled = false;
    submitButton.disabled = false;
    submitButton.querySelector("span")!.textContent = "Guess";
  } });
  map.element.id = "geo-guess-map";
  map.setStyle?.(mapStyle);
  const styleButtons = ([['roadmap', 'Standard'], ['terrain', 'Terrain'], ['hybrid', 'Satellite']] as const).map(([value, label]) => el("button", {
    className: "geo-button geo-map-style", text: label,
    attrs: { type: "button", "aria-pressed": String(mapStyle === value), "data-style": value },
    on: { click: () => {
      mapStyle = value;
      map.setStyle?.(value);
      styleButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.style === value)));
      try { preferenceStorage?.setItem("locato:geoguessr:map-style", value); } catch { /* Keep playing. */ }
    } },
  }));
  const stylePicker = el("div", { className: "geo-map-styles", attrs: { role: "group", "aria-label": "Map style" }, children: styleButtons });
  const worldButton = action("Show world map", "globe", "geo-world");
  worldButton.addEventListener("click", () => map.showWorld?.(), { signal });
  const returnPin = action("Return to your pin", "pin", "geo-return-pin");
  returnPin.disabled = true;
  returnPin.addEventListener("click", () => map.showGuess?.(), { signal });
  const zoomIn = action("Zoom in", "plus", "geo-zoom-in");
  const zoomOut = action("Zoom out", "minus", "geo-zoom-out");
  zoomIn.addEventListener("click", () => map.zoomBy?.(1), { signal });
  zoomOut.addEventListener("click", () => map.zoomBy?.(-1), { signal });
  const mapTools = el("div", { className: "geo-map-tools", attrs: { role: "group", "aria-label": "Map controls" }, children: [worldButton, returnPin, zoomIn, zoomOut] });
  const mapToolbar = el("div", { className: "geo-map-toolbar", children: [stylePicker] });
  const mapHeader = el("div", { className: "geo-map-header", children: [icon("map"), el("div", { className: "geo-map-heading", children: [mapTitle, pinStatus] }), mapExpand, mapPin, mapCollapse] });
  const mapDock = el("aside", { className: "geo-map-panel", attrs: { "aria-label": "Guess map" }, children: [mapHeader, mapToolbar, el("div", { className: "geo-map-viewport", children: [map.element, mapTools] }), submitButton] });
  const mapReveal = action("Open guess map", "map", "geo-open-map");
  mapReveal.append(el("span", { text: "Place your guess" }), el("kbd", { text: "M" }));
  mapReveal.setAttribute("aria-controls", "geo-guess-map");
  const resetButton = action("Return to starting point", "reset", "geo-reset");
  resetButton.append(el("span", { text: "Return to start" }));
  const help = el("span", { className: "geo-explore-hint", text: "Look around. Follow the clues. Trust your instinct." });
  const guide = el("details", { className: "geo-guide", children: [
    el("summary", { attrs: { "aria-label": "How to play" }, children: [icon("help"), el("span", { text: "How to play" })] }),
    el("div", { className: "geo-guide-card", children: [
      el("strong", { text: "Somewhere in the world…" }),
      el("p", { text: "Look for clues in the streets, signs and landscape. Click the map to place your pin, then make your guess." }),
      el("p", { text: "The closer you land, the more you score. Earn up to 5,000 points each round, or 25,000 for a perfect trip." }),
      el("span", { text: "M  Map  ·  Enter  Guess  ·  R  Return to start", className: "geo-shortcuts" }),
      el("a", { text: "Location credits", attrs: { href: "/assets/geoguessr/locations/CREDITS.html", target: "_blank", rel: "noopener" } }),
    ] }),
  ] });
  const streetZoomIn = action("Zoom in Street View", "plus", "geo-street-zoom");
  const streetZoomOut = action("Zoom out Street View", "minus", "geo-street-zoom");
  streetZoomIn.hidden = streetZoomOut.hidden = !panorama.zoomBy;
  streetZoomIn.addEventListener("click", () => panorama.zoomBy?.(1), { signal });
  streetZoomOut.addEventListener("click", () => panorama.zoomBy?.(-1), { signal });
  const soundButton = action("Sound effects", "sound", "geo-sound");
  const updateSoundButton = () => {
    const enabled = isSoundEnabled();
    soundButton.setAttribute("aria-pressed", String(enabled));
    soundButton.title = enabled ? "Mute sound effects" : "Enable sound effects";
    soundButton.replaceChildren(icon(enabled ? "sound" : "mute"));
  };
  updateSoundButton();
  soundButton.addEventListener("click", () => {
    setSoundEnabled(!isSoundEnabled());
  }, { signal });
  window.addEventListener(SOUND_CHANGE_EVENT, updateSoundButton, { signal });
  const roundIntro = el("div", { className: "geo-round-intro", attrs: { "aria-hidden": "true" } });
  const celebration = el("div", { className: "geo-celebration", attrs: { "aria-hidden": "true" } });
  function celebrate(): void {
    if (feedback.reducedMotion()) return;
    celebration.replaceChildren(...Array.from({ length: 22 }, (_, i) => el("span", { attrs: {
      style: `--x:${(i % 11 - 5) * 46}px;--drift:${(i % 7 - 3) * 30}px;--spin:${(i % 2 ? 1 : -1) * (180 + i * 21)}deg;--delay:${i % 5 * 35}ms;--color:${["var(--earth)", "var(--accent)", "#d6a047", "var(--surface)"][i % 4]}`,
    } })));
  }
  const bottomTools = el("div", { className: "geo-bottom-tools", children: [el("div", { className: "geo-explore-actions", children: [streetZoomIn, streetZoomOut, resetButton, soundButton, guide] }), help] });
  const compassTrack = el("div", { className: "geo-compass-track", attrs: { "aria-hidden": "true" }, children: Array.from({ length: 25 }, (_, i) => el("span", { text: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][i % 8]! })) });
  const compass = el("div", { className: "geo-compass", attrs: { role: "img", "aria-label": "Compass" }, children: [compassTrack] });
  compass.hidden = !panorama.onHeadingChange;
  panorama.onHeadingChange?.(heading => {
    const normalized = ((heading % 360) + 360) % 360;
    compassTrack.style.transform = `translateX(${-(normalized / 45 + 8) * 56}px)`;
    compass.setAttribute("aria-label", `Facing ${Math.round(normalized)} degrees`);
  });
  const loadingText = el("p", { text: "Loading Street View…" });
  const errorTitle = el("h1", { text: "Loading your location", attrs: { tabindex: "-1" } });
  const retryButton = el("button", { className: "geo-button geo-primary", text: "Try again", attrs: { type: "button", hidden: "true" } });
  const exitButton = el("button", { className: "geo-button geo-secondary", text: "Try another game", attrs: { type: "button", hidden: "true" }, on: { click: () => shell.openGamePicker({ current: "geoguessr" }) } });
  const alternativeGames = el("div", {
    className: "geo-alt-games",
    attrs: { hidden: "true" },
    children: [
      el("button", { className: "geo-button geo-primary", text: "Play MapTap", attrs: { type: "button" }, on: { click: () => shell.openGame("map-tap") } }),
      el("button", { className: "geo-button geo-secondary", text: "Play Worldsplit", attrs: { type: "button" }, on: { click: () => shell.openGame("worldsplit") } }),
      el("button", { className: "geo-button geo-secondary", text: "Try another game", attrs: { type: "button" }, on: { click: () => shell.openGamePicker({ current: "geoguessr" }) } }),
    ],
  });
  const journey = createGeoRoundJourney(GEOGUESSR_ROUND_LIMIT);
  const loadingPanel = el("section", { className: "geo-loading-panel", attrs: { role: "status" }, children: [journey.element, el("div", { className: "geo-loading-icon", children: [icon("pin")] }), errorTitle, loadingText, el("div", { className: "geo-loading-actions", children: [retryButton, exitButton] }), alternativeGames] });
  const resultPanel = el("section", { className: "geo-result-card", attrs: { hidden: "true", "aria-label": "Round result" } });
  const mapLegend = el("div", { className: "geo-map-legend", children: [el("span", { className: "geo-legend-guess", text: "Your pin" }), el("span", { className: "geo-legend-target", text: "Actual location" })] });
  const element = el("section", { className: "game-screen geoguessr-screen", attrs: { "data-phase": "loading" }, children: [panorama.element, el("div", { className: "geo-vignette", attrs: { "aria-hidden": "true" } }), loadingPanel, topbar, compass, bottomTools, mapDock, mapReveal, resultPanel, mapLegend, roundIntro, celebration] });
  const picker = createGeoMapPicker({ initial: selectedMap, signal,
    best: map => readSingleBest(bestStorage, "geoguessr", map.id),
    onPlay: map => {
      selectedMap = map;
      try { preferenceStorage?.setItem("locato:geoguessr:selected-map", map.id); } catch { /* Storage is optional. */ }
      pickerShown = false; picker.close(); element.dataset.mapPicker = "closed";
      bar.refreshBest(); void loadGame();
    },
    onClose: () => {
      pickerShown = false; picker.close(); element.dataset.mapPicker = "closed";
      setPhase(status);
      if (status === "complete") resultPanel.querySelector<HTMLElement>(".shell-results-title")?.focus();
      else bar.element.querySelector<HTMLButtonElement>(".shell-gamebar-more")?.focus();
    },
  });
  element.append(picker.element);
  function openMapPicker(): void {
    if (status !== "selecting" && status !== "complete") return;
    pickerShown = true; element.dataset.mapPicker = "open";
    panorama.element.inert = true; mapDock.inert = true; resultPanel.inert = true; bottomTools.inert = true;
    picker.open(selectedMap, status !== "selecting");
  }
  const resultLayout = new ResizeObserver(() => {
    if (signal.aborted || status !== "result") return;
    element.style.setProperty("--geo-result-height", `${resultPanel.offsetHeight}px`);
    map.showResult?.();
  });
  resultLayout.observe(resultPanel);
  const toggleFullscreen = (): void => {
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void request.catch(() => { help.textContent = "Fullscreen is unavailable in this browser."; });
  };
  const fullscreenItems = fullscreenEnabled ? [{ label: "Fullscreen", icon: "maximize" as const, onSelect: toggleFullscreen }] : [];
  const bar = createBestBar(element, shell, {
    gameMode: "geoguessr",
    storage: bestStorage,
    variant: () => selectedMap.id,
    extraMenuItems: [
      ...fullscreenItems,
      { label: "Restart run", icon: "rotate-ccw", onSelect: () => { if (status !== "selecting" && !pickerShown && (options.ranked || services.isConfigured())) void loadGame(); } },
    ],
  });
  bar.element.classList.add("geo-gamebar");
  topbar.append(bar.element, session);

  const totalScore = () => results.reduce((sum, item) => sum + item.score, 0);
  const countryName = (location: GeoGuessrLocation) => options.countryIndex.byCode.get(location.countryCode)?.name ?? location.countryCode;
  function setPhase(next: GameStatus): void {
    countdownController?.abort();
    countdownController = null;
    if (next !== "result") feedback.reset();
    if (next !== "playing") roundIntro.replaceChildren();
    if (next === "loading" || next === "complete") celebration.replaceChildren();
    element.dataset.reducedMotion = String(feedback.reducedMotion());
    const departing = status === "loading" && next === "playing" && !feedback.reducedMotion();
    status = next;
    const complete = next === "complete";
    mapHeader.hidden = mapToolbar.hidden = next === "result" || complete;
    mapTools.hidden = session.hidden = complete;
    element.dataset.phase = next;
    loadingPanel.classList.toggle("is-departing", departing);
    loadingPanel.hidden = !departing && next !== "loading" && next !== "error" && next !== "unconfigured";
    loadingPanel.setAttribute("aria-hidden", String(departing || loadingPanel.hidden));
    panorama.element.setAttribute("aria-busy", String(next === "loading"));
    retryButton.hidden = next !== "error";
    exitButton.hidden = next !== "error";
    alternativeGames.hidden = next !== "unconfigured";
    resultPanel.hidden = next !== "result" && next !== "complete";
    resultPanel.setAttribute("aria-label", next === "complete" ? "Game results" : "Round result");
    panorama.element.inert = pickerShown || next !== "playing";
    resultPanel.inert = pickerShown; bottomTools.inert = pickerShown;
    guide.open = false;
    mapReveal.disabled = next !== "playing";
    resetButton.disabled = next !== "playing";
    if (options.ranked) for (const button of panorama.element.querySelectorAll<HTMLButtonElement>("button")) button.disabled = next !== "playing";
    mapDock.inert = pickerShown || next === "selecting" || next === "loading" || next === "error" || next === "unconfigured" || (next === "playing" && mapSize === "collapsed");
  }
  function setMapSize(next: MapSize): void {
    const changed = element.dataset.mapSize !== next;
    mapSize = next;
    element.dataset.mapSize = next;
    mapReveal.setAttribute("aria-expanded", String(next !== "collapsed"));
    mapExpand.setAttribute("aria-label", next === "expanded" ? "Reduce guess map" : "Expand guess map");
    mapExpand.title = next === "expanded" ? "Reduce guess map" : "Expand guess map";
    mapExpand.replaceChildren(icon(next === "expanded" ? "collapse" : "expand"));
    mapDock.inert = pickerShown || status === "selecting" || status === "loading" || status === "error" || status === "unconfigured" || (status === "playing" && next === "collapsed");
    if (changed && next !== "collapsed") requestAnimationFrame(() => { if (!signal.aborted) map.resize(); });
  }
  function updateHud(): void {
    roundLabel.textContent = String(roundIndex + 1).padStart(2, "0");
    scoreLabel.textContent = formatNumber(totalScore());
    [...steps.children].forEach((step, i) => {
      step.querySelector(".geo-step-score")!.textContent = results[i] ? formatNumber(results[i]!.score) : "";
      step.setAttribute("aria-label", `Round ${i + 1}${results[i] ? `: ${formatNumber(results[i]!.score)} points` : ""}`);
      step.classList.remove("is-just-scored");
      step.classList.toggle("is-done", i < results.length);
      step.classList.toggle("is-current", i === roundIndex && status !== "complete");
      if (i === roundIndex) step.setAttribute("aria-current", "step"); else step.removeAttribute("aria-current");
    });
  }
  function showError(): void {
    setPhase("error");
    map.setAcceptingGuesses(false);
    errorTitle.textContent = "Street View couldn’t load";
    loadingText.textContent = "Try loading this location again, or choose another game.";
  }
  async function startRound(): Promise<void> {
    const id = ++requestId;
    const location = locations[roundIndex];
    if (!location) { showError(); return; }
    setPhase("loading");
    journey.setCountdown(null);
    journey.setRound(roundIndex);
    errorTitle.textContent = roundIndex === 0 ? "The world is yours." : "Somewhere new awaits.";
    loadingText.textContent = "Getting your next location ready…";
    guess = null;
    submitButton.disabled = true;
    submitButton.querySelector("span")!.textContent = "Place your pin";
    mapTitle.textContent = "Your guess";
    pinStatus.textContent = "Click anywhere on the map";
    mapDock.dataset.hasPin = "false";
    returnPin.disabled = true;
    map.reset();
    map.setAcceptingGuesses(false);
    setMapSize(narrow.matches ? "collapsed" : mapPinned ? "expanded" : "compact");
    updateHud();
    retry = () => { void startRound(); };
    try {
      let current = location;
      let snapped: LngLatPoint;
      const deadline = Date.now() + 20_000;
      for (let attempt = 0; ; attempt++) {
        try { snapped = await panorama.show(current); break; }
        catch (error) {
          if (signal.aborted || id !== requestId) return;
          if (options.ranked || attempt >= 7 || Date.now() >= deadline || !reserveLocations.length) throw error;
          const sameCountryGps = reserveLocations.findIndex(candidate => candidate.countryCode === current.countryCode && hasGeoCoordinates(candidate));
          const sameCountry = reserveLocations.findIndex(candidate => candidate.countryCode === current.countryCode);
          const gps = reserveLocations.findIndex(hasGeoCoordinates);
          const replacement = sameCountryGps >= 0 ? sameCountryGps : sameCountry >= 0 ? sameCountry : gps >= 0 ? gps : 0;
          current = reserveLocations.splice(replacement, 1)[0]!;
        }
      }
      if (signal.aborted || id !== requestId) return;
      locations[roundIndex] = { ...current, ...snapped };
      const countdown = new AbortController();
      countdownController = countdown;
      errorTitle.textContent = "Get ready to explore.";
      loadingText.textContent = "Look for clues. Trust your instinct.";
      await services.countdown(countdown.signal, remaining => {
        if (signal.aborted || id !== requestId) return;
        journey.setCountdown(remaining);
        feedback.play("countdown", remaining);
      });
      if (signal.aborted || id !== requestId) return;
      setPhase("playing");
      journey.setCountdown(0);
      roundIntro.replaceChildren(el("div", { children: [el("span", { text: "Explore the world" }), el("strong", { text: `Round ${roundIndex + 1}` }), el("span", { text: "of 5" })] }));
      feedback.play("go");
      map.setAcceptingGuesses(true);
    } catch { if (!signal.aborted && id === requestId) showError(); }
  }
  function revealResult(item: GeoGuessrGuessResult, index: number): void {
    reviewIndex = index;
    mapTitle.textContent = countryName(item.target);
    pinStatus.textContent = `${formatDistance(item.distanceKm)} between your pin and the location`;
    map.reveal(item.target, [{ ...item.guess, label: "Your pin", color: "#287965" }]);
    map.highlightCountry?.(item.target.countryCode);
    requestAnimationFrame(() => { if (!signal.aborted) { map.resize(); map.showResult?.(); } });
  }
  function nextRound(): void {
    if (status !== "result") return;
    if (roundIndex === GEOGUESSR_ROUND_LIMIT - 1) { showFinal(); return; }
    roundIndex += 1;
    void startRound();
  }
  async function submitGuess(): Promise<void> {
    const location = locations[roundIndex];
    if (pickerShown || status !== "playing" || !guess || !location) return;
    feedback.play("submit");
    let result: GeoGuessrGuessResult;
    const id = requestId;
    if (options.ranked) {
      status = "loading"; submitButton.disabled = true;
      try { result = (await options.ranked.move({ type: "pin", ...guess })).result!.geo!; }
      catch { if (!signal.aborted && id === requestId) { status = "playing"; submitButton.disabled = false; pinStatus.textContent = "Could not check your pin. Try again."; } return; }
      if (signal.aborted || id !== requestId) return;
      locations[roundIndex] = result.target;
    } else {
      if (!hasGeoCoordinates(location)) return;
      result = scoreGeoGuessrGuess(guess, location);
    }
    results.push(result);
    setPhase("result");
    setMapSize("expanded");
    map.setAcceptingGuesses(false);
    updateHud();
    revealResult(result, roundIndex);
    const heading = el("h2", { text: countryName(result.target), attrs: { tabindex: "-1" } });
    const progress = el("div", { className: "geo-result-meter", attrs: { role: "meter", "aria-label": "Round score", "aria-valuemin": "0", "aria-valuemax": "5000", "aria-valuenow": String(result.score) }, children: [el("span", { attrs: { style: `width:${result.score / GEOGUESSR_MAX_ROUND_SCORE * 100}%` } })] });
    const nextButton = el("button", { className: "geo-button geo-primary", attrs: { type: "button" }, children: [el("span", { text: roundIndex === GEOGUESSR_ROUND_LIMIT - 1 ? "See final score" : "Next round" }), icon("arrow")], on: { click: nextRound } });
    const verdict = result.score === 5000 ? "Right on the spot!" : result.score >= 4500 ? "So close!" : result.score >= 3000 ? "Great exploring!" : result.score >= 1000 ? "A little further afield" : "A world of possibilities";
    resultPanel.replaceChildren(
      el("div", { className: "geo-result-eyebrow", children: [el("span", { className: "geo-label", text: `Round ${roundIndex + 1} of 5` }), el("span", { className: "geo-result-verdict", text: verdict })] }),
      el("div", { className: "geo-result-country", children: [el("img", { className: "geo-result-flag", attrs: { src: `/assets/flags/${result.target.countryCode.toLowerCase()}.svg`, alt: "", width: "48", height: "34" } }), el("div", { children: [el("span", { className: "geo-label", text: "You were in" }), heading] })] }),
      el("div", { className: "geo-round-points", children: [el("strong", { text: formatNumber(result.score) }), el("span", { text: " / 5,000 points" })] }), progress,
      el("div", { className: "geo-result-distance", children: [icon("pin"), el("div", { children: [el("strong", { text: formatDistance(result.distanceKm) }), el("span", { text: " from the actual location" })] })] }),
      el("p", { className: "geo-score-explainer", text: "Every kilometre closer earns more points." }),
      nextButton,
      el("div", { className: "geo-trip-total", children: [el("span", { text: "Trip total" }), el("strong", { text: `${formatNumber(totalScore())} / 25,000` })] }),
    );
    feedback.play("score", result.score);
    feedback.count(resultPanel.querySelector<HTMLElement>(".geo-round-points strong")!, result.score, formatNumber);
    steps.children[roundIndex]?.classList.add("is-just-scored");
    if (result.score >= 4500) celebrate();
    heading.focus();
  }
  function showFinal(): void {
    setPhase("complete");
    updateHud();
    requestAnimationFrame(() => { if (!signal.aborted) { map.resize(); map.showResult?.(); } });
    const total = totalScore();
    const averageKm = results.reduce((sum, item) => sum + item.distanceKm, 0) / Math.max(1, results.length);
    const bestIndex = results.reduce((top, item, index) => (item.score > (results[top]?.score ?? -1) ? index : top), 0);
    const best = results[bestIndex];
    const ratio = total / GEOGUESSR_MAX_GAME_SCORE;
    const shareText = `Locato GeoGuessr · ${selectedMap.name} ${formatNumber(total)}/${formatNumber(GEOGUESSR_MAX_GAME_SCORE)}\n${results.map((item) => shareSquare(item.score / GEOGUESSR_MAX_ROUND_SCORE)).join("")}\nlocato.quest`;
    const stats = [
      { label: "Total score", value: formatNumber(total), note: `of ${formatNumber(GEOGUESSR_MAX_GAME_SCORE)}` },
      { label: "Average distance", value: formatDistance(averageKm) },
      ...(best ? [{ label: "Best round", value: formatNumber(best.score), note: countryName(best.target) }] : []),
    ];
    // A settled, quiet recap; round reveals keep their own celebration.
    const tone = "neutral" as const;
    map.setStyle?.("roadmap");
    // Every finished trip counts: it posts, and the board keeps your best.
    const previousBest = readSingleBest(bestStorage, "geoguessr", selectedMap.id);
    const posting = submitRankedAttempt({ shell, mode: "geoguessr", variant: selectedMap.id, total, storage: bestStorage, ...(options.ranked ? { post: options.ranked.post } : services.postAttempt ? { post: services.postAttempt } : {}) });
    bar.refreshBest();
    const isNewBest = total > previousBest;
    const card = createRankedResults(shell, {
      mode: "geoguessr",
      variant: selectedMap.id,
      title: isNewBest && previousBest > 0 ? "A new best trip!" : ratio >= 0.7 ? "World traveller" : ratio >= 0.4 ? "Well explored" : "Trip complete",
      total,
      stats,
      tryAnother: false,
      shareTitle: "Locato GeoGuessr",
      shareText,
      onTryAgain: () => { void loadGame(); },
      posting,
      tone,
    });
    card.element.querySelector(".shell-results-kicker")!.textContent = `${selectedMap.name} · Trip complete`;
    const hero = card.element.querySelector(".shell-results-stat.is-hero")!;
    hero.append(el("div", { className: "geo-end-score-track", attrs: { "aria-hidden": "true" }, children: [el("span", { attrs: { style: `width:${ratio * 100}%` } })] }));
    hero.append(el("p", { className: "geo-end-best", children: [el("span", { text: isNewBest && previousBest > 0 ? "New personal best" : "Personal best" }), el("strong", { text: formatNumber(Math.max(previousBest, total)) })] }));
    const changeMap = el("button", { className: "shell-btn shell-btn-quiet geo-end-change-map", attrs: { type: "button" }, children: [icon("globe"), el("span", { text: "Choose a map" })], on: { click: openMapPicker } });
    card.element.querySelector(".shell-results-secondary")!.prepend(changeMap);
    // One compact recap serves both as the trip summary and map review.

    const recap = createRunList("Your five rounds", results.map((item, index) => ({
      label: countryName(item.target),
      flagSrc: `/assets/flags/${item.target.countryCode.toLowerCase()}.svg`,
      detail: formatDistance(item.distanceKm),
      value: formatNumber(item.score),
      tone: item.score / GEOGUESSR_MAX_ROUND_SCORE >= 0.7 ? "good" : item.score / GEOGUESSR_MAX_ROUND_SCORE >= 0.3 ? "ok" : "miss",
      ariaLabel: `Review round ${index + 1}: ${countryName(item.target)}`,
      pressed: index === reviewIndex,
      onClick: () => {
        const rows = [...recap.querySelectorAll<HTMLButtonElement>(".gb-run-row")];
        rows.forEach((row, rowIndex) => row.setAttribute("aria-pressed", String(rowIndex === index)));
        revealResult(item, index);
      },
    })), "geo-recap");
    recap.querySelectorAll(".gb-run-row").forEach((row) => row.classList.add("geo-recap-row"));
    insertIntoResults(card, recap);
    resultPanel.replaceChildren(card.element);
    feedback.play("finish");
    card.focus();
  }
  function showUnconfigured(): void {
    setPhase("unconfigured");
    map.setAcceptingGuesses(false);
    errorTitle.textContent = "Street View isn’t set up here";
    loadingText.textContent = "GeoGuessr needs Google Street View, which isn’t available on this copy of Locato. These play right away:";
  }
  async function loadGame(): Promise<void> {
    if (status === "loading") return;
    if (!options.ranked && !services.isConfigured()) { showUnconfigured(); return; }
    const id = ++requestId;
    setPhase("loading");
    results = [];
    map.setStyle?.(mapStyle);
    roundIndex = 0;
    updateHud();
    journey.setCountdown(null);
    journey.setRound(0);
    errorTitle.textContent = "Your next adventure awaits.";
    loadingText.textContent = "Five rounds. Up to 5,000 points each.";
    retry = () => { void loadGame(); };
    try {
      if (options.ranked) await options.ranked.start(selectedMap.id);
      if (signal.aborted || id !== requestId) return;
      const online = options.ranked ? Array.from({ length: GEOGUESSR_ROUND_LIMIT }, () => ({ lat: 0, lng: 0, heading: 0, label: "Mystery location", countryCode: "" })) : await services.loadLocations(signal, selectedMap.id);
      if (signal.aborted || id !== requestId) return;
      const eligible = options.ranked ? online : online.filter(location => locationInGeoMap(location, selectedMap));
      const pool = eligible.length >= GEOGUESSR_ROUND_LIMIT ? eligible : fallbackLocations(selectedMap.id);
      locations = pool.slice(0, GEOGUESSR_ROUND_LIMIT);
      reserveLocations = pool.slice(GEOGUESSR_ROUND_LIMIT);
      await startRound();
    } catch { if (!signal.aborted && id === requestId) showError(); }
  }

  retryButton.addEventListener("click", () => retry(), { signal });
  submitButton.addEventListener("click", submitGuess, { signal });
  resetButton.addEventListener("click", panorama.reset, { signal });
  mapReveal.addEventListener("click", () => { setMapSize(narrow.matches ? "expanded" : "compact"); mapExpand.focus(); }, { signal });
  function pinMap(pinned: boolean): void {
    mapPinned = pinned;
    mapPin.setAttribute("aria-pressed", String(pinned));
    mapPin.title = pinned ? "Let map shrink when you leave" : "Keep map expanded";
    setMapSize(pinned ? "expanded" : "compact");
  }
  mapPin.addEventListener("click", () => pinMap(!mapPinned), { signal });
  mapExpand.addEventListener("click", () => pinMap(mapSize !== "expanded"), { signal });
  mapDock.addEventListener("pointerenter", () => {
    if (status === "playing" && hoverPointer.matches && !narrow.matches) setMapSize("expanded");
  }, { signal });
  mapDock.addEventListener("pointerleave", () => {
    if (status === "playing" && hoverPointer.matches && !narrow.matches && !mapPinned && !mapDock.querySelector(":focus-visible")) setMapSize("compact");
  }, { signal });
  mapDock.addEventListener("focusin", () => {
    if (status === "playing" && !narrow.matches) setMapSize("expanded");
  }, { signal });
  mapDock.addEventListener("focusout", event => {
    if (status === "playing" && !narrow.matches && !mapPinned && !mapDock.matches(":hover") && !mapDock.contains(event.relatedTarget as Node | null)) setMapSize("compact");
  }, { signal });
  mapCollapse.addEventListener("click", () => { setMapSize("collapsed"); mapReveal.focus(); }, { signal });
  narrow.addEventListener("change", () => { if (status === "playing") setMapSize(narrow.matches ? "collapsed" : "compact"); }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable='true'],[role='menu'],[role='dialog']"))) return;
    if (pickerShown || status !== "playing") return;
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      setMapSize(mapSize === "collapsed" ? (narrow.matches ? "expanded" : "compact") : "collapsed");
      (mapSize === "collapsed" ? mapReveal : mapExpand).focus();
    }
    if (event.key.toLowerCase() === "r") { event.preventDefault(); panorama.reset(); }
    if (event.key === "Enter" && !event.repeat && !(event.target instanceof HTMLElement && event.target.closest("button,summary,a"))) {
      event.preventDefault(); void submitGuess();
    }
    if (event.key === "Escape") {
      if (guide.open) { guide.open = false; guide.querySelector("summary")?.focus(); return; }
      setMapSize("collapsed"); mapReveal.focus();
    }
  }, { signal });
  setMapSize(mapSize);
  setPhase("selecting");
  openMapPicker();
  return { element, destroy: () => { controller.abort(); resultLayout.disconnect(); bar.destroy(); map.destroy(); panorama.destroy(); } };
}
