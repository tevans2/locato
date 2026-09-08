import type { Screen } from "../../app/router";
import type { CountryIndex } from "../../core/countries";
import { createGeoGuessrQueue, GEOGUESSR_MAX_GAME_SCORE, GEOGUESSR_MAX_ROUND_SCORE, GEOGUESSR_ROUND_LIMIT, scoreGeoGuessrGuess, type GeoGuessrGuessResult, type GeoGuessrLocation } from "../../core/geoguessr";
import type { GameModeId } from "../../core/gameModes";
import type { LngLatPoint } from "../../core/maptap/distance";
import { streetViewCountryRounds, type StreetViewCountryRound } from "../../core/streetview";
import { createGeoGuessMap } from "../components/GeoGuessMap";
import { createGeoStreetView } from "../components/GeoStreetView";
import { el } from "../dom/createElement";

export interface GeoGuessrScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onHome: () => void;
  readonly onMultiplayer: () => void;
  readonly onDailyChallenge: () => void;
}

/** Injectable surfaces keep the full game flow testable without Google credentials. */
export interface GeoGuessrScreenServices {
  readonly createMap: typeof createGeoGuessMap;
  readonly createPanorama: typeof createGeoStreetView;
  readonly loadLocations: (signal: AbortSignal) => Promise<GeoGuessrLocation[]>;
}

type GameStatus = "loading" | "playing" | "result" | "complete" | "error";
type MapSize = "collapsed" | "compact" | "expanded";

function icon(name: "back" | "pin" | "expand" | "collapse" | "reset" | "settings" | "arrow" | "map" | "close"): SVGSVGElement {
  const paths = {
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
function isStreetViewRound(value: unknown): value is StreetViewCountryRound {
  if (!value || typeof value !== "object") return false;
  const round = value as Partial<StreetViewCountryRound>;
  return typeof round.countryCode === "string" && Array.isArray(round.frames) && round.frames.length > 0 && round.frames.every((frame) => Boolean(frame) && isFiniteNumber(frame.lat) && isFiniteNumber(frame.lng) && isFiniteNumber(frame.heading) && typeof frame.label === "string");
}
async function fetchLocations(signal: AbortSignal): Promise<GeoGuessrLocation[]> {
  try {
    const response = await fetch(`/api/streetview-country/rounds?count=${GEOGUESSR_ROUND_LIMIT}`, { cache: "no-store", signal });
    if (!response.ok) return [];
    const value: unknown = await response.json();
    if (!Array.isArray(value) || !value.every(isStreetViewRound)) return [];
    return createGeoGuessrQueue(`online:${Date.now()}`, GEOGUESSR_ROUND_LIMIT, value);
  } catch { return []; }
}
function fallbackLocations(): GeoGuessrLocation[] { return createGeoGuessrQueue(`solo:${Date.now()}:${Math.random()}`, GEOGUESSR_ROUND_LIMIT, streetViewCountryRounds); }
function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000).toLocaleString()} m`;
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm).toLocaleString()} km`;
}

export function createGeoGuessrScreen(options: GeoGuessrScreenOptions, overrides: Partial<GeoGuessrScreenServices> = {}): Screen {
  const services: GeoGuessrScreenServices = { createMap: createGeoGuessMap, createPanorama: createGeoStreetView, loadLocations: fetchLocations, ...overrides };
  const controller = new AbortController();
  const signal = controller.signal;
  const narrow = window.matchMedia("(max-width: 700px)");
  let locations: GeoGuessrLocation[] = [];
  let roundIndex = 0;
  let status: GameStatus = "loading";
  let guess: LngLatPoint | null = null;
  let mapSize: MapSize = narrow.matches ? "collapsed" : "compact";
  let requestId = 0;
  let results: GeoGuessrGuessResult[] = [];
  let retry: () => void;

  const panorama = services.createPanorama(signal);
  const roundLabel = el("strong", { text: "01", className: "geo-round-number" });
  const scoreLabel = el("strong", { text: "0", className: "geo-total-score" });
  const steps = el("ol", { className: "geo-round-steps", attrs: { "aria-label": "Round progress" }, children: Array.from({ length: GEOGUESSR_ROUND_LIMIT }, (_, i) => el("li", { text: String(i + 1), attrs: { "aria-label": `Round ${i + 1}` } })) });
  const homeButton = action("All games", "back", "geo-home");
  homeButton.append(el("img", { attrs: { src: "/logo.svg", alt: "", width: "23", height: "23" } }), el("span", { text: "locato." }));
  const menu = el("details", { className: "geo-menu" });
  const menuSummary = el("summary", { attrs: { "aria-label": "Game options", title: "Game options" }, children: [icon("settings")] });
  const fullScreenButton = action("Enter fullscreen", "expand");
  const dailyButton = el("button", { className: "geo-button geo-menu-link", text: "Daily challenge", attrs: { type: "button" }, on: { click: options.onDailyChallenge } });
  const multiplayerButton = el("button", { className: "geo-button geo-menu-link", text: "Multiplayer", attrs: { type: "button" }, on: { click: options.onMultiplayer } });
  menu.append(menuSummary, el("div", { className: "geo-menu-content", children: [el("span", { className: "geo-label", text: "Game options" }), dailyButton, multiplayerButton, el("div", { attrs: { "data-game-preferences": "" } })] }));
  const topbar = el("header", { className: "geo-topbar", children: [
    el("div", { className: "geo-identity", children: [homeButton, el("span", { className: "geo-mode-name", text: "GeoGuessr" })] }),
    el("div", { className: "geo-session", children: [el("div", { className: "geo-round", children: [el("span", { className: "geo-label", text: "Round" }), roundLabel, el("span", { className: "geo-round-limit", text: "/ 05" })] }), steps, el("div", { className: "geo-score", children: [scoreLabel, el("span", { text: "pts", className: "geo-label" })] })] }),
    el("div", { className: "geo-top-actions", children: [fullScreenButton, menu] }),
  ] });

  const pinStatus = el("span", { className: "geo-pin-status", text: "Place a pin" });
  const mapTitle = el("strong", { text: "Your guess" });
  const submitButton = el("button", { className: "geo-button geo-lock", attrs: { type: "button", disabled: "true" }, children: [el("span", { text: "Place a pin to guess" }), icon("arrow")] });
  const mapExpand = action("Expand guess map", "expand");
  const mapCollapse = action("Hide guess map", "close");
  const map = services.createMap({ signal, onGuessChange(point) {
    if (status !== "playing") return;
    guess = point;
    pinStatus.textContent = `${Math.abs(point.lat).toFixed(2)}° ${point.lat >= 0 ? "N" : "S"}  ·  ${Math.abs(point.lng).toFixed(2)}° ${point.lng >= 0 ? "E" : "W"}`;
    submitButton.disabled = false;
    submitButton.querySelector("span")!.textContent = "Lock in guess";
  } });
  map.element.id = "geo-guess-map";
  const mapHeader = el("div", { className: "geo-map-header", children: [icon("map"), el("div", { className: "geo-map-heading", children: [mapTitle, pinStatus] }), mapExpand, mapCollapse] });
  const mapDock = el("aside", { className: "geo-map-panel", attrs: { "aria-label": "Guess map" }, children: [mapHeader, map.element, submitButton] });
  const mapReveal = action("Open guess map", "map", "geo-open-map");
  mapReveal.append(el("span", { text: "Place your guess" }), el("kbd", { text: "M" }));
  mapReveal.setAttribute("aria-controls", "geo-guess-map");
  const resetButton = action("Return to starting point", "reset", "geo-reset");
  resetButton.append(el("span", { text: "Return to start" }));
  const help = el("span", { className: "geo-explore-hint", text: "Explore the street. Find your location on the map." });
  const bottomTools = el("div", { className: "geo-bottom-tools", children: [resetButton, help] });
  const loadingText = el("p", { text: "Loading Street View…" });
  const errorTitle = el("h1", { text: "Loading your location", attrs: { tabindex: "-1" } });
  const retryButton = el("button", { className: "geo-button geo-primary", text: "Try again", attrs: { type: "button", hidden: "true" } });
  const exitButton = el("button", { className: "geo-button geo-secondary", text: "All games", attrs: { type: "button", hidden: "true" }, on: { click: options.onHome } });
  const loadingPanel = el("section", { className: "geo-loading-panel", attrs: { role: "status" }, children: [el("div", { className: "geo-loading-icon", children: [icon("pin")] }), errorTitle, loadingText, el("div", { className: "geo-loading-actions", children: [retryButton, exitButton] })] });
  const resultPanel = el("section", { className: "geo-result-card", attrs: { hidden: "true", "aria-label": "Round result" } });
  const mapLegend = el("div", { className: "geo-map-legend", children: [el("span", { className: "geo-legend-guess", text: "Your pin" }), el("span", { className: "geo-legend-target", text: "Actual location" })] });
  const element = el("section", { className: "game-screen geoguessr-screen", attrs: { "data-phase": "loading" }, children: [panorama.element, el("div", { className: "geo-vignette", attrs: { "aria-hidden": "true" } }), loadingPanel, topbar, bottomTools, mapDock, mapReveal, resultPanel, mapLegend] });

  const totalScore = () => results.reduce((sum, item) => sum + item.score, 0);
  const countryName = (location: GeoGuessrLocation) => options.countryIndex.byCode.get(location.countryCode)?.name ?? location.countryCode;
  function setPhase(next: GameStatus): void {
    status = next;
    element.dataset.phase = next;
    loadingPanel.hidden = next !== "loading" && next !== "error";
    retryButton.hidden = next !== "error";
    exitButton.hidden = next !== "error";
    resultPanel.hidden = next !== "result" && next !== "complete";
    resultPanel.setAttribute("aria-label", next === "complete" ? "Game results" : "Round result");
    mapReveal.disabled = next !== "playing";
    resetButton.disabled = next !== "playing";
    mapDock.inert = next === "loading" || next === "error" || (next === "playing" && mapSize === "collapsed");
  }
  function setMapSize(next: MapSize): void {
    mapSize = next;
    element.dataset.mapSize = next;
    mapReveal.setAttribute("aria-expanded", String(next !== "collapsed"));
    mapExpand.setAttribute("aria-label", next === "expanded" ? "Reduce guess map" : "Expand guess map");
    mapExpand.title = next === "expanded" ? "Reduce guess map" : "Expand guess map";
    mapExpand.replaceChildren(icon(next === "expanded" ? "collapse" : "expand"));
    mapDock.inert = status === "loading" || status === "error" || (status === "playing" && next === "collapsed");
    if (next !== "collapsed") requestAnimationFrame(() => { if (!signal.aborted) map.resize(); });
  }
  function updateHud(): void {
    roundLabel.textContent = String(roundIndex + 1).padStart(2, "0");
    scoreLabel.textContent = totalScore().toLocaleString();
    [...steps.children].forEach((step, i) => {
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
    errorTitle.textContent = `Round ${roundIndex + 1}`;
    loadingText.textContent = "Loading Street View…";
    guess = null;
    submitButton.disabled = true;
    submitButton.querySelector("span")!.textContent = "Place a pin to guess";
    mapTitle.textContent = "Your guess";
    pinStatus.textContent = "Place a pin";
    map.reset();
    map.setAcceptingGuesses(false);
    setMapSize(narrow.matches ? "collapsed" : "compact");
    updateHud();
    retry = () => { void startRound(); };
    try {
      const snapped = await panorama.show(location);
      if (signal.aborted || id !== requestId) return;
      locations[roundIndex] = { ...location, ...snapped };
      setPhase("playing");
      map.setAcceptingGuesses(true);
    } catch { if (!signal.aborted && id === requestId) showError(); }
  }
  function revealResult(item: GeoGuessrGuessResult, index: number): void {
    mapTitle.textContent = `Round ${index + 1} · ${countryName(item.target)}`;
    pinStatus.textContent = `${formatDistance(item.distanceKm)} between your pin and the location`;
    map.reveal(item.target, [{ ...item.guess, label: "Your pin", color: "#d8ec99" }]);
    requestAnimationFrame(() => { if (!signal.aborted) map.resize(); });
  }
  function nextRound(): void {
    if (roundIndex === GEOGUESSR_ROUND_LIMIT - 1) { showFinal(); return; }
    roundIndex += 1;
    void startRound();
  }
  function submitGuess(): void {
    const location = locations[roundIndex];
    if (status !== "playing" || !guess || !location) return;
    const result = scoreGeoGuessrGuess(guess, location);
    results.push(result);
    setPhase("result");
    setMapSize("expanded");
    map.setAcceptingGuesses(false);
    updateHud();
    revealResult(result, roundIndex);
    const heading = el("h2", { text: countryName(location), attrs: { tabindex: "-1" } });
    const progress = el("div", { className: "geo-result-meter", children: [el("span", { attrs: { style: `width:${result.score / GEOGUESSR_MAX_ROUND_SCORE * 100}%` } })] });
    const nextButton = el("button", { className: "geo-button geo-primary", attrs: { type: "button" }, children: [el("span", { text: roundIndex === GEOGUESSR_ROUND_LIMIT - 1 ? "See final score" : "Next round" }), icon("arrow")], on: { click: nextRound } });
    resultPanel.replaceChildren(el("span", { className: "geo-label", text: `Round ${roundIndex + 1} result` }), el("img", { className: "geo-result-flag", attrs: { src: `/assets/flags/${location.countryCode.toLowerCase()}.svg`, alt: "", width: "44", height: "30" } }), heading,
      el("div", { className: "geo-result-distance", children: [el("strong", { text: formatDistance(result.distanceKm) }), el("span", { text: "from the location" })] }),
      el("div", { className: "geo-round-points", children: [el("strong", { text: `+${result.score.toLocaleString()}` }), el("span", { text: `/ ${GEOGUESSR_MAX_ROUND_SCORE.toLocaleString()} pts` })] }), progress, nextButton);
    heading.focus();
  }
  function showFinal(): void {
    setPhase("complete");
    updateHud();
    const heading = el("h2", { text: "Your results", attrs: { tabindex: "-1" } });
    const recap = el("ol", { className: "geo-recap", attrs: { "aria-label": "Review each round" } });
    results.forEach((result, index) => {
      const button = el("button", { className: "geo-button geo-recap-row", attrs: { type: "button", "aria-pressed": String(index === roundIndex), "aria-label": `Review round ${index + 1}: ${countryName(result.target)}` }, children: [el("span", { className: "geo-recap-number", text: String(index + 1).padStart(2, "0") }), el("span", { children: [el("strong", { text: countryName(result.target) }), el("small", { text: formatDistance(result.distanceKm) })] }), el("strong", { text: result.score.toLocaleString() })], on: { click: () => {
        for (const child of recap.querySelectorAll("button")) child.setAttribute("aria-pressed", String(child === button));
        revealResult(result, index);
      } } });
      recap.append(el("li", { children: [button] }));
    });
    resultPanel.replaceChildren(el("span", { className: "geo-label", text: "Game complete" }), heading, el("div", { className: "geo-final-score", children: [el("strong", { text: totalScore().toLocaleString() }), el("span", { text: `/ ${GEOGUESSR_MAX_GAME_SCORE.toLocaleString()} pts` })] }), recap,
      el("button", { className: "geo-button geo-primary", attrs: { type: "button" }, children: [el("span", { text: "Play again" }), icon("arrow")], on: { click: () => { void loadGame(); } } }));
    heading.focus();
  }
  async function loadGame(): Promise<void> {
    const id = ++requestId;
    setPhase("loading");
    results = [];
    roundIndex = 0;
    updateHud();
    errorTitle.textContent = "Loading your locations";
    loadingText.textContent = "Five rounds. Up to 5,000 points each.";
    retry = () => { void loadGame(); };
    try {
      const online = await services.loadLocations(signal);
      if (signal.aborted || id !== requestId) return;
      locations = online.length >= GEOGUESSR_ROUND_LIMIT ? online : fallbackLocations();
      await startRound();
    } catch { if (!signal.aborted && id === requestId) showError(); }
  }

  homeButton.addEventListener("click", options.onHome, { signal });
  retryButton.addEventListener("click", () => retry(), { signal });
  submitButton.addEventListener("click", submitGuess, { signal });
  resetButton.addEventListener("click", panorama.reset, { signal });
  mapReveal.addEventListener("click", () => { setMapSize(narrow.matches ? "expanded" : "compact"); mapExpand.focus(); }, { signal });
  mapExpand.addEventListener("click", () => setMapSize(mapSize === "expanded" ? "compact" : "expanded"), { signal });
  mapCollapse.addEventListener("click", () => { setMapSize("collapsed"); mapReveal.focus(); }, { signal });
  fullScreenButton.hidden = !document.fullscreenEnabled;
  fullScreenButton.addEventListener("click", () => {
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void request.catch(() => { help.textContent = "Fullscreen is unavailable in this browser."; });
  }, { signal });
  document.addEventListener("fullscreenchange", () => {
    const label = document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen";
    fullScreenButton.setAttribute("aria-label", label);
    fullScreenButton.title = label;
  }, { signal });
  narrow.addEventListener("change", () => { if (status === "playing") setMapSize(narrow.matches ? "collapsed" : "compact"); }, { signal });
  document.addEventListener("pointerdown", (event) => { if (!menu.contains(event.target as Node)) menu.open = false; }, { signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) { menu.open = false; menuSummary.focus(); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable='true']"))) return;
    if (status !== "playing") return;
    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      setMapSize(mapSize === "collapsed" ? (narrow.matches ? "expanded" : "compact") : "collapsed");
      (mapSize === "collapsed" ? mapReveal : mapExpand).focus();
    }
    if (event.key === "Escape") { setMapSize("collapsed"); mapReveal.focus(); }
  }, { signal });
  setMapSize(mapSize);
  void loadGame();
  return { element, destroy: () => { controller.abort(); map.destroy(); panorama.destroy(); } };
}
