import { CONTINENTS, type Continent, type Country, type CountryId, type CountryIndex } from "../../core/countries";
import { isWorldMapGameModeId, type GameModeId, type WorldMapGameModeId } from "../../core/gameModes";
import { detectCountryGuess, submitCountryGuess, type WorldCountryFeature } from "../../core/map";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createGameModeDropdown } from "../dom/gameModeDropdown";
import { createAtlasView, setAtlasOpen, updateAtlasView } from "../dom/renderAtlas";
import { createFeedbackView, showFeedback } from "../dom/renderFeedback";
import { createPuzzleMapView, type PuzzleMapProgress } from "../dom/renderPuzzleMap";
import { createWorldMapView, setWorldMapMissingMarkersVisible, setWorldMapTargetCountry, updateWorldMapView } from "../dom/renderWorldMap";

export interface CountryGuessingScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly storage: Storage;
  readonly initialMode: WorldMapGameModeId;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onMultiplayer: () => void;
}

type CountryGuessPlayMode = WorldMapGameModeId;
type CountryGuessTimerMode = "off" | "count-up";

const COUNTRY_GUESS_TIMER_KEYS: Record<CountryGuessPlayMode, { readonly last: string; readonly best: string }> = {
  "name-all": {
    last: "locato:country-guessing:timer-last-ms:v1",
    best: "locato:country-guessing:timer-best-ms:v1",
  },
  "click-country": {
    last: "locato:country-guessing:click-country:timer-last-ms:v1",
    best: "locato:country-guessing:click-country:timer-best-ms:v1",
  },
  "spot-country": {
    last: "locato:country-guessing:spot-country:timer-last-ms:v1",
    best: "locato:country-guessing:spot-country:timer-best-ms:v1",
  },
  puzzle: {
    last: "locato:country-guessing:puzzle:timer-last-ms:v1",
    best: "locato:country-guessing:puzzle:timer-best-ms:v1",
  },
};

function readStoredTime(storage: Storage, key: string): number | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredTime(storage: Storage, key: string, elapsedMs: number): void {
  try {
    storage.setItem(key, String(Math.max(1, Math.round(elapsedMs))));
  } catch {
    // Ignore storage failures so the game still works in private or locked-down browsers.
  }
}

function formatElapsedTime(elapsedMs: number): string {
  const safeElapsedMs = Math.max(0, Math.floor(elapsedMs));
  const totalSeconds = Math.floor(safeElapsedMs / 1000);
  const tenths = Math.floor((safeElapsedMs % 1000) / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function formatStoredTime(elapsedMs: number | null): string {
  return elapsedMs === null ? "—" : formatElapsedTime(elapsedMs);
}

function createLogo(): HTMLElement {
  return el("div", {
    className: "brand-lockup compact",
    children: [el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }), el("span", { className: "brand-name", text: "locato" })],
  });
}

export function createCountryGuessingScreen(options: CountryGuessingScreenOptions): Screen {
  const controller = new AbortController();
  const guessedCountryIds = new Set<CountryId>();
  const { countryIndex } = options;
  let playMode: CountryGuessPlayMode = options.initialMode;
  let showMissingCountries = false;
  let timerMode: CountryGuessTimerMode = "off";
  let timerStartedAt: number | null = null;
  let timerElapsedMs = 0;
  let timerIntervalId: number | null = null;
  let lastTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_KEYS[playMode].last);
  let bestTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_KEYS[playMode].best);
  let targetCountryId: CountryId | null = null;
  let lastFocusedSpotTargetId: CountryId | null = null;
  let spotFocusTimeoutId: number | null = null;
  let puzzleContinent: Continent = "Africa";
  let puzzlePlacedCount = 0;
  let puzzleTotalCount = countryIndex.countries.filter((country) => country.continent === puzzleContinent).length;
  let puzzleAccuracyPercent: number | null = null;
  let puzzleChecked = false;

  function complete(): boolean {
    if (playMode === "puzzle") return puzzleTotalCount > 0 && puzzlePlacedCount >= puzzleTotalCount;
    return guessedCountryIds.size >= countryIndex.countries.length;
  }

  function chooseNextTargetCountryId(): CountryId | null {
    const remainingCountries = countryIndex.countries.filter((country) => !guessedCountryIds.has(country.id));
    if (remainingCountries.length === 0) return null;
    return remainingCountries[Math.floor(Math.random() * remainingCountries.length)]!.id;
  }

  function setNextTargetCountry(): void {
    targetCountryId = chooseNextTargetCountryId();
  }

  function clearSpotFocusTimeout(): void {
    if (spotFocusTimeoutId !== null) {
      window.clearTimeout(spotFocusTimeoutId);
      spotFocusTimeoutId = null;
    }
  }

  function focusSpotTargetIfNeeded(force = false): void {
    if (playMode !== "spot-country" || complete() || targetCountryId === null) return;
    if (!force && lastFocusedSpotTargetId === targetCountryId) return;

    lastFocusedSpotTargetId = targetCountryId;
    map.focusCountry(targetCountryId);
  }

  function getTargetCountry(): Country | null {
    return targetCountryId === null ? null : countryIndex.byId[targetCountryId] ?? null;
  }

  function currentElapsedMs(): number {
    return timerStartedAt === null ? timerElapsedMs : Date.now() - timerStartedAt;
  }

  function renderTimer(): void {
    timerModeSelect.value = timerMode;
    statsPanel.classList.toggle("timer-is-active", timerMode === "count-up");
    timerElapsed.textContent = timerMode === "count-up" ? formatElapsedTime(currentElapsedMs()) : "—";
    timerLast.textContent = formatStoredTime(lastTimerMs);
    timerBest.textContent = formatStoredTime(bestTimerMs);
  }

  function clearTimerInterval(): void {
    if (timerIntervalId !== null) {
      window.clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  function startTimerIfNeeded(): void {
    if (timerMode !== "count-up" || timerStartedAt !== null || complete()) return;

    timerStartedAt = Date.now() - timerElapsedMs;
    timerIntervalId = window.setInterval(renderTimer, 100);
    renderTimer();
  }

  function stopTimer(): number {
    timerElapsedMs = currentElapsedMs();
    timerStartedAt = null;
    clearTimerInterval();
    renderTimer();
    return timerElapsedMs;
  }

  function resetTimer(): void {
    timerStartedAt = null;
    timerElapsedMs = 0;
    clearTimerInterval();
    renderTimer();
  }

  function updateStoredTimerTimesForCurrentMode(finalTimeMs: number): boolean {
    const keys = COUNTRY_GUESS_TIMER_KEYS[playMode];
    lastTimerMs = finalTimeMs;
    writeStoredTime(options.storage, keys.last, finalTimeMs);
    const isNewBest = bestTimerMs === null || finalTimeMs < bestTimerMs;
    if (isNewBest) {
      bestTimerMs = finalTimeMs;
      writeStoredTime(options.storage, keys.best, finalTimeMs);
    }
    return isNewBest;
  }

  function renderTargetPrompt(): void {
    const finished = complete();
    const targetCountry = getTargetCountry();
    clickPrompt.hidden = playMode !== "click-country";
    spotPrompt.hidden = playMode !== "spot-country";
    puzzlePrompt.hidden = playMode !== "puzzle";
    targetCountryName.textContent = finished ? "Complete" : targetCountry?.name ?? "—";
  }

  function render(): void {
    updateWorldMapView(map, guessedCountryIds, countryIndex.countries.length);
    const finished = complete();
    const targetActive = (playMode === "click-country" || playMode === "spot-country") && !finished;
    setWorldMapTargetCountry(map, playMode === "spot-country" && targetCountryId !== null && targetActive ? targetCountryId : null);
    updateAtlasView(atlas, countryIndex.countries, guessedCountryIds);
    const namingModeActive = playMode === "name-all";
    const spotCountryModeActive = playMode === "spot-country";
    const puzzleModeActive = playMode === "puzzle";
    map.element.hidden = puzzleModeActive;
    puzzle.element.hidden = !puzzleModeActive;
    panelHeading.textContent = puzzleModeActive
      ? "Puzzle the continent"
      : namingModeActive
        ? "Name every country"
        : spotCountryModeActive
          ? "Name the highlighted country"
          : "Click the country";
    const typingModeActive = namingModeActive || spotCountryModeActive;
    form.hidden = !typingModeActive;
    input.disabled = finished || !typingModeActive;
    submitButton.disabled = finished || !typingModeActive;
    foundLabel.textContent = puzzleModeActive ? "Placed" : "Found";
    foundCount.textContent = String(puzzleModeActive ? puzzlePlacedCount : guessedCountryIds.size);
    remainingCount.textContent = String(puzzleModeActive ? Math.max(0, puzzleTotalCount - puzzlePlacedCount) : Math.max(0, countryIndex.countries.length - guessedCountryIds.size));
    showMissingButton.hidden = puzzleModeActive;
    checkPuzzleButton.hidden = !puzzleModeActive;
    checkPuzzleButton.disabled = !puzzleModeActive || !finished;
    checkPuzzleButton.textContent = puzzleAccuracyPercent === null ? "Check accuracy" : `Accuracy ${puzzleAccuracyPercent}%`;
    showMissingButton.textContent = showMissingCountries ? "Hide missing" : "Show missing";
    showMissingButton.setAttribute("aria-pressed", String(showMissingCountries));
    setWorldMapMissingMarkersVisible(map, showMissingCountries && !puzzleModeActive);
    map.element.classList.toggle("is-click-country-mode", playMode === "click-country" && !finished);
    renderTargetPrompt();
    renderTimer();
    focusSpotTargetIfNeeded();
  }

  function resetGame(feedbackMessage: string): void {
    clearSpotFocusTimeout();
    lastFocusedSpotTargetId = null;
    setAtlasOpen(atlas, false);
    guessedCountryIds.clear();
    input.value = "";
    lastCountryName.textContent = "None";
    puzzleAccuracyPercent = null;
    puzzleChecked = false;
    targetCountryId = playMode === "click-country" || playMode === "spot-country" ? chooseNextTargetCountryId() : null;
    if (playMode === "puzzle") {
      puzzle.reset();
      const initialPuzzleState = puzzle.getState();
      puzzlePlacedCount = initialPuzzleState.placedCount;
      puzzleTotalCount = initialPuzzleState.totalCount;
    }
    resetTimer();
    render();
    showFeedback(feedback, feedbackMessage, "neutral");
    if (playMode === "name-all" || playMode === "spot-country") input.focus();
  }

  function recordGuess(country: Country): void {
    startTimerIfNeeded();
    guessedCountryIds.add(country.id);
    lastCountryName.textContent = country.name;

    if (playMode === "spot-country") {
      targetCountryId = null;
      lastFocusedSpotTargetId = null;
      render();
      input.value = "";
      map.resetView();

      if (complete()) {
        if (timerMode === "count-up") {
          const finalTimeMs = stopTimer();
          const isNewBest = updateStoredTimerTimesForCurrentMode(finalTimeMs);
          renderTimer();
          showFeedback(
            feedback,
            `World complete. All ${countryIndex.countries.length} countries found in ${formatElapsedTime(finalTimeMs)}${isNewBest ? " — new best time." : "."}`,
            "good",
          );
          return;
        }

        showFeedback(feedback, `World complete. All ${countryIndex.countries.length} countries found.`, "good");
        return;
      }

      showFeedback(feedback, `${country.name} found.`, "good");
      clearSpotFocusTimeout();
      spotFocusTimeoutId = window.setTimeout(() => {
        spotFocusTimeoutId = null;
        setNextTargetCountry();
        render();
      }, 520);
      return;
    }

    if (playMode === "click-country" && !complete()) setNextTargetCountry();
    render();
    input.value = "";

    if (complete()) {
      if (timerMode === "count-up") {
        const finalTimeMs = stopTimer();
        const isNewBest = updateStoredTimerTimesForCurrentMode(finalTimeMs);
        renderTimer();
        showFeedback(
          feedback,
          `World complete. All ${countryIndex.countries.length} countries found in ${formatElapsedTime(finalTimeMs)}${isNewBest ? " — new best time." : "."}`,
          "good",
        );
        return;
      }

      showFeedback(feedback, `World complete. All ${countryIndex.countries.length} countries found.`, "good");
      return;
    }

    if (playMode === "click-country") {
      const nextCountry = getTargetCountry();
      showFeedback(feedback, `${country.name} found.${nextCountry ? ` Next: ${nextCountry.name}.` : ""}`, "good");
      return;
    }

    showFeedback(feedback, `${country.name} found.`, "good");
  }

  function checkSpotCountryInput(showMiss = false): void {
    if (playMode !== "spot-country" || complete()) return;

    const targetCountry = getTargetCountry();
    if (!targetCountry) return;

    const country = showMiss
      ? submitCountryGuess(countryIndex, input.value, guessedCountryIds)
      : detectCountryGuess(countryIndex, input.value, guessedCountryIds);

    if (country?.id === targetCountry.id) {
      recordGuess(country);
      return;
    }

    if (country && country.id !== targetCountry.id) {
      showFeedback(feedback, `That's ${country.name}, not the highlighted country.`, "bad");
      if (showMiss) input.select();
      return;
    }

    if (showMiss && input.value.trim()) {
      showFeedback(feedback, "Not quite. Name the highlighted country.", "neutral");
      input.select();
    }
  }

  function checkInput(showMiss = false): void {
    if (playMode !== "name-all") return;

    const country = showMiss
      ? submitCountryGuess(countryIndex, input.value, guessedCountryIds)
      : detectCountryGuess(countryIndex, input.value, guessedCountryIds);
    if (country) {
      recordGuess(country);
      return;
    }

    if (showMiss && input.value.trim()) {
      showFeedback(feedback, "No new country detected yet.", "neutral");
      input.select();
    }
  }

  function handleCountryClick(countryId: CountryId): void {
    if (playMode !== "click-country" || complete()) return;

    const clickedCountry = countryIndex.byId[countryId];
    const targetCountry = getTargetCountry();
    if (!clickedCountry || !targetCountry) return;

    if (guessedCountryIds.has(countryId)) {
      showFeedback(feedback, `${clickedCountry.name} is already found. Find ${targetCountry.name}.`, "neutral");
      return;
    }

    if (countryId !== targetCountry.id) {
      showFeedback(feedback, `Not ${clickedCountry.name}. Find ${targetCountry.name}.`, "bad");
      return;
    }

    recordGuess(clickedCountry);
  }


  function handlePuzzleProgress(progress: PuzzleMapProgress): void {
    puzzlePlacedCount = progress.placedCount;
    puzzleTotalCount = progress.totalCount;
    puzzleAccuracyPercent = null;
    if (progress.lastCountry) lastCountryName.textContent = progress.lastCountry.name;
    render();
  }

  function handlePuzzleCheck(): void {
    if (playMode !== "puzzle") return;

    const accuracy = puzzle.checkAccuracy();
    puzzlePlacedCount = accuracy.placedCount;
    puzzleTotalCount = accuracy.totalCount;

    if (!accuracy.complete) {
      render();
      showFeedback(feedback, `Place all ${accuracy.totalCount} countries before checking accuracy.`, "neutral");
      return;
    }

    const alreadyChecked = puzzleChecked;
    puzzleChecked = true;
    puzzleAccuracyPercent = accuracy.accuracyPercent;
    const baseMessage = `${puzzleContinent} accuracy: ${accuracy.accuracyPercent}%. ${accuracy.closeCount}/${accuracy.totalCount} countries are very close to the correct spot.`;

    if (timerMode === "count-up" && !alreadyChecked) {
      const finalTimeMs = stopTimer();
      const isNewBest = updateStoredTimerTimesForCurrentMode(finalTimeMs);
      render();
      showFeedback(feedback, `${baseMessage} Time: ${formatElapsedTime(finalTimeMs)}${isNewBest ? " — new best time." : "."}`, accuracy.accuracyPercent >= 75 ? "good" : "neutral");
      return;
    }

    render();
    showFeedback(feedback, baseMessage, accuracy.accuracyPercent >= 75 ? "good" : "neutral");
  }

  function setPlayMode(nextMode: CountryGuessPlayMode): void {
    if (playMode === nextMode) return;
    clearSpotFocusTimeout();
    lastFocusedSpotTargetId = null;
    playMode = nextMode;
    gameModeDropdown.setSelectedMode(nextMode);
    lastTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_KEYS[playMode].last);
    bestTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_KEYS[playMode].best);
    resetGame(
      playMode === "click-country"
        ? "Click mode ready. Click the named country on the map; the timer starts on your first correct country."
        : playMode === "spot-country"
          ? "Spot mode ready. Name each highlighted country; the timer starts on your first correct answer."
          : playMode === "puzzle"
            ? `Puzzle mode ready. Choose a continent, place every cutout, then check your accuracy.`
            : "Name all countries mode ready. Start typing country names to reveal the map.",
    );
  }

  const map = createWorldMapView(options.worldCountryFeatures, countryIndex, { onCountryClick: handleCountryClick });
  const atlas = createAtlasView(countryIndex.countries);
  const feedback = createFeedbackView();
  const input = el("input", {
    attrs: { id: "guess-input", name: "guess", type: "text", autocomplete: "off", autocapitalize: "words", spellcheck: "false", placeholder: "e.g. Brazil, Japan, ZA..." },
  });
  const submitButton = el("button", { className: "primary-action", text: "Lock in", attrs: { type: "submit" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart", attrs: { type: "button" } });
  const timerModeSelect = el("select", {
    className: "country-guess-timer-select",
    attrs: { id: "country-timer-mode", name: "timerMode", "aria-label": "Country guessing timer mode" },
    children: [
      el("option", { text: "Practice", attrs: { value: "off" } }),
      el("option", { text: "Timer", attrs: { value: "count-up" } }),
    ],
  });
  const foundLabel = el("span", { className: "stat-label", text: "Found" });
  const foundCount = el("strong", { className: "stat-value", text: "0" });
  const remainingCount = el("strong", { className: "stat-value", text: String(countryIndex.countries.length) });
  const lastCountryName = el("strong", { className: "stat-value", text: "None" });
  const timerElapsed = el("strong", { className: "stat-value", text: "—" });
  const timerLast = el("strong", { className: "stat-value", text: "—" });
  const timerBest = el("strong", { className: "stat-value", text: "—" });
  const panelHeading = el("h2", { text: "Name every country" });
  const targetCountryName = el("strong", { className: "country-click-target-name", text: "—" });
  const clickPrompt = el("div", {
    className: "country-click-prompt",
    children: [
      el("span", { className: "country-click-target-label", text: "Click this country" }),
      targetCountryName,
      el("p", { text: "Pan, zoom, then click the matching country shape." }),
    ],
  });
  const spotPrompt = el("div", {
    className: "country-click-prompt spot-country-prompt",
    children: [
      el("span", { className: "country-click-target-label", text: "Spot the country" }),
      el("p", { text: "A country flashes on the map. Type its name to reveal it and move on." }),
    ],
  });
  const puzzleContinentSelect = el("select", {
    className: "puzzle-continent-select",
    attrs: { id: "puzzle-continent", name: "puzzleContinent", "aria-label": "Puzzle continent" },
    children: CONTINENTS.map((continent) => el("option", { text: continent, attrs: { value: continent } })),
  });
  puzzleContinentSelect.value = puzzleContinent;
  const puzzlePrompt = el("div", {
    className: "country-click-prompt puzzle-prompt",
    children: [
      el("label", { className: "country-click-target-label", text: "Puzzle continent", attrs: { for: "puzzle-continent" } }),
      puzzleContinentSelect,
      el("p", { text: "Drag every cutout onto the continent. Nothing snaps into place; press Check accuracy when you are done." }),
    ],
  });
  const timerModeCard = el("div", {
    className: "stat-card country-guess-mode-card",
    children: [el("label", { className: "stat-label", text: "Mode", attrs: { for: "country-timer-mode" } }), timerModeSelect],
  });
  const statsPanel = el("div", {
    className: "stats-panel country-guess-stats",
    children: [
      timerModeCard,
      el("div", { className: "stat-card", children: [foundLabel, foundCount] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Remaining" }), remainingCount] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Last" }), lastCountryName] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Time" }), timerElapsed] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Previous" }), timerLast] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Best" }), timerBest] }),
    ],
  });
  const showMissingButton = el("button", { className: "ghost-action", text: "Show missing", attrs: { type: "button", "aria-pressed": "false" } });
  const checkPuzzleButton = el("button", { className: "primary-action puzzle-check-button", text: "Check accuracy", attrs: { type: "button" } });
  const multiplayerButton = el("button", { className: "ghost-action", text: "Multiplayer", attrs: { type: "button" } });
  const gameModeDropdown = createGameModeDropdown({
    selectedMode: playMode,
    signal: controller.signal,
    onChange: (gameMode) => {
      if (isWorldMapGameModeId(gameMode)) {
        setPlayMode(gameMode);
        return;
      }
      options.onGameModeChange(gameMode);
    },
  });
  const puzzle = createPuzzleMapView(options.worldCountryFeatures, countryIndex, puzzleContinent, {
    signal: controller.signal,
    onFirstPlacement: startTimerIfNeeded,
    onProgress: (progress) => {
      handlePuzzleProgress(progress);
      if (playMode === "puzzle" && progress.lastCountry) {
        showFeedback(feedback, progress.complete ? "All pieces are on the board. Press Check accuracy when you are ready." : `${progress.lastCountry.name} placed.`, "good");
      }
    },
  });
  const initialPuzzleState = puzzle.getState();
  puzzlePlacedCount = initialPuzzleState.placedCount;
  puzzleTotalCount = initialPuzzleState.totalCount;
  targetCountryId = playMode === "click-country" || playMode === "spot-country" ? chooseNextTargetCountryId() : null;

  const form = el("form", {
    className: "guess-form country-guess-form",
    children: [el("label", { text: "Your guess", attrs: { for: "guess-input" } }), el("div", { className: "input-row", children: [input, submitButton] })],
  });

  input.addEventListener(
    "input",
    () => {
      if (playMode === "name-all") checkInput();
      else if (playMode === "spot-country") checkSpotCountryInput();
    },
    { signal: controller.signal },
  );
  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      if (playMode === "name-all") checkInput(true);
      else if (playMode === "spot-country") checkSpotCountryInput(true);
    },
    { signal: controller.signal },
  );
  showMissingButton.addEventListener(
    "click",
    () => {
      showMissingCountries = !showMissingCountries;
      render();
    },
    { signal: controller.signal },
  );
  checkPuzzleButton.addEventListener("click", handlePuzzleCheck, { signal: controller.signal });

  puzzleContinentSelect.addEventListener(
    "change",
    () => {
      const nextContinent = CONTINENTS.find((continent) => continent === puzzleContinentSelect.value) ?? "Africa";
      puzzleContinent = nextContinent;
      puzzle.setContinent(puzzleContinent);
      handlePuzzleProgress(puzzle.getState());
      resetTimer();
      render();
      puzzleAccuracyPercent = null;
      puzzleChecked = false;
      showFeedback(feedback, `${puzzleContinent} puzzle loaded. Place every country cutout, then check your accuracy.`, "neutral");
    },
    { signal: controller.signal },
  );
  timerModeSelect.addEventListener(
    "change",
    () => {
      timerMode = timerModeSelect.value === "count-up" ? "count-up" : "off";
      resetGame(timerMode === "count-up" ? "Timer mode ready. The clock starts on your first correct country." : "Practice mode ready.");
    },
    { signal: controller.signal },
  );
  resetButton.addEventListener(
    "click",
    () => {
      resetGame(
        timerMode === "count-up"
          ? "Timer reset. Start with your first correct move."
          : playMode === "click-country"
            ? "Fresh click challenge ready."
            : playMode === "spot-country"
              ? "Fresh spot challenge ready."
              : playMode === "puzzle"
                ? `Fresh ${puzzleContinent} puzzle ready.`
                : "Fresh world map ready.",
      );
    },
    { signal: controller.signal },
  );
  multiplayerButton.addEventListener("click", options.onMultiplayer, { signal: controller.signal });
  atlas.openButton.addEventListener("click", () => setAtlasOpen(atlas, true), { signal: controller.signal });
  atlas.closeButton.addEventListener("click", () => setAtlasOpen(atlas, false), { signal: controller.signal });
  atlas.overlay.addEventListener("click", () => setAtlasOpen(atlas, false), { signal: controller.signal });

  const element = el("section", {
    className: "game-screen country-guess-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("div", { className: "game-header-left", children: [createLogo(), gameModeDropdown.element] }),
          el("div", { className: "game-header-actions", children: [multiplayerButton] }),
        ],
      }),
      el("div", {
        className: "country-guess-layout",
        children: [
          map.element,
          puzzle.element,
          el("aside", {
            className: "answer-panel country-guess-panel",
            children: [
              el("div", { className: "panel-title", children: [panelHeading] }),
              clickPrompt,
              spotPrompt,
              puzzlePrompt,
              form,
              statsPanel,
              feedback.element,
              el("div", { className: "actions", children: [showMissingButton, checkPuzzleButton, resetButton, atlas.element] }),
            ],
          }),
        ],
      }),
    ],
  });

  render();
  showFeedback(
    feedback,
    playMode === "click-country"
      ? "Click mode ready. Click the named country on the map."
      : playMode === "spot-country"
        ? "Spot mode ready. Name the highlighted country."
        : playMode === "puzzle"
          ? `${puzzleContinent} puzzle ready. Place every country cutout, then check your accuracy.`
          : "Start typing country names. Matches highlight instantly on the map.",
    "neutral",
  );
  if (playMode === "name-all" || playMode === "spot-country") queueMicrotask(() => input.focus());

  return {
    element,
    destroy: () => {
      clearTimerInterval();
      clearSpotFocusTimeout();
      puzzle.destroy();
      controller.abort();
    },
  };
}
