import { createMobileGameNav } from "../dom/mobileGameNav";
import type { Screen } from "../../app/router";
import type { CountryIndex } from "../../core/countries";
import { createGeoGuessrQueue, GEOGUESSR_MAX_GAME_SCORE, GEOGUESSR_MAX_ROUND_SCORE, GEOGUESSR_ROUND_LIMIT, scoreGeoGuessrGuess, type GeoGuessrGuessResult, type GeoGuessrLocation } from "../../core/geoguessr";
import type { GameModeId } from "../../core/gameModes";
import type { LngLatPoint } from "../../core/maptap/distance";
import { streetViewCountryRounds, type StreetViewCountryRound } from "../../core/streetview";
import { createGeoGuessMap } from "../components/GeoGuessMap";
import { createBrandLockup } from "../dom/createBrandLockup";
import { el } from "../dom/createElement";
import { createGameModeDropdown } from "../dom/gameModeDropdown";

export interface GeoGuessrScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onHome: () => void;
  readonly onMultiplayer: () => void;
  readonly onDailyChallenge: () => void;
}

type GameStatus = "loading" | "playing" | "result" | "complete";

function googleMapsEmbedApiKey(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_GOOGLE_MAPS_EMBED_API_KEY?: string } }).env;
  return env?.VITE_GOOGLE_MAPS_EMBED_API_KEY?.trim() ?? "";
}

function buildStreetViewUrl(apiKey: string, location: GeoGuessrLocation): string {
  const params = new URLSearchParams({
    key: apiKey,
    location: `${location.lat},${location.lng}`,
    heading: String(location.heading),
    pitch: String(location.pitch ?? 0),
    fov: String(location.fov ?? 90),
    radius: "1000",
    source: "outdoor",
  });
  return `https://www.google.com/maps/embed/v1/streetview?${params.toString()}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStreetViewRound(value: unknown): value is StreetViewCountryRound {
  if (!value || typeof value !== "object") return false;
  const round = value as Partial<StreetViewCountryRound>;
  return typeof round.countryCode === "string" && Array.isArray(round.frames) && round.frames.length > 0 && round.frames.every((frame) =>
    Boolean(frame) && isFiniteNumber(frame.lat) && isFiniteNumber(frame.lng) && isFiniteNumber(frame.heading) && typeof frame.label === "string",
  );
}

async function fetchLocations(signal: AbortSignal): Promise<GeoGuessrLocation[]> {
  try {
    const response = await fetch(`/api/streetview-country/rounds?count=${GEOGUESSR_ROUND_LIMIT}`, { cache: "no-store", signal });
    if (!response.ok) return [];
    const value: unknown = await response.json();
    if (!Array.isArray(value) || !value.every(isStreetViewRound)) return [];
    return createGeoGuessrQueue(`online:${Date.now()}`, GEOGUESSR_ROUND_LIMIT, value);
  } catch {
    return [];
  }
}

function fallbackLocations(): GeoGuessrLocation[] {
  return createGeoGuessrQueue(`solo:${Date.now()}:${Math.random()}`, GEOGUESSR_ROUND_LIMIT, streetViewCountryRounds);
}

function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.max(1, Math.round(distanceKm * 1000)).toLocaleString()} m`;
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm).toLocaleString()} km`;
}

export function createGeoGuessrScreen(options: GeoGuessrScreenOptions): Screen {
  const controller = new AbortController();
  const mobileNav = createMobileGameNav(options, controller.signal);
  const apiKey = googleMapsEmbedApiKey();
  let locations: GeoGuessrLocation[] = [];
  let roundIndex = 0;
  let totalScore = 0;
  let status: GameStatus = "loading";
  let guess: LngLatPoint | null = null;
  let result: GeoGuessrGuessResult | null = null;

  const gameModeDropdown = createGameModeDropdown({
    selectedMode: "geoguessr",
    signal: controller.signal,
    name: "geoguessr-game-mode",
    onChange: (mode) => {
      if (mode !== "geoguessr") options.onGameModeChange(mode);
    },
  });
  const streetViewFrame = el("iframe", {
    className: "geoguessr-streetview-frame",
    attrs: { title: "Interactive mystery Street View", loading: "eager", referrerpolicy: "no-referrer-when-downgrade", allowfullscreen: "true" },
  });
  const streetViewLoading = el("div", { className: "geoguessr-loading", attrs: { role: "status" }, children: [el("span", { className: "geoguessr-loading-pulse" }), el("strong", { text: "Finding a road somewhere on Earth..." })] });
  const missingKeyPanel = el("div", {
    className: "streetview-missing-key geoguessr-missing-key",
    children: [el("strong", { text: "Street View is taking a detour." }), el("p", { text: "This adventure is temporarily unavailable. There’s still a whole world of other games to explore." }), el("button", { className: "primary-action", text: "Explore other games", attrs: { type: "button" }, on: { click: options.onHome } })],
  });
  const roundLabel = el("strong", { text: `1 / ${GEOGUESSR_ROUND_LIMIT}` });
  const scoreLabel = el("strong", { text: `0 / ${GEOGUESSR_MAX_GAME_SCORE.toLocaleString()}` });
  const pinStatus = el("span", { className: "geoguessr-pin-status", text: "Click the map to place your pin" });
  const submitButton = el("button", { className: "primary-action geoguessr-submit", text: "Make guess", attrs: { type: "button" } });
  const nextButton = el("button", { className: "primary-action", text: "Next round", attrs: { type: "button" } });
  const mapToggle = el("button", { className: "ghost-action geoguessr-map-toggle", text: "Hide map", attrs: { type: "button", "aria-expanded": "true" } });
  const resultPanel = el("section", { className: "geoguessr-result", attrs: { hidden: "true", "aria-live": "polite" } });
  const mapDock = el("aside", { className: "geoguessr-map-dock is-open" });
  const map = createGeoGuessMap({
    signal: controller.signal,
    onGuessChange: (point) => {
      if (status !== "playing") return;
      guess = point;
      pinStatus.textContent = `${Math.abs(point.lat).toFixed(2)}° ${point.lat >= 0 ? "N" : "S"}, ${Math.abs(point.lng).toFixed(2)}° ${point.lng >= 0 ? "E" : "W"}`;
      submitButton.disabled = false;
    },
  });
  const mapHeader = el("div", {
    className: "geoguessr-map-header",
    children: [
      el("div", { children: [el("span", { className: "eyebrow", text: "YOUR GUESS" }), pinStatus] }),
      mapToggle,
    ],
  });
  const mapActions = el("div", { className: "geoguessr-map-actions", children: [submitButton] });
  mapDock.append(mapHeader, map.element, mapActions, resultPanel);

  const roundHud = el("div", {
    className: "geoguessr-hud",
    children: [
      el("div", { children: [el("span", { text: "Round" }), roundLabel] }),
      el("div", { children: [el("span", { text: "Score" }), scoreLabel] }),
    ],
  });
  const dailyButton = el("button", { className: "ghost-action nav-action", text: "Daily Challenge", attrs: { type: "button" } });
  const multiplayerButton = el("button", { className: "ghost-action nav-action", text: "Multiplayer", attrs: { type: "button" } });
  const element = el("section", {
    className: "game-screen geoguessr-screen",
    children: [
      el("header", {
        className: "game-header geoguessr-header",
        children: [
          el("div", { className: "game-header-left", children: [createBrandLockup(options.onHome), gameModeDropdown.element] }),
          el("div", { className: "game-header-actions", children: [dailyButton, multiplayerButton, mobileNav.button, mobileNav.sheet] }),
        ],
      }),
      el("div", { className: "geoguessr-stage", children: [streetViewFrame, streetViewLoading, missingKeyPanel, roundHud, mapDock] }),
    ],
  });

  function activeLocation(): GeoGuessrLocation | null {
    return locations[roundIndex] ?? null;
  }

  function countryName(location: GeoGuessrLocation): string {
    return options.countryIndex.byCode.get(location.countryCode)?.name ?? location.countryCode;
  }

  function updateHud(): void {
    roundLabel.textContent = `${Math.min(roundIndex + 1, GEOGUESSR_ROUND_LIMIT)} / ${GEOGUESSR_ROUND_LIMIT}`;
    scoreLabel.textContent = `${totalScore.toLocaleString()} / ${GEOGUESSR_MAX_GAME_SCORE.toLocaleString()}`;
  }

  function startRound(): void {
    const location = activeLocation();
    result = null;
    guess = null;
    resultPanel.hidden = true;
    mapActions.hidden = false;
    pinStatus.textContent = "Click the map to place your pin";
    submitButton.disabled = true;
    status = location ? "playing" : "complete";
    map.reset();
    map.setAcceptingGuesses(Boolean(location));
    mapDock.classList.remove("is-result");
    updateHud();

    if (!location || !apiKey) {
      streetViewFrame.hidden = true;
      streetViewLoading.hidden = true;
      missingKeyPanel.hidden = Boolean(apiKey);
      mapDock.hidden = !apiKey;
      roundHud.hidden = !apiKey;
      return;
    }
    missingKeyPanel.hidden = true;
    streetViewLoading.hidden = false;
    streetViewFrame.hidden = false;
    streetViewFrame.onload = () => { streetViewLoading.hidden = true; };
    streetViewFrame.src = buildStreetViewUrl(apiKey, location);
  }

  function showRoundResult(): void {
    const location = activeLocation();
    if (!location || !result) return;
    const isLastRound = roundIndex >= GEOGUESSR_ROUND_LIMIT - 1;
    resultPanel.hidden = false;
    resultPanel.replaceChildren(
      el("div", {
        className: "geoguessr-result-copy",
        children: [
          el("span", { className: "eyebrow", text: isLastRound ? "FINAL ROUND" : `ROUND ${roundIndex + 1}` }),
          el("strong", { className: "geoguessr-result-score", text: `+${result.score.toLocaleString()} points` }),
          el("span", { text: `${formatDistance(result.distanceKm)} away · ${countryName(location)}` }),
        ],
      }),
      nextButton,
    );
    nextButton.textContent = isLastRound ? "See final score" : "Next round";
  }

  function submitGuess(): void {
    const location = activeLocation();
    if (status !== "playing" || !guess || !location) return;
    result = scoreGeoGuessrGuess(guess, location);
    totalScore += result.score;
    status = "result";
    submitButton.disabled = true;
    mapActions.hidden = true;
    map.setAcceptingGuesses(false);
    map.reveal(location, [{ ...guess, label: "Your guess" }]);
    mapDock.classList.add("is-result", "is-open");
    mapToggle.textContent = "Hide map";
    mapToggle.setAttribute("aria-expanded", "true");
    updateHud();
    showRoundResult();
    requestAnimationFrame(map.resize);
  }

  function showFinalResult(): void {
    status = "complete";
    streetViewFrame.hidden = true;
    streetViewLoading.hidden = true;
    mapDock.classList.add("is-result", "is-open");
    mapActions.hidden = true;
    resultPanel.hidden = false;
    resultPanel.replaceChildren(
      el("div", {
        className: "geoguessr-final-copy",
        children: [
          el("span", { className: "eyebrow", text: "EXPEDITION COMPLETE" }),
          el("strong", { className: "geoguessr-final-score", text: totalScore.toLocaleString() }),
          el("span", { text: `out of ${GEOGUESSR_MAX_GAME_SCORE.toLocaleString()} points` }),
        ],
      }),
      nextButton,
    );
    nextButton.textContent = "Play again";
  }

  async function loadGame(): Promise<void> {
    status = "loading";
    const onlineLocations = await fetchLocations(controller.signal);
    if (controller.signal.aborted) return;
    locations = onlineLocations.length >= GEOGUESSR_ROUND_LIMIT ? onlineLocations : fallbackLocations();
    roundIndex = 0;
    totalScore = 0;
    startRound();
  }

  submitButton.addEventListener("click", submitGuess, { signal: controller.signal });
  nextButton.addEventListener("click", () => {
    if (status === "complete") {
      void loadGame();
      return;
    }
    if (roundIndex >= GEOGUESSR_ROUND_LIMIT - 1) {
      showFinalResult();
      return;
    }
    roundIndex += 1;
    startRound();
  }, { signal: controller.signal });
  mapToggle.addEventListener("click", () => {
    const opening = !mapDock.classList.contains("is-open");
    mapDock.classList.toggle("is-open", opening);
    mapToggle.textContent = opening ? "Hide map" : "Open map";
    mapToggle.setAttribute("aria-expanded", String(opening));
    if (opening) requestAnimationFrame(map.resize);
  }, { signal: controller.signal });
  dailyButton.addEventListener("click", options.onDailyChallenge, { signal: controller.signal });
  multiplayerButton.addEventListener("click", options.onMultiplayer, { signal: controller.signal });

  void loadGame();

  return {
    element,
    destroy: () => controller.abort(),
  };
}
