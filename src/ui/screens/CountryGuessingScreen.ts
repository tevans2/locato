import { CONTINENTS, type Continent, type Country, type CountryId, type CountryIndex } from "../../core/countries";
import { detectCountryGuess, submitCountryGuess, type WorldCountryFeature } from "../../core/map";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createAtlasView, setAtlasOpen, updateAtlasView } from "../dom/renderAtlas";
import { createFeedbackView, showFeedback } from "../dom/renderFeedback";
import { createPuzzleMapView, type PuzzleMapProgress } from "../dom/renderPuzzleMap";
import { createWorldMapView, setWorldMapMissingMarkersVisible, updateWorldMapView } from "../dom/renderWorldMap";

export interface WorldMapRunResult {
  readonly playMode: "name-all" | "click-country" | "puzzle";
  readonly timed: boolean;
  readonly completed: boolean;
  readonly durationMs: number;
  readonly countriesFound: number;
  readonly countriesTotal: number;
}

export interface CountryGuessingScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly storage: Storage;
  readonly onBackToSolo: () => void;
  readonly onMultiplayer: () => void;
  // Called once per world-map run when it ends (completion, restart, mode change, or leaving).
  readonly onRecordGame?: (result: WorldMapRunResult) => void;
}

type CountryGuessPlayMode = "name-all" | "click-country" | "puzzle";
type CountryGuessTimerMode = "off" | "count-up";

interface WorldMapModeOption {
  readonly id: CountryGuessPlayMode;
  readonly label: string;
  readonly description: string;
}

interface WorldMapModeDropdown {
  readonly element: HTMLElement;
  readonly setSelectedMode: (mode: CountryGuessPlayMode) => void;
}

const WORLD_MAP_MODE_OPTIONS: readonly WorldMapModeOption[] = [
  {
    id: "name-all",
    label: "Name all countries",
    description: "Type as many country names as you can and reveal the whole world map.",
  },
  {
    id: "click-country",
    label: "Click on the country",
    description: "A random country name appears; click the matching country on the map.",
  },
  {
    id: "puzzle",
    label: "Puzzle",
    description: "Choose a continent, then drag country cutouts into the matching outline.",
  },
];

const COUNTRY_GUESS_TIMER_KEYS: Record<CountryGuessPlayMode, { readonly last: string; readonly best: string }> = {
  "name-all": {
    last: "locato:country-guessing:timer-last-ms:v1",
    best: "locato:country-guessing:timer-best-ms:v1",
  },
  "click-country": {
    last: "locato:country-guessing:click-country:timer-last-ms:v1",
    best: "locato:country-guessing:click-country:timer-best-ms:v1",
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

function modeOption(mode: CountryGuessPlayMode): WorldMapModeOption {
  return WORLD_MAP_MODE_OPTIONS.find((option) => option.id === mode) ?? WORLD_MAP_MODE_OPTIONS[0]!;
}

function createWorldMapModeDropdown(options: {
  readonly selectedMode: CountryGuessPlayMode;
  readonly signal: AbortSignal;
  readonly onChange: (mode: CountryGuessPlayMode) => void;
}): WorldMapModeDropdown {
  let selectedMode = options.selectedMode;
  const selectedText = el("span", { className: "category-dropdown-selected" });

  const modeControls = WORLD_MAP_MODE_OPTIONS.map((option) => {
    const radio = el("input", { attrs: { type: "radio", name: "world-map-mode", value: option.id } });
    radio.checked = option.id === selectedMode;
    const label = el("label", {
      className: "category-option world-map-mode-option",
      attrs: { title: option.description },
      children: [radio, el("span", { text: option.label })],
    });
    return { option, radio, label };
  });

  function setSelectedMode(mode: CountryGuessPlayMode): void {
    selectedMode = mode;
    selectedText.textContent = modeOption(selectedMode).label;
    for (const control of modeControls) control.radio.checked = control.option.id === selectedMode;
  }

  for (const control of modeControls) {
    control.radio.addEventListener(
      "change",
      () => {
        if (!control.radio.checked) return;
        setSelectedMode(control.option.id);
        options.onChange(control.option.id);
      },
      { signal: options.signal },
    );
  }

  const element = el("details", {
    className: "category-dropdown country-guess-category-dropdown",
    children: [
      el("summary", {
        className: "category-dropdown-summary",
        children: [el("span", { className: "category-row-label", text: "Mode" }), selectedText],
      }),
      el("div", { className: "category-dropdown-menu", attrs: { role: "radiogroup", "aria-label": "World map modes" }, children: modeControls.map((control) => control.label) }),
    ],
  });
  setSelectedMode(selectedMode);

  return { element, setSelectedMode };
}

export function createCountryGuessingScreen(options: CountryGuessingScreenOptions): Screen {
  const controller = new AbortController();
  const guessedCountryIds = new Set<CountryId>();
  const { countryIndex } = options;
  let playMode: CountryGuessPlayMode = "name-all";
  let showMissingCountries = false;
  let timerMode: CountryGuessTimerMode = "off";
  let timerStartedAt: number | null = null;
  let timerElapsedMs = 0;
  let timerIntervalId: number | null = null;
  let lastTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_KEYS[playMode].last);
  let bestTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_KEYS[playMode].best);
  let targetCountryId: CountryId | null = null;
  let puzzleContinent: Continent = "Africa";
  let puzzlePlacedCount = 0;
  let puzzleTotalCount = countryIndex.countries.filter((country) => country.continent === puzzleContinent).length;
  // A run = from a fresh start until it ends (completion, restart, mode/continent change, or leaving).
  // Recorded at most once; reset to false whenever a new run begins.
  let currentRunRecorded = false;
  function complete(): boolean {
    if (playMode === "puzzle") return puzzleTotalCount > 0 && puzzlePlacedCount >= puzzleTotalCount;
    return guessedCountryIds.size >= countryIndex.countries.length;
  }
  function recordCurrentRun(completed: boolean): void {
    const countriesFound = playMode === "puzzle" ? puzzlePlacedCount : guessedCountryIds.size;
    if (countriesFound === 0 || currentRunRecorded) return;
    currentRunRecorded = true;
    const countriesTotal = playMode === "puzzle" ? puzzleTotalCount : countryIndex.countries.length;
    const timed = timerMode === "count-up";
    options.onRecordGame?.({ playMode, timed, completed, durationMs: timed ? Math.round(currentElapsedMs()) : 0, countriesFound, countriesTotal });
  }

  function chooseNextTargetCountryId(): CountryId | null {
    const remainingCountries = countryIndex.countries.filter((country) => !guessedCountryIds.has(country.id));
    if (remainingCountries.length === 0) return null;
    return remainingCountries[Math.floor(Math.random() * remainingCountries.length)]!.id;
  }

  function setNextTargetCountry(): void {
    targetCountryId = chooseNextTargetCountryId();
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
    puzzlePrompt.hidden = playMode !== "puzzle";
    targetCountryName.textContent = finished ? "Complete" : targetCountry?.name ?? "—";
  }

  function render(): void {
    updateWorldMapView(map, guessedCountryIds, countryIndex.countries.length);
    updateAtlasView(atlas, countryIndex.countries, guessedCountryIds);
    const finished = complete();
    const namingModeActive = playMode === "name-all";
    const puzzleModeActive = playMode === "puzzle";
    map.element.hidden = puzzleModeActive;
    puzzle.element.hidden = !puzzleModeActive;
    panelHeading.textContent = puzzleModeActive ? "Puzzle the continent" : namingModeActive ? "Name every country" : "Click the country";
    form.hidden = !namingModeActive;
    input.disabled = finished || !namingModeActive;
    submitButton.disabled = finished || !namingModeActive;
    foundLabel.textContent = puzzleModeActive ? "Placed" : "Found";
    foundCount.textContent = String(puzzleModeActive ? puzzlePlacedCount : guessedCountryIds.size);
    remainingCount.textContent = String(puzzleModeActive ? Math.max(0, puzzleTotalCount - puzzlePlacedCount) : Math.max(0, countryIndex.countries.length - guessedCountryIds.size));
    showMissingButton.hidden = puzzleModeActive;
    showMissingButton.textContent = showMissingCountries ? "Hide missing" : "Show missing";
    showMissingButton.setAttribute("aria-pressed", String(showMissingCountries));
    setWorldMapMissingMarkersVisible(map, showMissingCountries && !puzzleModeActive);
    map.element.classList.toggle("is-click-country-mode", playMode === "click-country" && !finished);
    renderTargetPrompt();
    renderTimer();
  }

  function resetGame(feedbackMessage: string): void {
    recordCurrentRun(false); // record the run being abandoned before clearing it
    setAtlasOpen(atlas, false);
    guessedCountryIds.clear();
    currentRunRecorded = false; // a fresh run starts
    input.value = "";
    lastCountryName.textContent = "None";
    targetCountryId = playMode === "click-country" ? chooseNextTargetCountryId() : null;
    if (playMode === "puzzle") {
      puzzle.reset();
      const initialPuzzleState = puzzle.getState();
  puzzlePlacedCount = initialPuzzleState.placedCount;
  puzzleTotalCount = initialPuzzleState.totalCount;
    }
    resetTimer();
    render();
    showFeedback(feedback, feedbackMessage, "neutral");
    if (playMode === "name-all") input.focus();
  }

  function recordGuess(country: Country): void {
    startTimerIfNeeded();
    guessedCountryIds.add(country.id);
    lastCountryName.textContent = country.name;
    if (playMode === "click-country" && !complete()) setNextTargetCountry();
    render();
    input.value = "";

    if (complete()) {
      if (timerMode === "count-up") {
        const finalTimeMs = stopTimer();
        const isNewBest = updateStoredTimerTimesForCurrentMode(finalTimeMs);
        renderTimer();
        recordCurrentRun(true);
        showFeedback(
          feedback,
          `World complete. All ${countryIndex.countries.length} countries found in ${formatElapsedTime(finalTimeMs)}${isNewBest ? " — new best time." : "."}`,
          "good",
        );
        return;
      }
      recordCurrentRun(true);
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
    if (progress.lastCountry) lastCountryName.textContent = progress.lastCountry.name;
    render();
  }

  function handlePuzzleComplete(progress: PuzzleMapProgress): void {
    handlePuzzleProgress(progress);

    if (timerMode === "count-up") {
      const finalTimeMs = stopTimer();
      const isNewBest = updateStoredTimerTimesForCurrentMode(finalTimeMs);
      renderTimer();
      recordCurrentRun(true);
      showFeedback(
        feedback,
        `${puzzleContinent} complete. All ${progress.totalCount} countries placed in ${formatElapsedTime(finalTimeMs)}${isNewBest ? " — new best time." : "."}`,
        "good",
      );
      return;
    }
    recordCurrentRun(true);
    showFeedback(feedback, `${puzzleContinent} complete. All ${progress.totalCount} countries snapped into place.`, "good");
  }

  function setPlayMode(nextMode: CountryGuessPlayMode): void {
    if (playMode === nextMode) return;
    playMode = nextMode;
    modeDropdown.setSelectedMode(nextMode);
    lastTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_KEYS[playMode].last);
    bestTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_KEYS[playMode].best);
    resetGame(
      playMode === "click-country"
        ? "Click mode ready. Click the named country on the map; the timer starts on your first correct country."
        : playMode === "puzzle"
          ? `Puzzle mode ready. Choose a continent, then drag each cutout into ${puzzleContinent}.`
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
      el("p", { text: "Drag country cutouts from the tray into the continent outline. Close drops snap into place." }),
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
  const soloButton = el("button", { className: "ghost-action", text: "Prompt game", attrs: { type: "button" } });
  const multiplayerButton = el("button", { className: "ghost-action", text: "Multiplayer", attrs: { type: "button" } });
  const modeDropdown = createWorldMapModeDropdown({ selectedMode: playMode, signal: controller.signal, onChange: setPlayMode });
  const puzzle = createPuzzleMapView(options.worldCountryFeatures, countryIndex, puzzleContinent, {
    signal: controller.signal,
    onFirstPlacement: startTimerIfNeeded,
    onProgress: (progress) => {
      handlePuzzleProgress(progress);
      if (playMode === "puzzle" && progress.lastCountry && !progress.complete) showFeedback(feedback, `${progress.lastCountry.name} snapped into place.`, "good");
    },
    onComplete: handlePuzzleComplete,
  });
  const initialPuzzleState = puzzle.getState();
  puzzlePlacedCount = initialPuzzleState.placedCount;
  puzzleTotalCount = initialPuzzleState.totalCount;

  const form = el("form", {
    className: "guess-form country-guess-form",
    children: [el("label", { text: "Your guess", attrs: { for: "guess-input" } }), el("div", { className: "input-row", children: [input, submitButton] })],
  });

  input.addEventListener("input", () => checkInput(), { signal: controller.signal });
  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      checkInput(true);
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

  puzzleContinentSelect.addEventListener(
    "change",
    () => {
      recordCurrentRun(false); // abandoning the current continent's puzzle
      const nextContinent = CONTINENTS.find((continent) => continent === puzzleContinentSelect.value) ?? "Africa";
      puzzleContinent = nextContinent;
      puzzle.setContinent(puzzleContinent);
      handlePuzzleProgress(puzzle.getState());
      resetTimer();
      currentRunRecorded = false; // a fresh puzzle run starts
      render();
      showFeedback(feedback, `${puzzleContinent} puzzle loaded. Drag each country cutout into its outline.`, "neutral");
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
            : playMode === "puzzle"
              ? `Fresh ${puzzleContinent} puzzle ready.`
              : "Fresh world map ready.",
      );
    },
    { signal: controller.signal },
  );
  soloButton.addEventListener("click", options.onBackToSolo, { signal: controller.signal });
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
          createLogo(),
          el("div", {
            className: "mode-controls",
            children: [el("div", { className: "mode-select-row", children: [modeDropdown.element, soloButton, multiplayerButton] })],
          }),
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
              puzzlePrompt,
              form,
              statsPanel,
              feedback.element,
              el("div", { className: "actions", children: [showMissingButton, resetButton, atlas.element] }),
            ],
          }),
        ],
      }),
    ],
  });

  render();
  showFeedback(feedback, "Start typing country names. Matches highlight instantly on the map.", "neutral");
  queueMicrotask(() => input.focus());

  return {
    element,
    destroy: () => {
      recordCurrentRun(false); // leaving the screen ends the run; record progress so it isn't lost
      clearTimerInterval();
      puzzle.destroy();
      controller.abort();
    },
  };
}
