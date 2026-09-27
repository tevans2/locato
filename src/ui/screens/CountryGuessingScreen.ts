import type { AuthUser } from "../../core/auth";
import { markShellScreen, type RunType, type ShellContext } from "../shell/types";
import { CONTINENTS, type Continent, type Country, type CountryId, type CountryIndex } from "../../core/countries";
import { getGameModeOption, type GameModeId, type WorldMapGameModeId } from "../../core/gameModes";
import { detectCountryGuess, submitCountryGuess, type WorldCountryFeature } from "../../core/map";
import { timerKeysForMode } from "../../core/timer/keys";
import { formatTimerCompletionSuffix, postTimedRun } from "../../core/timer/leaderboardSync";
import { createPlayTimer, formatElapsedTime, formatStoredTime, type PlayTimer } from "../../core/timer/playTimer";
import { recordWorldAchievements, type Achievement } from "../../storage/achievements";
import type { Screen } from "../../app/router";
import type { AuthControls } from "../components/AuthPanel";
import { el } from "../dom/createElement";
import { createAtlasView, setAtlasOpen, updateAtlasView } from "../dom/renderAtlas";
import { createFeedbackView, showFeedback } from "../dom/renderFeedback";
import type { GlobeMapView } from "../dom/renderGlobeMap";
import { createPuzzleMapView, type PuzzleMapProgress } from "../dom/renderPuzzleMap";
import { createWorldMapView, setWorldMapMissingMarkersVisible, setWorldMapReviewCountries, setWorldMapTargetCountry, updateWorldMapView } from "../dom/renderWorldMap";
import { bindKeyboardAwareInput, dismissKeyboardIfTouchInput, shouldAutoFocusTextInput } from "../dom/mobileKeyboard";
import "../../styles/game-screens.css";
import { createGameBar, type GameBarHandle } from "../shell/GameBar";
import { createRunResults, formatRunTime, formatTimeSpent, hideResultsIn, showResultsIn, type RunResultsHandle, type TimedPostOutcome } from "./gameResults";

export interface WorldMapRunResult {
  readonly playMode: WorldMapGameModeId;
  readonly timed: boolean;
  readonly completed: boolean;
  readonly durationMs: number;
  readonly countriesFound: number;
  readonly countriesTotal: number;
}

export interface CountryGuessingScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly storage: Storage;
  /** The mode is fixed for the screen's lifetime: switching goes through the GameBar picker (a new URL). */
  readonly initialMode: WorldMapGameModeId;
  /** From the route: "timed" shows the clock in the GameBar and posts to the leaderboard. */
  readonly run?: RunType;
  /** Puzzle continent (`&continent=` on timed puzzle links). A timed puzzle is locked to it. */
  readonly puzzleContinent?: string;
  /** Legacy callbacks; the GameBar navigates through `shell` now. */
  readonly onGameModeChange?: (gameMode: GameModeId) => void;
  readonly onHome?: () => void;
  readonly onMultiplayer?: () => void;
  readonly onDailyChallenge?: () => void;
  // Called once per world-map run when it ends (completion, restart, mode change, or leaving).
  readonly onRecordGame?: (result: WorldMapRunResult) => void;
  readonly onLeaderboard?: () => void;
  readonly getAuthUser: () => AuthUser | null;
  readonly onViewStats?: () => void;
  readonly onViewFriends?: () => void;
  readonly authControls?: AuthControls;
}

type CountryGuessPlayMode = WorldMapGameModeId;
type MapSurface = "flat" | "globe";


export function createCountryGuessingScreen(options: CountryGuessingScreenOptions): Screen {
  const controller = new AbortController();
  const guessedCountryIds = new Set<CountryId>();
  const { countryIndex } = options;
  const playMode: CountryGuessPlayMode = options.initialMode;
  const shell = options.shell;
  const timed = options.run === "timed";
  const runType: RunType = timed ? "timed" : "practice";
  let showMissingCountries = false;
  let targetCountryId: CountryId | null = null;
  let lastFocusedSpotTargetId: CountryId | null = null;
  let spotFocusTimeoutId: number | null = null;
  let puzzleContinent: Continent = CONTINENTS.find((continent) => continent.toLowerCase() === options.puzzleContinent?.trim().toLowerCase()) ?? "Africa";
  let puzzlePlacedCount = 0;
  let puzzleTotalCount = countryIndex.countries.filter((country) => country.continent === puzzleContinent).length;
  let reviewCountryIds: readonly CountryId[] = [];
  let activeReviewCountryId: CountryId | null = null;
  let reviewTitle = "Missed countries";
  let runGivenUp = false;
  let mapSurface: MapSurface = "flat";
  let mapFullscreen = false;
  // A run = from a fresh start until it ends (completion, restart, mode/continent change, or leaving).
  // Recorded at most once; reset to false whenever a new run begins.
  let currentRunRecorded = false;
  let puzzleAccuracyPercent: number | null = null;
  let puzzleChecked = false;
  // Practice results: when the run started (first move) and how many wrong clicks / names it took.
  let runStartedAt: number | null = null;
  let runWrongGuesses = 0;
  let lastResults: RunResultsHandle | null = null;
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

  function recordWorldProgress(completed: boolean): void {
    showAchievements(recordWorldAchievements(options.storage, {
      playMode,
      completed,
      countryIndex,
      guessedCountryIds,
    }));
  }

  function renderMapReviewState(): void {
    const activeSet = new Set(reviewCountryIds);
    const visibleMissingCountryIds =
      showMissingCountries && !roundEnded()
        ? new Set(countryIndex.countries.filter((country) => !guessedCountryIds.has(country.id)).map((country) => country.id))
        : new Set<CountryId>();

    setWorldMapReviewCountries(map, activeSet, activeReviewCountryId);
    globe.update({
      guessedCountryIds,
      missedCountryIds: activeSet,
      targetCountryId: playMode === "spot-country" && !roundEnded() ? targetCountryId : null,
      clickableCountryIds: runGivenUp ? activeSet : playMode === "click-country" ? null : new Set<CountryId>(),
      showMissingCountryIds: visibleMissingCountryIds,
    });
  }

  function renderTimer(): void {
    if (!timed) return;
    clockValue.textContent = formatElapsedTime(playTimer.currentElapsedMs());
    timerLast.textContent = formatStoredTime(playTimer.readLast());
    timerBest.textContent = formatStoredTime(playTimer.readBest());
  }

  async function finishTimerRun(finalTimeMs: number): Promise<TimedPostOutcome> {
    const isNewLocalBest = playTimer.writeCompletion(finalTimeMs);
    const { serverAccepted, rank } = await postTimedRun({
      gameMode: playMode,
      variant: playMode === "puzzle" ? puzzleContinent : "",
      timeMs: finalTimeMs,
      isLoggedIn: options.getAuthUser() !== null,
    });
    return { isNewLocalBest, serverAccepted, rank };
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
    updateWorldMapView(map, guessedCountryIds);
    const finished = roundEnded();
    const targetActive = (playMode === "click-country" || playMode === "spot-country") && !finished;
    setWorldMapTargetCountry(map, playMode === "spot-country" && targetCountryId !== null && targetActive ? targetCountryId : null);
    updateAtlasView(atlas, countryIndex.countries, guessedCountryIds);
    const namingModeActive = playMode === "name-all";
    const spotCountryModeActive = playMode === "spot-country";
    const puzzleModeActive = playMode === "puzzle";
    if (puzzleModeActive && mapFullscreen) mapFullscreen = false;
    const globeActive = !puzzleModeActive && mapSurface === "globe";
    const mapFullscreenActive = mapFullscreen && !puzzleModeActive;
    element.classList.toggle("is-map-fullscreen", mapFullscreenActive);
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
    fullscreenButton.hidden = puzzleModeActive;
    mapSurfaceButton.textContent = mapSurface === "flat" ? "3D globe" : "Flat map";
    mapSurfaceButton.setAttribute("aria-pressed", String(mapSurface === "globe"));
    fullscreenButton.textContent = mapFullscreenActive ? "Exit fullscreen" : "Fullscreen";
    fullscreenButton.setAttribute("aria-pressed", String(mapFullscreenActive));
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
    showResultsButton.hidden = lastResults === null || element.dataset.phase === "results";
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
    if (playMode === "puzzle") mapFullscreen = false;
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
    runStartedAt = null;
    runWrongGuesses = 0;
    lastResults = null;
    hideResultsIn(element, resultsHost);
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

  /** Every country found: record it, post a timed run, and show the results card. */
  function finishWorldRun(): void {
    const finalTimeMs = timed ? playTimer.stop() : 0;
    recordCurrentRun(true);
    recordWorldProgress(true);
    if (timed) {
      const posting = finishTimerRun(finalTimeMs);
      void posting.then((result) => {
        showFeedback(feedback, `World complete. All ${countryIndex.countries.length} countries found in ${formatTimerCompletionSuffix(finalTimeMs, result, options.getAuthUser() !== null)}`, "good");
      });
      presentResults({ outcome: "complete", finalTimeMs, posting });
      return;
    }
    showFeedback(feedback, `World complete. All ${countryIndex.countries.length} countries found.`, "good");
    presentResults({ outcome: "complete" });
  }

  function noteRunStarted(): void {
    runStartedAt ??= Date.now();
  }

  function recordGuess(country: Country): void {
    playTimer.startIfNeeded();
    noteRunStarted();
    guessedCountryIds.add(country.id);
    lastCountryName.textContent = country.name;
    recordWorldProgress(false);

    if (playMode === "spot-country") {
      targetCountryId = null;
      lastFocusedSpotTargetId = null;
      render();
      input.value = "";
      map.resetView();

      if (complete()) {
        finishWorldRun();
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
      finishWorldRun();
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
      runWrongGuesses += 1;
      showFeedback(feedback, `That's ${country.name}, not the highlighted country.`, "bad");
      if (showMiss && shouldAutoFocusTextInput()) input.select();
      return;
    }

    if (showMiss && input.value.trim()) {
      runWrongGuesses += 1;
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
      runWrongGuesses += 1;
      showFeedback(feedback, `Not ${clickedCountry.name}. Find ${targetCountry.name}.`, "bad");
      return;
    }

    recordGuess(clickedCountry);
  }

  function giveUpNameAllRun(): void {
    if (playMode !== "name-all" || roundEnded()) return;

    captureReviewForCurrentRun("the given-up run", true);
    recordCurrentRun(false);
    const finalTimeMs = timed ? playTimer.stop() : 0;
    runGivenUp = true;
    showMissingCountries = true;
    dismissKeyboardIfTouchInput(input);
    input.value = "";
    activeReviewCountryId = null;
    render();
    showFeedback(feedback, `Round ended. Click any red country to see its name.`, "neutral");
    presentResults({ outcome: "given-up", finalTimeMs });
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

    const puzzleStats = { accuracyPercent: accuracy.accuracyPercent, closeCount: accuracy.closeCount, totalCount: accuracy.totalCount };
    if (timed && !alreadyChecked) {
      const finalTimeMs = playTimer.stop();
      const posting = finishTimerRun(finalTimeMs);
      void posting.then((result) => {
        render();
        showFeedback(
          feedback,
          `${baseMessage} Time: ${formatTimerCompletionSuffix(finalTimeMs, result, options.getAuthUser() !== null)}`,
          accuracy.accuracyPercent >= 75 ? "good" : "neutral",
        );
      });
      presentResults({ outcome: "complete", finalTimeMs, posting, puzzle: puzzleStats });
      return;
    }

    render();
    showFeedback(feedback, baseMessage, accuracy.accuracyPercent >= 75 ? "good" : "neutral");
    if (!alreadyChecked) presentResults({ outcome: "complete", puzzle: puzzleStats });
    else if (lastResults) reopenResults();
  }

  interface PresentResultsInput {
    readonly outcome: "complete" | "given-up";
    readonly finalTimeMs?: number;
    readonly posting?: Promise<TimedPostOutcome>;
    readonly puzzle?: { readonly accuracyPercent: number; readonly closeCount: number; readonly totalCount: number };
  }

  /** The end-of-run card: completion, a checked puzzle, or a given-up name-all run. */
  function presentResults(input: PresentResultsInput): void {
    if (!shell) return;
    const givenUp = input.outcome === "given-up";
    const label = getGameModeOption(playMode).label;
    const found = playMode === "puzzle" ? puzzlePlacedCount : guessedCountryIds.size;
    const total = playMode === "puzzle" ? puzzleTotalCount : countryIndex.countries.length;
    const spentMs = runStartedAt === null ? 0 : Date.now() - runStartedAt;
    const attempts = found + runWrongGuesses;
    const accuracy = attempts > 0 ? `${Math.round((found / attempts) * 100)}%` : "—";
    const missed = givenUp ? reviewCountryIds.map((id) => countryIndex.byId[id]).filter((country): country is Country => Boolean(country)) : [];
    const time = formatRunTime(input.finalTimeMs ?? 0);
    const variant = playMode === "puzzle" ? puzzleContinent : "";
    const kind = playMode === "puzzle" ? `the ${puzzleContinent} puzzle` : label;

    const stats = input.puzzle
      ? [
          { label: "Accuracy", value: `${input.puzzle.accuracyPercent}%` },
          { label: "Very close", value: `${input.puzzle.closeCount}/${input.puzzle.totalCount}` },
          ...(timed ? [{ label: "Your best", value: formatStoredTime(playTimer.readBest()) }] : [{ label: "Time spent", value: formatTimeSpent(spentMs) }]),
        ]
      : [
          { label: "Found", value: `${found}/${total}` },
          ...(playMode === "name-all" ? [] : [{ label: "Accuracy", value: accuracy }]),
          ...(timed && !givenUp ? [{ label: "Your best", value: formatStoredTime(playTimer.readBest()) }] : [{ label: timed ? "Time" : "Time spent", value: timed ? time : formatTimeSpent(spentMs) }]),
        ];

    lastResults = createRunResults(shell, {
      mode: playMode,
      run: runType,
      variant,
      title: givenUp ? (timed ? "Run ended" : "Round over") : timed ? time : input.puzzle ? `${input.puzzle.accuracyPercent}% accurate` : "World complete",
      ...(givenUp
        ? { subtitle: `You named ${found} of ${total} countries.${timed ? " Given-up runs aren't posted." : ""}` }
        : !timed
          ? { subtitle: input.puzzle ? `Every ${puzzleContinent} country is on the board.` : `All ${total} countries found.` }
          : {}),
      stats,
      missed,
      ...(givenUp ? { missedTitle: `${missed.length} missed` } : {}),
      onPlayAgain: () => {
        hideResults();
        resetGame(timed ? "New timed run. The clock starts on your first correct move." : playMode === "puzzle" ? `Fresh ${puzzleContinent} puzzle ready.` : "Fresh world map ready.", false);
      },
      extraActions: givenUp ? [{ label: "Review on the map", icon: "globe", onClick: () => hideResults() }] : [],
      shareText: givenUp
        ? `I named ${found} of ${total} countries on Locato.`
        : timed
          ? `I finished ${kind} on Locato in ${time} (timed run).`
          : input.puzzle
            ? `I rebuilt ${kind} on Locato — ${input.puzzle.accuracyPercent}% accurate.`
            : `I found all ${total} countries in ${label} on Locato.`,
      tone: givenUp ? "neutral" : "celebrate",
      ...(input.posting && !givenUp ? { posting: input.posting } : {}),
    });
    showResultsIn(element, resultsHost, lastResults);
    render();
  }

  function hideResults(): void {
    hideResultsIn(element, resultsHost);
    render();
  }

  function reopenResults(): void {
    if (lastResults) showResultsIn(element, resultsHost, lastResults);
    render();
  }

  const map = createWorldMapView(options.worldCountryFeatures, countryIndex, { onCountryClick: handleCountryClick });
  let globeView: GlobeMapView | null = null;
  const globeHost = el("div", { className: "world-globe-panel globe-host" });
  const globe: GlobeMapView = {
    element: globeHost,
    update: (state) => globeView?.update(state),
    showCountryLabel: (id) => globeView?.showCountryLabel(id),
    resetView: () => globeView?.resetView(),
    destroy: () => globeView?.destroy(),
  };
  const atlas = createAtlasView(countryIndex.countries);
  const feedback = createFeedbackView();
  const input = el("input", {
    attrs: { id: "guess-input", name: "guess", type: "text", autocomplete: "off", autocapitalize: "words", autocorrect: "off", spellcheck: "false", inputmode: "text", enterkeyhint: "done", placeholder: "e.g. Brazil, Japan, ZA..." },
  });
  const submitButton = el("button", { className: "primary-action guess-submit-action", text: "Enter", attrs: { type: "submit", "aria-label": "Enter guess" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart", attrs: { type: "button" } });
  if (timed) resetButton.textContent = "Restart run";
  // Timed runs: the live clock sits in the GameBar pill.
  const clockValue = el("span", { className: "game-run-clock-value", text: formatElapsedTime(0), attrs: { "aria-label": "Elapsed time" } });
  const resultsHost = el("div", { className: "game-results-host", attrs: { hidden: "" } });
  const showResultsButton = el("button", { className: "primary-action game-show-results", text: "See results", attrs: { type: "button", hidden: "" } });
  const foundLabel = el("span", { className: "stat-label", text: "Found" });
  const foundCount = el("strong", { className: "stat-value", text: "0" });
  const remainingCount = el("strong", { className: "stat-value", text: String(countryIndex.countries.length) });
  const lastCountryName = el("strong", { className: "stat-value", text: "None" });
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
      // A timed puzzle is locked to the continent its board is for.
      ...(timed
        ? [el("span", { className: "country-click-target-label", text: "Timed puzzle" }), el("strong", { className: "country-click-target-name puzzle-continent-locked", text: puzzleContinent })]
        : [el("label", { className: "country-click-target-label", text: "Puzzle continent", attrs: { for: "puzzle-continent" } }), puzzleContinentSelect]),
      el("p", { text: "Drag every cutout onto the continent. Nothing snaps into place; press Check accuracy when you are done." }),
    ],
  });
  // Found / remaining stay visible on phones (the score line); last + times fold into Details.
  const statsPanel = el("div", {
    className: "stats-panel country-guess-stats country-guess-score",
    children: [
      el("div", { className: "stat-card", children: [foundLabel, foundCount] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Remaining" }), remainingCount] }),
    ],
  });
  const detailStatsPanel = el("div", {
    className: `stats-panel country-guess-stats country-guess-detail-stats${timed ? " timer-is-active" : ""}`,
    children: [
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Last" }), lastCountryName] }),
      ...(timed
        ? [
            el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Previous" }), timerLast] }),
            el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Best" }), timerBest] }),
          ]
        : []),
    ],
  });
  const showMissingButton = el("button", { className: "ghost-action", text: "Show missing", attrs: { type: "button", "aria-pressed": "false" } });
  const mapSurfaceButton = el("button", { className: "ghost-action", text: "3D globe", attrs: { type: "button", "aria-pressed": "false" } });
  const fullscreenButton = el("button", { className: "ghost-action map-fullscreen-action", text: "Fullscreen", attrs: { type: "button", "aria-pressed": "false" } });
  const giveUpButton = el("button", { className: "ghost-action", text: "Give up", attrs: { type: "button" } });
  const checkPuzzleButton = el("button", { className: "primary-action puzzle-check-button", text: "Check accuracy", attrs: { type: "button" } });
  const mobileExtrasToggle = el("button", { className: "mobile-extras-toggle", text: "Details", attrs: { type: "button", "aria-expanded": "false" } });
  const mobileExtrasPanel = el("div", { className: "mobile-extras-panel" });
  playTimer = createPlayTimer({
    storage: options.storage,
    keys: timerKeysForMode(playMode),
    isComplete: roundEnded,
    onTick: renderTimer,
  });
  if (timed) playTimer.setMode("count-up");

  const puzzle = createPuzzleMapView(options.worldCountryFeatures, countryIndex, puzzleContinent, {
    signal: controller.signal,
    onFirstPlacement: () => {
      playTimer.startIfNeeded();
      noteRunStarted();
    },
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
    async () => {
      dismissKeyboardIfTouchInput(input);
      if (!globeView && mapSurface === "flat") {
        mapSurfaceButton.disabled = true;
        mapSurfaceButton.textContent = "Preparing globe…";
        try {
          const { createGlobeMapView } = await import("../dom/renderGlobeMap");
          if (controller.signal.aborted) return;
          globeView = createGlobeMapView(options.worldCountryFeatures, countryIndex, { onCountryClick: handleCountryClick });
          globeHost.append(globeView.element);
        } catch {
          if (!controller.signal.aborted) showFeedback(feedback, "The 3D globe is unavailable on this device. You can keep playing on the flat map.", "neutral");
          return;
        } finally {
          if (!controller.signal.aborted) {
            mapSurfaceButton.disabled = false;
            mapSurfaceButton.textContent = "3D globe";
          }
        }
      }
      mapSurface = mapSurface === "flat" ? "globe" : "flat";
      map.showCountryLabel(null);
      globe.showCountryLabel(null);
      render();
    },
    { signal: controller.signal },
  );
  fullscreenButton.addEventListener(
    "click",
    () => {
      dismissKeyboardIfTouchInput(input);
      if (playMode === "puzzle") return;
      mapFullscreen = !mapFullscreen;
      render();
      if ((playMode === "name-all" || playMode === "spot-country") && mapFullscreen && shouldAutoFocusTextInput()) input.focus();
    },
    { signal: controller.signal },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (!mapFullscreen || event.key !== "Escape") return;
      mapFullscreen = false;
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
  resetButton.addEventListener(
    "click",
    () => {
      dismissKeyboardIfTouchInput(input);
      resetGame(
        timed
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
  showResultsButton.addEventListener("click", reopenResults, { signal: controller.signal });
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
    detailStatsPanel,
    achievementPanel,
    el("div", { className: "actions", children: [showMissingButton, mapSurfaceButton, fullscreenButton, giveUpButton, checkPuzzleButton, resetButton, atlas.element] }),
  );

  const progressOfRun = (): number => (playMode === "puzzle" ? puzzlePlacedCount : guessedCountryIds.size);
  const gameBar: GameBarHandle | null = shell
    ? createGameBar(shell, {
        gameMode: playMode,
        run: runType,
        ...(timed ? { clock: clockValue } : {}),
        onBack: () => shell.goBack(timed ? "compete" : "play"),
        backLabel: timed ? "Back to Compete" : "Back",
        onHowToPlay: () => showFeedback(feedback, getGameModeOption(playMode).description, "neutral"),
        extraMenuItems: [{ label: timed ? "Restart run" : "Start a fresh run", icon: "rotate-ccw", onSelect: () => resetButton.click() }],
        leaveGuard: () => (timed && !roundEnded() && progressOfRun() > 0 ? "This timed run is still going — it won't be posted." : null),
      })
    : null;


  const element = el("section", {
    className: `game-screen country-guess-screen is-${runType}-run`,
    attrs: { "data-run": runType, "data-mode": playMode },
    children: [
      ...(gameBar ? [gameBar.element] : []),
      resultsHost,
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
              statsPanel,
              showResultsButton,
              mobileExtrasToggle,
              mobileExtrasPanel,
            ],
          }),
        ],
      }),
    ],
  });

  markShellScreen(element, "game");
  render();

  showFeedback(
    feedback,
    timed
      ? "Timed run. The clock starts on your first correct move."
      : playMode === "click-country"
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
      gameBar?.destroy();
      controller.abort();
    },
  };
}
