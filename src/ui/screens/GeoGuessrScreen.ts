import type { Screen } from "../../app/router";
import type { ShellContext } from "../shell/types";
import type { CountryIndex } from "../../core/countries";
import { createGeoGuessrQueue, GEOGUESSR_MAX_GAME_SCORE, GEOGUESSR_MAX_ROUND_SCORE, GEOGUESSR_ROUND_LIMIT, scoreGeoGuessrGuess, type GeoGuessrGuessResult, type GeoGuessrLocation } from "../../core/geoguessr";
import type { GameModeId } from "../../core/gameModes";
import type { LngLatPoint } from "../../core/maptap/distance";
import { streetViewCountryRounds, type StreetViewCountryRound } from "../../core/streetview";
import { createGeoGuessMap, googleMapsJavaScriptApiKey } from "../components/GeoGuessMap";
import { createGeoStreetView } from "../components/GeoStreetView";
import { el } from "../dom/createElement";
import { createRunList, formatKm, formatNumber, insertIntoResults, shareSquare, shellOrFallback } from "./practiceRun";
import { createBestBar, createRankedResults, readSingleBest, submitRankedAttempt, type PostRankedAttempt } from "./rankedAttempt";


export interface GeoGuessrScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly countryIndex: CountryIndex;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onHome: () => void;
  readonly onMultiplayer: () => void;
  readonly onDailyChallenge: () => void;
  /** Keeps the local best for a five-round total. */
  readonly storage?: Storage;
}

/** Injectable surfaces keep the full game flow testable without Google credentials. */
export interface GeoGuessrScreenServices {
  readonly createMap: typeof createGeoGuessMap;
  readonly createPanorama: typeof createGeoStreetView;
  readonly loadLocations: (signal: AbortSignal) => Promise<GeoGuessrLocation[]>;
  /** False when no Google Maps key is configured: the screen shows a friendly "not set up" state. */
  readonly isConfigured: () => boolean;
  /** Posts a ranked attempt's total (defaults to the leaderboard API). */
  readonly postAttempt?: PostRankedAttempt;
}

type GameStatus = "loading" | "playing" | "result" | "complete" | "error" | "unconfigured";
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
const formatDistance = formatKm;

export function createGeoGuessrScreen(options: GeoGuessrScreenOptions, overrides: Partial<GeoGuessrScreenServices> = {}): Screen {
  const services: GeoGuessrScreenServices = {
    createMap: createGeoGuessMap,
    createPanorama: createGeoStreetView,
    loadLocations: fetchLocations,
    // An injected panorama (tests, previews) brings its own imagery.
    isConfigured: () => overrides.createPanorama !== undefined || Boolean(googleMapsJavaScriptApiKey()),
    ...overrides,
  };
  const controller = new AbortController();
  const shell = shellOrFallback(options.shell, options.onHome);
  const bestStorage = options.storage ?? shell.storage ?? null;
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
  const session = el("div", { className: "geo-session", children: [el("div", { className: "geo-round", children: [el("span", { className: "geo-label", text: "Round" }), roundLabel, el("span", { className: "geo-round-limit", text: "/ 05" })] }), steps, el("div", { className: "geo-score", children: [scoreLabel, el("span", { text: "pts", className: "geo-label" })] })] });
  const fullscreenEnabled = typeof document !== "undefined" && document.fullscreenEnabled === true;
  const topbar = el("div", { className: "geo-topbar" });

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
  const loadingPanel = el("section", { className: "geo-loading-panel", attrs: { role: "status" }, children: [el("div", { className: "geo-loading-icon", children: [icon("pin")] }), errorTitle, loadingText, el("div", { className: "geo-loading-actions", children: [retryButton, exitButton] }), alternativeGames] });
  const resultPanel = el("section", { className: "geo-result-card", attrs: { hidden: "true", "aria-label": "Round result" } });
  const mapLegend = el("div", { className: "geo-map-legend", children: [el("span", { className: "geo-legend-guess", text: "Your pin" }), el("span", { className: "geo-legend-target", text: "Actual location" })] });
  const element = el("section", { className: "game-screen geoguessr-screen", attrs: { "data-phase": "loading" }, children: [panorama.element, el("div", { className: "geo-vignette", attrs: { "aria-hidden": "true" } }), loadingPanel, topbar, bottomTools, mapDock, mapReveal, resultPanel, mapLegend] });
  const toggleFullscreen = (): void => {
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void request.catch(() => { help.textContent = "Fullscreen is unavailable in this browser."; });
  };
  const fullscreenItems = fullscreenEnabled ? [{ label: "Fullscreen", icon: "maximize" as const, onSelect: toggleFullscreen }] : [];
  const bar = createBestBar(element, shell, {
    gameMode: "geoguessr",
    storage: bestStorage,
    extraMenuItems: [
      ...fullscreenItems,
      { label: "Restart run", icon: "rotate-ccw", onSelect: () => { if (services.isConfigured()) void loadGame(); } },
    ],
  });
  bar.element.classList.add("geo-gamebar");
  topbar.append(bar.element, session);

  const totalScore = () => results.reduce((sum, item) => sum + item.score, 0);
  const countryName = (location: GeoGuessrLocation) => options.countryIndex.byCode.get(location.countryCode)?.name ?? location.countryCode;
  function setPhase(next: GameStatus): void {
    status = next;
    element.dataset.phase = next;
    loadingPanel.hidden = next !== "loading" && next !== "error" && next !== "unconfigured";
    retryButton.hidden = next !== "error";
    exitButton.hidden = next !== "error";
    alternativeGames.hidden = next !== "unconfigured";
    resultPanel.hidden = next !== "result" && next !== "complete";
    resultPanel.setAttribute("aria-label", next === "complete" ? "Game results" : "Round result");
    mapReveal.disabled = next !== "playing";
    resetButton.disabled = next !== "playing";
    mapDock.inert = next === "loading" || next === "error" || next === "unconfigured" || (next === "playing" && mapSize === "collapsed");
  }
  function setMapSize(next: MapSize): void {
    mapSize = next;
    element.dataset.mapSize = next;
    mapReveal.setAttribute("aria-expanded", String(next !== "collapsed"));
    mapExpand.setAttribute("aria-label", next === "expanded" ? "Reduce guess map" : "Expand guess map");
    mapExpand.title = next === "expanded" ? "Reduce guess map" : "Expand guess map";
    mapExpand.replaceChildren(icon(next === "expanded" ? "collapse" : "expand"));
    mapDock.inert = status === "loading" || status === "error" || status === "unconfigured" || (status === "playing" && next === "collapsed");
    if (next !== "collapsed") requestAnimationFrame(() => { if (!signal.aborted) map.resize(); });
  }
  function updateHud(): void {
    roundLabel.textContent = String(roundIndex + 1).padStart(2, "0");
    scoreLabel.textContent = formatNumber(totalScore());
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
      el("div", { className: "geo-round-points", children: [el("strong", { text: `+${formatNumber(result.score)}` }), el("span", { text: `/ ${formatNumber(GEOGUESSR_MAX_ROUND_SCORE)} pts` })] }), progress, nextButton);
    heading.focus();
  }
  function showFinal(): void {
    setPhase("complete");
    updateHud();
    const total = totalScore();
    const averageKm = results.reduce((sum, item) => sum + item.distanceKm, 0) / Math.max(1, results.length);
    const bestIndex = results.reduce((top, item, index) => (item.score > (results[top]?.score ?? -1) ? index : top), 0);
    const best = results[bestIndex];
    const ratio = total / GEOGUESSR_MAX_GAME_SCORE;
    const shareText = `Locato GeoGuessr ${formatNumber(total)}/${formatNumber(GEOGUESSR_MAX_GAME_SCORE)}\n${results.map((item) => shareSquare(item.score / GEOGUESSR_MAX_ROUND_SCORE)).join("")}\nlocato.quest`;
    const visited = results.map((item) => ({ code: item.target.countryCode, name: countryName(item.target), flagSrc: `/assets/flags/${item.target.countryCode.toLowerCase()}.svg` }));
    const stats = [
      { label: "Total score", value: formatNumber(total), note: `of ${formatNumber(GEOGUESSR_MAX_GAME_SCORE)}` },
      { label: "Average distance", value: formatDistance(averageKm) },
      ...(best ? [{ label: "Best round", value: formatNumber(best.score), note: countryName(best.target) }] : []),
    ];
    const tone = ratio >= 0.4 ? "celebrate" : "neutral";
    // Every finished trip counts: it posts, and the board keeps your best.
    const previousBest = readSingleBest(bestStorage, "geoguessr");
    const posting = submitRankedAttempt({ shell, mode: "geoguessr", total, storage: bestStorage, ...(services.postAttempt ? { post: services.postAttempt } : {}) });
    bar.refreshBest();
    const isNewBest = total > previousBest;
    const card = createRankedResults(shell, {
      mode: "geoguessr",
      title: isNewBest && previousBest > 0 ? "A new best trip!" : ratio >= 0.7 ? "World traveller" : ratio >= 0.4 ? "Well explored" : "Trip complete",
      total,
      stats: [...stats, { label: "Your best", value: formatNumber(Math.max(previousBest, total)), note: isNewBest ? "New best" : "On this device" }],
      missed: visited,
      missedTitle: "Places you visited",
      shareTitle: "Locato GeoGuessr",
      shareText,
      onTryAgain: () => { void loadGame(); },
      posting,
      tone,
    });
    // The pins review stays: each row re-reveals that round's pin and location on the map.
    const recap = createRunList("Review each round", results.map((item, index) => ({
      label: countryName(item.target),
      detail: formatDistance(item.distanceKm),
      value: formatNumber(item.score),
      tone: item.score / GEOGUESSR_MAX_ROUND_SCORE >= 0.7 ? "good" : item.score / GEOGUESSR_MAX_ROUND_SCORE >= 0.3 ? "ok" : "miss",
      ariaLabel: `Review round ${index + 1}: ${countryName(item.target)}`,
      pressed: index === roundIndex,
      onClick: () => {
        const rows = [...recap.querySelectorAll<HTMLButtonElement>(".gb-run-row")];
        rows.forEach((row, rowIndex) => row.setAttribute("aria-pressed", String(rowIndex === index)));
        revealResult(item, index);
      },
    })), "geo-recap");
    recap.querySelectorAll(".gb-run-row").forEach((row) => row.classList.add("geo-recap-row"));
    insertIntoResults(card, recap);
    resultPanel.replaceChildren(card.element);
    card.focus();
  }
  function showUnconfigured(): void {
    setPhase("unconfigured");
    map.setAcceptingGuesses(false);
    errorTitle.textContent = "Street View isn’t set up here";
    loadingText.textContent = "GeoGuessr needs Google Street View, which isn’t available on this copy of Locato. These play right away:";
  }
  async function loadGame(): Promise<void> {
    if (!services.isConfigured()) { showUnconfigured(); return; }
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

  retryButton.addEventListener("click", () => retry(), { signal });
  submitButton.addEventListener("click", submitGuess, { signal });
  resetButton.addEventListener("click", panorama.reset, { signal });
  mapReveal.addEventListener("click", () => { setMapSize(narrow.matches ? "expanded" : "compact"); mapExpand.focus(); }, { signal });
  mapExpand.addEventListener("click", () => setMapSize(mapSize === "expanded" ? "compact" : "expanded"), { signal });
  mapCollapse.addEventListener("click", () => { setMapSize("collapsed"); mapReveal.focus(); }, { signal });
  narrow.addEventListener("change", () => { if (status === "playing") setMapSize(narrow.matches ? "collapsed" : "compact"); }, { signal });
  document.addEventListener("keydown", (event) => {
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
  return { element, destroy: () => { controller.abort(); bar.destroy(); map.destroy(); panorama.destroy(); } };
}
