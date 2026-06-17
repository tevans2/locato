import type { AuthUser } from "../../core/auth";
import { CONTINENTS, type Continent, type Country, type CountryId, type CountryIndex } from "../../core/countries";
import { isWorldMapGameModeId, type GameModeId, type WorldMapGameModeId } from "../../core/gameModes";
import { detectCountryGuess, submitCountryGuess, type WorldCountryFeature } from "../../core/map";
import { timerKeysForMode } from "../../core/timer/keys";
import { formatTimerCompletionSuffix, submitTimerToLeaderboard } from "../../core/timer/leaderboardSync";
import { createPlayTimer, formatElapsedTime, formatStoredTime, type PlayTimer, type PlayTimerMode } from "../../core/timer/playTimer";
import { recordWorldAchievements, type Achievement } from "../../storage/achievements";
import type { Screen } from "../../app/router";
import type { AuthControls } from "../components/AuthPanel";
import { el } from "../dom/createElement";
import { createGameModeDropdown } from "../dom/gameModeDropdown";
import { createAtlasView, setAtlasOpen, updateAtlasView } from "../dom/renderAtlas";
import { createFeedbackView, showFeedback } from "../dom/renderFeedback";
import { createGlobeMapView } from "../dom/renderGlobeMap";
import { createPuzzleMapView, type PuzzleMapProgress } from "../dom/renderPuzzleMap";
import { createWorldMapView, setWorldMapMissingMarkersVisible, setWorldMapReviewCountries, setWorldMapTargetCountry, updateWorldMapView } from "../dom/renderWorldMap";
import { bindKeyboardAwareInput, dismissKeyboardIfTouchInput, shouldAutoFocusTextInput } from "../dom/mobileKeyboard";
import { createMobileMenu } from "../dom/mobileMenu";

export interface WorldMapRunResult {
  readonly playMode: WorldMapGameModeId;
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
  readonly initialMode: WorldMapGameModeId;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onMultiplayer: () => void;
  readonly onDailyChallenge: () => void;
  // Called once per world-map run when it ends (completion, restart, mode change, or leaving).
  readonly onRecordGame?: (result: WorldMapRunResult) => void;
  readonly onLeaderboard: () => void;
  readonly getAuthUser: () => AuthUser | null;
  readonly onViewStats?: () => void;
  readonly onViewFriends?: () => void;
  readonly authControls?: AuthControls;
}

type CountryGuessPlayMode = WorldMapGameModeId;
type MapSurface = "flat" | "globe";


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
  let targetCountryId: CountryId | null = null;
  let lastFocusedSpotTargetId: CountryId | null = null;
  let spotFocusTimeoutId: number | null = null;
  let puzzleContinent: Continent = "Africa";
  let puzzlePlacedCount = 0;
  let puzzleTotalCount = countryIndex.countries.filter((country) => country.continent === puzzleContinent).length;
  let reviewCountryIds: readonly CountryId[] = [];
  let activeReviewCountryId: CountryId | null = null;
  let reviewTitle = "Missed countries";
  let runGivenUp = false;
  let mapSurface: MapSurface = "flat";
  // A run = from a fresh start until it ends (completion, restart, mode/continent change, or leaving).
  // Recorded at most once; reset to false whenever a new run begins.
  let currentRunRecorded = false;
  let puzzleAccuracyPercent: number | null = null;
  let puzzleChecked = false;
  function complete(): boolean {
    if (playMode === "puzzle") return puzzleTotalCount > 0 && puzzlePlacedCount >= puzzleTotalCount;
    return guessedCountryIds.size >= countryIndex.countries.length;
  }

  function roundEnded(): boolean {
    return runGivenUp || complete();
  }
  function recordCurrentRun(completed: boolean): void {
    const countriesFound = playMode === "puzzle" ? puzzlePlacedCount : guessedCountryIds.size;
    if (countriesFound === 0 || currentRunRecorded) return;
    currentRunRecorded = true;
    const countriesTotal = playMode === "puzzle" ? puzzleTotalCount : countryIndex.countries.length;
    const timed = playTimer.mode === "count-up";
    options.onRecordGame?.({ playMode, timed, completed, durationMs: timed ? Math.round(playTimer.currentElapsedMs()) : 0, countriesFound, countriesTotal });
  }

  function missedCountryIdsForCurrentRun(): readonly CountryId[] {
    if (playMode === "puzzle") return [];
    return countryIndex.countries
      .filter((country) => !guessedCountryIds.has(country.id))
      .sort((left, right) => left.continent.localeCompare(right.continent) || left.name.localeCompare(right.name))
      .map((country) => country.id);
  }

  function captureReviewForCurrentRun(label = "previous run", force = false): void {
    if (playMode === "puzzle" || complete()) return;
    if (!force && guessedCountryIds.size === 0) return;
    reviewCountryIds = missedCountryIdsForCurrentRun();
    activeReviewCountryId = reviewCountryIds[0] ?? null;
    reviewTitle = `${reviewCountryIds.length} missed in ${label}`;
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
    if (playMode !== "spot-country" || roundEnded() || targetCountryId === null) return;
    if (!force && lastFocusedSpotTargetId === targetCountryId) return;

    lastFocusedSpotTargetId = targetCountryId;
    map.focusCountry(targetCountryId);
  }

  function getTargetCountry(): Country | null {
    return targetCountryId === null ? null : countryIndex.byId[targetCountryId] ?? null;
  }

  let playTimer: PlayTimer;

  const achievementPanel = el("section", { className: "achievement-panel compact", attrs: { hidden: "true" } });

  function showAchievements(unlocked: readonly Achievement[]): void {
    if (unlocked.length === 0) return;
    achievementPanel.hidden = false;
    achievementPanel.replaceChildren(
      el("div", { className: "achievement-panel-title", children: [el("span", { className: "eyebrow", text: "Unlocked" }), el("strong", { text: `${unlocked.length} achievement${unlocked.length === 1 ? "" : "s"}` })] }),
      el("div", {
        className: "achievement-list",
        children: unlocked.map((achievement) =>
          el("article", {
            className: "achievement-chip",
            children: [el("strong", { text: achievement.title }), el("span", { text: achievement.description })],
          }),
        ),
      }),
    );
  }

  function renderMapReviewState(): void {
    const activeSet = new Set(reviewCountryIds);
    setWorldMapReviewCountries(map, activeSet, activeReviewCountryId);
    globe.update({
      guessedCountryIds,
      missedCountryIds: activeSet,
      targetCountryId: playMode === "spot-country" && !roundEnded() ? targetCountryId : null,
      clickableCountryIds: runGivenUp ? activeSet : playMode === "click-country" ? null : new Set<CountryId>(),
    });
  }

  function renderTimer(): void {
    timerModeSelect.value = playTimer.mode;
    statsPanel.classList.toggle("timer-is-active", playTimer.mode === "count-up");
    timerElapsed.textContent = playTimer.mode === "count-up" ? formatElapsedTime(playTimer.currentElapsedMs()) : "—";
    timerLast.textContent = formatStoredTime(playTimer.readLast());
    timerBest.textContent = formatStoredTime(playTimer.readBest());
  }

  async function finishTimerRun(finalTimeMs: number): Promise<{ readonly isNewLocalBest: boolean; readonly serverAccepted: boolean | null }> {
    const isNewLocalBest = playTimer.writeCompletion(finalTimeMs);
    const serverAccepted = await submitTimerToLeaderboard({
      gameMode: playMode,
      variant: playMode === "puzzle" ? puzzleContinent : "",
      timeMs: finalTimeMs,
      isLoggedIn: options.getAuthUser() !== null,
    });
    return { isNewLocalBest, serverAccepted };
  }

  function renderTargetPrompt(): void {
    const finished = roundEnded();
    const targetCountry = getTargetCountry();
    clickPrompt.hidden = playMode !== "click-country";
    spotPrompt.hidden = playMode !== "spot-country";
    puzzlePrompt.hidden = playMode !== "puzzle";
    targetCountryName.textContent = runGivenUp ? "Round ended" : finished ? "Complete" : targetCountry?.name ?? "—";
  }

  function render(): void {
    updateWorldMapView(map, guessedCountryIds, countryIndex.countries.length);
    const finished = roundEnded();
    const targetActive = (playMode === "click-country" || playMode === "spot-country") && !finished;
    setWorldMapTargetCountry(map, playMode === "spot-country" && targetCountryId !== null && targetActive ? targetCountryId : null);
    updateAtlasView(atlas, countryIndex.countries, guessedCountryIds);
    const namingModeActive = playMode === "name-all";
    const spotCountryModeActive = playMode === "spot-country";
    const puzzleModeActive = playMode === "puzzle";
    const globeActive = !puzzleModeActive && mapSurface === "globe";
    map.element.hidden = puzzleModeActive || globeActive;
    globe.element.hidden = puzzleModeActive || !globeActive;
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
    mapSurfaceButton.hidden = puzzleModeActive;
    mapSurfaceButton.textContent = mapSurface === "flat" ? "3D globe" : "Flat map";
    mapSurfaceButton.setAttribute("aria-pressed", String(mapSurface === "globe"));
    giveUpButton.hidden = !namingModeActive;
    giveUpButton.disabled = !namingModeActive || finished;
    checkPuzzleButton.hidden = !puzzleModeActive;
    checkPuzzleButton.disabled = !puzzleModeActive || !finished;
    checkPuzzleButton.textContent = puzzleAccuracyPercent === null ? "Check accuracy" : `Accuracy ${puzzleAccuracyPercent}%`;
    showMissingButton.textContent = showMissingCountries ? "Hide missing" : "Show missing";
    showMissingButton.setAttribute("aria-pressed", String(showMissingCountries));
    setWorldMapMissingMarkersVisible(map, showMissingCountries && !puzzleModeActive);
    map.element.classList.toggle("is-click-country-mode", (playMode === "click-country" && !finished) || runGivenUp);
    globe.element.classList.toggle("is-click-country-mode", (playMode === "click-country" && !finished) || runGivenUp);
    renderTargetPrompt();
    renderTimer();
    renderMapReviewState();
    focusSpotTargetIfNeeded();
  }

  function resetGame(feedbackMessage: string, captureReview = true): void {
    if (captureReview && !runGivenUp) captureReviewForCurrentRun();
    recordCurrentRun(false); // record the run being abandoned before clearing it
    clearSpotFocusTimeout();
    lastFocusedSpotTargetId = null;
    setAtlasOpen(atlas, false);
    guessedCountryIds.clear();
    runGivenUp = false;
    showMissingCountries = false;
    reviewCountryIds = [];
    activeReviewCountryId = null;
    map.showCountryLabel(null);
    globe.showCountryLabel(null);
    currentRunRecorded = false; // a fresh run starts
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
    playTimer.reset();
    render();
    showFeedback(feedback, feedbackMessage, "neutral");
    if ((playMode === "name-all" || playMode === "spot-country") && shouldAutoFocusTextInput()) input.focus();
  }

  function recordGuess(country: Country): void {
    playTimer.startIfNeeded();
    guessedCountryIds.add(country.id);
    lastCountryName.textContent = country.name;

    if (playMode === "spot-country") {
      targetCountryId = null;
      lastFocusedSpotTargetId = null;
      render();
      input.value = "";
      map.resetView();

      if (complete()) {
        if (playTimer.mode === "count-up") {
          const finalTimeMs = playTimer.stop();
          recordCurrentRun(true);
          showAchievements(recordWorldAchievements(options.storage, { playMode, completed: true }));
          void finishTimerRun(finalTimeMs).then((result) => {
            showFeedback(
              feedback,
              `World complete. All ${countryIndex.countries.length} countries found in ${formatTimerCompletionSuffix(finalTimeMs, result, options.getAuthUser() !== null)}`,
              "good",
            );
          });
          return;
        }

        recordCurrentRun(true);
        showAchievements(recordWorldAchievements(options.storage, { playMode, completed: true }));
        showFeedback(
          feedback,
          `World complete. All ${countryIndex.countries.length} countries found. Switch to Timer mode to post a time to the leaderboard.`,
          "good",
        );
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
      if (playTimer.mode === "count-up") {
        const finalTimeMs = playTimer.stop();
        recordCurrentRun(true);
        showAchievements(recordWorldAchievements(options.storage, { playMode, completed: true }));
        void finishTimerRun(finalTimeMs).then((result) => {
          showFeedback(
            feedback,
            `World complete. All ${countryIndex.countries.length} countries found in ${formatTimerCompletionSuffix(finalTimeMs, result, options.getAuthUser() !== null)}`,
            "good",
          );
        });
        return;
      }

      recordCurrentRun(true);
      showAchievements(recordWorldAchievements(options.storage, { playMode, completed: true }));
      showFeedback(
        feedback,
        `World complete. All ${countryIndex.countries.length} countries found. Switch to Timer mode to post a time to the leaderboard.`,
        "good",
      );
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
    if (playMode !== "spot-country" || roundEnded()) return;

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
      if (showMiss && shouldAutoFocusTextInput()) input.select();
      return;
    }

    if (showMiss && input.value.trim()) {
      showFeedback(feedback, "Not quite. Name the highlighted country.", "neutral");
      if (shouldAutoFocusTextInput()) input.select();
    }
  }

  function checkInput(showMiss = false): void {
    if (playMode !== "name-all" || roundEnded()) return;

    const country = showMiss
      ? submitCountryGuess(countryIndex, input.value, guessedCountryIds)
      : detectCountryGuess(countryIndex, input.value, guessedCountryIds);
    if (country) {
      recordGuess(country);
      return;
    }

    if (showMiss && input.value.trim()) {
      showFeedback(feedback, "No new country detected yet.", "neutral");
      if (shouldAutoFocusTextInput()) input.select();
    }
  }

  function handleCountryClick(countryId: CountryId): void {
    if (runGivenUp) {
      const clickedCountry = countryIndex.byId[countryId];
      if (!clickedCountry || guessedCountryIds.has(countryId)) return;
      activeReviewCountryId = countryId;
      lastCountryName.textContent = clickedCountry.name;
      map.showCountryLabel(countryId);
      globe.showCountryLabel(countryId);
      render();
      return;
    }

    if (playMode !== "click-country" || roundEnded()) return;

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

  function giveUpNameAllRun(): void {
    if (playMode !== "name-all" || roundEnded()) return;

    captureReviewForCurrentRun("the given-up run", true);
    recordCurrentRun(false);
    if (playTimer.mode === "count-up") playTimer.stop();
    runGivenUp = true;
    showMissingCountries = true;
    dismissKeyboardIfTouchInput(input);
    input.value = "";
    activeReviewCountryId = null;
    render();
    showFeedback(feedback, `Round ended. Click any red country to see its name.`, "neutral");
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
    if (!alreadyChecked) recordCurrentRun(true);
    if (!alreadyChecked) showAchievements(recordWorldAchievements(options.storage, { playMode, completed: true, puzzleContinent, puzzleAccuracyPercent: accuracy.accuracyPercent }));
    const baseMessage = `${puzzleContinent} accuracy: ${accuracy.accuracyPercent}%. ${accuracy.closeCount}/${accuracy.totalCount} countries are very close to the correct spot.`;

    if (playTimer.mode === "count-up" && !alreadyChecked) {
      const finalTimeMs = playTimer.stop();
      void finishTimerRun(finalTimeMs).then((result) => {
        render();
        showFeedback(
          feedback,
          `${baseMessage} Time: ${formatTimerCompletionSuffix(finalTimeMs, result, options.getAuthUser() !== null)}`,
          accuracy.accuracyPercent >= 75 ? "good" : "neutral",
        );
      });
      return;
    }

    render();
    showFeedback(feedback, baseMessage, accuracy.accuracyPercent >= 75 ? "good" : "neutral");
  }

  function setPlayMode(nextMode: CountryGuessPlayMode): void {
    if (playMode === nextMode) return;
    captureReviewForCurrentRun();
    recordCurrentRun(false);
    clearSpotFocusTimeout();
    lastFocusedSpotTargetId = null;
    playMode = nextMode;
    gameModeDropdown.setSelectedMode(nextMode);
    playTimer.destroy();
    playTimer = createPlayTimer({
      storage: options.storage,
      keys: timerKeysForMode(playMode),
      isComplete: roundEnded,
      onTick: renderTimer,
    });
    resetGame(
      playMode === "click-country"
        ? "Click mode ready. Click the named country on the map; the timer starts on your first correct country."
        : playMode === "spot-country"
          ? "Spot mode ready. Name each highlighted country; the timer starts on your first correct answer."
          : playMode === "puzzle"
            ? `Puzzle mode ready. Choose a continent, place every cutout, then check your accuracy.`
            : "Name all countries mode ready. Start typing country names to reveal the map.",
      false,
    );
  }

  const map = createWorldMapView(options.worldCountryFeatures, countryIndex, { onCountryClick: handleCountryClick });
  const globe = createGlobeMapView(options.worldCountryFeatures, countryIndex, { onCountryClick: handleCountryClick });
  const atlas = createAtlasView(countryIndex.countries);
  const feedback = createFeedbackView();
  const input = el("input", {
    attrs: { id: "guess-input", name: "guess", type: "text", autocomplete: "off", autocapitalize: "words", autocorrect: "off", spellcheck: "false", inputmode: "text", enterkeyhint: "done", placeholder: "e.g. Brazil, Japan, ZA..." },
  });
  const submitButton = el("button", { className: "primary-action guess-submit-action", text: "Enter", attrs: { type: "submit", "aria-label": "Enter guess" } });
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
  const mapSurfaceButton = el("button", { className: "ghost-action", text: "3D globe", attrs: { type: "button", "aria-pressed": "false" } });
  const giveUpButton = el("button", { className: "ghost-action", text: "Give up", attrs: { type: "button" } });
  const checkPuzzleButton = el("button", { className: "primary-action puzzle-check-button", text: "Check accuracy", attrs: { type: "button" } });
  const mobileExtrasToggle = el("button", { className: "mobile-extras-toggle", text: "Details", attrs: { type: "button", "aria-expanded": "false" } });
  const mobileExtrasPanel = el("div", { className: "mobile-extras-panel" });
  const dailyButton = el("button", { className: "ghost-action nav-action daily-action", text: "Daily Challenge", attrs: { type: "button", "data-mobile-label": "Daily", "aria-label": "Open daily challenge" } });
  const multiplayerButton = el("button", { className: "ghost-action nav-action", text: "Multiplayer", attrs: { type: "button", "data-mobile-label": "Multi", "aria-label": "Open multiplayer" } });
  const mobileDailyNavButton = el("button", { className: "mobile-nav-item", text: "Daily Challenge", attrs: { type: "button" } });
  const mobileLeaderboardNavButton = el("button", { className: "mobile-nav-item", text: "Leaderboards", attrs: { type: "button" } });
  const mobileMultiplayerNavButton = el("button", { className: "mobile-nav-item", text: "Multiplayer", attrs: { type: "button" } });
  const mobileUserAvatar = el("span", { className: "mobile-nav-user-avatar", text: "?" });
  const mobileUserName = el("span", { className: "mobile-nav-user-name", text: "Guest" });
  const mobileUserSummary = el("div", { className: "mobile-nav-user-summary", children: [mobileUserAvatar, mobileUserName] });
  const mobileStatsNavButton = el("button", { className: "mobile-nav-item", text: "Stats", attrs: { type: "button" } });
  const mobileFriendsNavButton = el("button", { className: "mobile-nav-item", text: "Friends", attrs: { type: "button" } });
  const mobileSignInNavButton = el("button", { className: "mobile-nav-item", text: "Sign in", attrs: { type: "button" } });
  const mobileSignOutNavButton = el("button", { className: "mobile-nav-item", text: "Sign out", attrs: { type: "button" } });
  const mobileMenu = createMobileMenu(
    "Menu",
    [
      { title: "Play", items: [mobileDailyNavButton] },
      { title: "Compete", items: [mobileLeaderboardNavButton, mobileMultiplayerNavButton] },
      { title: "You", items: [mobileUserSummary, mobileStatsNavButton, mobileFriendsNavButton, mobileSignInNavButton, mobileSignOutNavButton] },
    ],
    controller.signal,
  );
  function updateMobileUserMenu(): void {
    const user = options.authControls?.getUser() ?? null;
    const signedIn = user !== null;
    mobileUserSummary.hidden = !signedIn;
    mobileStatsNavButton.hidden = !signedIn || !options.onViewStats;
    mobileFriendsNavButton.hidden = !signedIn || !options.onViewFriends;
    mobileSignOutNavButton.hidden = !signedIn;
    mobileSignInNavButton.hidden = signedIn || !options.authControls;
    if (user) {
      mobileUserAvatar.textContent = user.avatarEmoji ?? user.displayName.charAt(0).toUpperCase();
      mobileUserName.textContent = user.displayName;
    }
  }
  updateMobileUserMenu();
  const leaderboardButton = el("button", { className: "ghost-action nav-action", text: "Leaderboards", attrs: { type: "button", "data-mobile-label": "Ranks", "aria-label": "Open leaderboards" } });
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
  playTimer = createPlayTimer({
    storage: options.storage,
    keys: timerKeysForMode(playMode),
    isComplete: roundEnded,
    onTick: renderTimer,
  });

  const puzzle = createPuzzleMapView(options.worldCountryFeatures, countryIndex, puzzleContinent, {
    signal: controller.signal,
    onFirstPlacement: () => playTimer.startIfNeeded(),
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
      dismissKeyboardIfTouchInput(input);
      showMissingCountries = !showMissingCountries;
      render();
    },
    { signal: controller.signal },
  );
  mapSurfaceButton.addEventListener(
    "click",
    () => {
      dismissKeyboardIfTouchInput(input);
      mapSurface = mapSurface === "flat" ? "globe" : "flat";
      map.showCountryLabel(null);
      globe.showCountryLabel(null);
      render();
    },
    { signal: controller.signal },
  );
  giveUpButton.addEventListener("click", giveUpNameAllRun, { signal: controller.signal });
  checkPuzzleButton.addEventListener("click", handlePuzzleCheck, { signal: controller.signal });

  puzzleContinentSelect.addEventListener(
    "change",
    () => {
      recordCurrentRun(false); // abandoning the current continent's puzzle
      const nextContinent = CONTINENTS.find((continent) => continent === puzzleContinentSelect.value) ?? "Africa";
      puzzleContinent = nextContinent;
      puzzle.setContinent(puzzleContinent);
      handlePuzzleProgress(puzzle.getState());
      playTimer.reset();
      currentRunRecorded = false; // a fresh puzzle run starts
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
      const nextMode: PlayTimerMode = timerModeSelect.value === "count-up" ? "count-up" : "off";
      playTimer.setMode(nextMode);
      resetGame(nextMode === "count-up" ? "Timer mode ready. The clock starts on your first correct country." : "Practice mode ready.");
    },
    { signal: controller.signal },
  );
  resetButton.addEventListener(
    "click",
    () => {
      dismissKeyboardIfTouchInput(input);
      resetGame(
        playTimer.mode === "count-up"
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
  dailyButton.addEventListener("click", options.onDailyChallenge, { signal: controller.signal });
  multiplayerButton.addEventListener("click", options.onMultiplayer, { signal: controller.signal });
  leaderboardButton.addEventListener("click", options.onLeaderboard, { signal: controller.signal });
  mobileDailyNavButton.addEventListener("click", options.onDailyChallenge, { signal: controller.signal });
  mobileMultiplayerNavButton.addEventListener("click", options.onMultiplayer, { signal: controller.signal });
  mobileLeaderboardNavButton.addEventListener("click", options.onLeaderboard, { signal: controller.signal });
  mobileStatsNavButton.addEventListener("click", () => options.onViewStats?.(), { signal: controller.signal });
  mobileFriendsNavButton.addEventListener("click", () => options.onViewFriends?.(), { signal: controller.signal });
  mobileSignInNavButton.addEventListener("click", () => options.authControls?.openPanel(), { signal: controller.signal });
  mobileSignOutNavButton.addEventListener("click", () => void options.authControls?.signOut(), { signal: controller.signal });
  mobileMenu.button.addEventListener("pointerdown", updateMobileUserMenu, { signal: controller.signal });
  mobileMenu.button.addEventListener("click", updateMobileUserMenu, { signal: controller.signal, capture: true });
  atlas.openButton.addEventListener("click", () => setAtlasOpen(atlas, true), { signal: controller.signal });
  atlas.closeButton.addEventListener("click", () => setAtlasOpen(atlas, false), { signal: controller.signal });
  atlas.overlay.addEventListener("click", () => setAtlasOpen(atlas, false), { signal: controller.signal });

  mobileExtrasToggle.addEventListener(
    "click",
    () => {
      const open = mobileExtrasPanel.classList.toggle("is-open");
      mobileExtrasToggle.setAttribute("aria-expanded", String(open));
      mobileExtrasToggle.textContent = open ? "Hide details" : "Details";
    },
    { signal: controller.signal },
  );

  mobileExtrasPanel.replaceChildren(
    statsPanel,
    achievementPanel,
    el("div", { className: "actions", children: [showMissingButton, mapSurfaceButton, giveUpButton, checkPuzzleButton, resetButton, atlas.element] }),
  );


  const element = el("section", {
    className: "game-screen country-guess-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("div", { className: "game-header-left", children: [createLogo(), gameModeDropdown.element] }),
          el("div", { className: "game-header-actions", children: [dailyButton, leaderboardButton, multiplayerButton, mobileMenu.button, mobileMenu.sheet] }),
        ],
      }),
      el("div", {
        className: "country-guess-layout",
        children: [
          map.element,
          globe.element,
          puzzle.element,
          el("aside", {
            className: "answer-panel country-guess-panel",
            children: [
              el("div", { className: "panel-title", children: [panelHeading] }),
              clickPrompt,
              spotPrompt,
              puzzlePrompt,
              form,
              feedback.element,
              mobileExtrasToggle,
              mobileExtrasPanel,
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
  bindKeyboardAwareInput(element, input, controller.signal);
  if ((playMode === "name-all" || playMode === "spot-country") && shouldAutoFocusTextInput()) queueMicrotask(() => input.focus());

  return {
    element,
    destroy: () => {
      recordCurrentRun(false); // leaving the screen ends the run; record progress so it isn't lost
      playTimer.destroy();
      clearSpotFocusTimeout();
      globe.destroy();
      puzzle.destroy();
      controller.abort();
    },
  };
}
