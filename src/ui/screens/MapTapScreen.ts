import type { RunType, ShellContext } from "../shell/types";
import { scoreDailyMapTapRound } from "../../core/dailyChallenge";
import type { Screen } from "../../app/router";
import { fetchMapTapRound, fetchWikipediaSummary, isValidLatLng, MAP_TAP_CATEGORY_OPTIONS, MAP_TAP_DEFAULT_DECAY_KM, MAP_TAP_LOCATIONS, MAP_TAP_MAX_SCORE, normalizeLongitude, scoreMapTapGuess, validateMapTapGuess, type MapTapCategory, type MapTapDifficulty, type MapTapGuessResult, type MapTapLocation, type MapTapRoundTarget } from "../../core/maptap";
import { describeMapTapSkill, difficultyForSkill, defaultMapTapSkill, readMapTapSkill, recordMapTapResult, saveMapTapSkill } from "../../core/maptap/skill";
import type { GameModeId } from "../../core/gameModes";
import { MAP_TAP_ATTEMPT_TARGETS } from "../../core/leaderboards";
import { el } from "../dom/createElement";
import { createMapTapGlobe, type MapTapGlobe, type MapTapGlobeOptions, type MapTapClick } from "../components/MapTapGlobe";
import { createMapTapInfoOverlay, type MapTapInfoOverlay } from "../components/MapTapInfoOverlay";
import { createResultsCard } from "../shell/ResultsCard";
import {
  createDailyStageBar,
  createPracticeBar,
  createResultsStage,
  createRunList,
  formatKm,
  formatNumber,
  insertIntoResults,
  recordLocalBest,
  runLeaveMessage,
  shareSquare,
  shellOrFallback,
  type DailyStageProgress,
} from "./practiceRun";
import { createRankedBar, createRankedResults, rankedCrossLink, submitRankedAttempt, type PostRankedAttempt } from "./rankedAttempt";

/** A practice run is this many targets; then the results screen. */
export const MAP_TAP_RUN_LENGTH = 10;
export const MAP_TAP_BEST_RUN_KEY = "locato:maptap:best-run:v1";

export interface MapTapScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onHome: () => void;
  readonly onMultiplayer?: () => void;
  readonly onDailyChallenge?: () => void;
  /**
   * "timed" (`&run=timed`) plays a ranked attempt: ${MAP_TAP_ATTEMPT_TARGETS} targets from every
   * category and difficulty with standard scoring, no setup panel and no restart; the total posts
   * to the MapTap board. Ignored in the daily.
   */
  readonly run?: RunType;
  // When provided, casual rounds pick targets from an adaptive difficulty ramp persisted
  // across visits. Daily challenge rounds are unaffected.
  readonly storage?: Storage;
  readonly dailyChallenge?: {
    readonly date: string;
    readonly title?: string;
    readonly practice?: boolean;
    readonly target: MapTapLocation;
    readonly onComplete: (result: MapTapGuessResult) => void;
    /** Save the scored pin before showing its answer, so refreshing cannot replay it. */
    readonly onResult?: (result: MapTapGuessResult) => void;
    /** Where this stage sits in today's daily ("Round 9 of 10"), for the FocusBar. */
    readonly progress?: DailyStageProgress;
  };
}

/** Injectable surfaces so the run flow is testable without WebGL or the API. */
export interface MapTapScreenServices {
  readonly createGlobe: (options: MapTapGlobeOptions) => Pick<MapTapGlobe, "element" | "reset" | "reveal" | "setAcceptingGuesses">;
  readonly createInfoOverlay: () => MapTapInfoOverlay;
  readonly fetchRound: typeof fetchMapTapRound;
  readonly validateGuess: typeof validateMapTapGuess;
  readonly fetchSummary: typeof fetchWikipediaSummary;
  /** Posts a ranked attempt's total (defaults to the leaderboard API). */
  readonly postAttempt?: PostRankedAttempt;
  readonly restartRun?: () => Promise<unknown>;
}

const CATEGORIES = MAP_TAP_CATEGORY_OPTIONS;

const DIFFICULTIES: readonly { readonly value: "" | MapTapDifficulty; readonly label: string }[] = [
  { value: "", label: "All difficulties" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const CATEGORY_LABELS: Record<MapTapCategory, string> = {
  city: "City",
  region: "Region",
  mountain: "Mountain",
  "mountain-range": "Mountain range",
  ocean: "Ocean or sea",
  poi: "Natural wonder",
  landmark: "Landmark",
};

function formatCategory(category: MapTapCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Fisher–Yates copy, so a round tries the selected categories in a random order. */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function optionNodes<T extends string>(items: readonly { readonly value: T; readonly label: string }[]): readonly HTMLOptionElement[] {
  return items.map((item) => el("option", { text: item.label, attrs: { value: item.value } }));
}

export function createMapTapScreen(options: MapTapScreenOptions, overrides: Partial<MapTapScreenServices> = {}): Screen {
  const services: MapTapScreenServices = {
    createGlobe: createMapTapGlobe,
    createInfoOverlay: createMapTapInfoOverlay,
    fetchRound: fetchMapTapRound,
    validateGuess: validateMapTapGuess,
    fetchSummary: fetchWikipediaSummary,
    ...overrides,
  };
  const controller = new AbortController();
  const shell = shellOrFallback(options.shell, options.onHome);
  const isDailyChallenge = options.dailyChallenge !== undefined;
  /** A ranked attempt: fixed, fair settings (all categories and difficulties, standard scoring). */
  const ranked = !isDailyChallenge && options.run === "timed";
  const runLength = ranked ? MAP_TAP_ATTEMPT_TARGETS : MAP_TAP_RUN_LENGTH;
  let activeTarget: MapTapRoundTarget | null = null;
  let activeResult: MapTapGuessResult | null = null;
  let isSubmitting = false;
  let isLoading = false;
  let dailyCompleted = false;
  let skill = options.storage ? readMapTapSkill(options.storage) : defaultMapTapSkill;
  let adaptiveRoundIndex = 0;
  /** Bumped on every load and on going back to setup, so a stale fetch never lands. */
  let loadSequence = 0;
  /** This run's scored targets (never more than runLength). */
  const runResults: MapTapGuessResult[] = [];
  let runFinished = false;
  /** Practice opens on the category setup panel; the daily and a ranked attempt skip it. */
  let hasStarted = isDailyChallenge || ranked;
  const selectedCategoryIds = new Set<MapTapCategory>(CATEGORIES.map((category) => category.value));

  const promptTarget = el("strong", { text: "Loading..." });
  const promptMeta = el("span", { className: "maptap-prompt-meta", text: "" });
  const runLabel = el("span", { className: "maptap-run-label" });
  const runTotal = el("strong", { className: "maptap-run-total", text: "0" });
  const runDots = Array.from({ length: runLength }, () => el("span", { className: "maptap-run-dot" }));
  const runProgress = el("div", {
    className: "maptap-run",
    attrs: isDailyChallenge ? { hidden: "true" } : {},
    children: [
      el("div", { className: "maptap-run-head", children: [runLabel, el("span", { className: "maptap-run-score", children: [runTotal, el("span", { text: " pts" })] })] }),
      el("div", { className: "maptap-run-dots", attrs: { "aria-hidden": "true" }, children: runDots }),
    ],
  });
  const statusText = el("p", { className: "maptap-status", attrs: { role: "status" }, text: "Loading a target..." });
  const resultPanel = el("section", { className: "maptap-result-panel", attrs: { hidden: "true" } });
  const newRoundButton = el("button", { className: "primary-action", text: "Next target", attrs: { type: "button" } });
  const resetButton = el("button", { className: "ghost-action maptap-reset", text: "Reset view", attrs: { type: "button" } });
  const difficultySelect = el("select", {
    className: "maptap-filter-select",
    attrs: { id: "maptap-difficulty", name: "maptapDifficulty", "aria-label": "MapTap difficulty" },
    children: optionNodes(DIFFICULTIES),
  });
  // Friendly presets instead of a raw kilometre input — "Standard" matches the old default.
  const DECAY_PRESETS: readonly { readonly value: string; readonly label: string }[] = [
    { value: "2000", label: "Relaxed (2,000 km)" },
    { value: String(MAP_TAP_DEFAULT_DECAY_KM), label: "Standard (1,000 km)" },
    { value: "500", label: "Precise (500 km)" },
  ];
  const decayInput = el("select", {
    className: "maptap-filter-select",
    attrs: { id: "maptap-decay", name: "maptapDecay", "aria-label": "MapTap scoring leniency" },
    children: optionNodes(DECAY_PRESETS),
  });
  decayInput.value = String(MAP_TAP_DEFAULT_DECAY_KM);

  // ---- Category setup (practice only) ---------------------------------------------------------
  const startButton = el("button", { className: "primary-action maptap-start-action", text: "Start MapTap", attrs: { type: "button" } });
  const toggleAllButton = el("button", { className: "ghost-action maptap-toggle-all", text: "Clear all", attrs: { type: "button" } });
  const changeCategoriesButton = el("button", { className: "ghost-action maptap-change-categories", text: "Change categories", attrs: { type: "button" } });
  const selectionSummary = el("p", { className: "maptap-selection-summary", attrs: { role: "status" } });
  const activeCategoriesLabel = el("span", { className: "maptap-active-categories" });
  const categoryInputs = new Map<MapTapCategory, HTMLInputElement>();
  const categoryOptions = CATEGORIES.map((category) => {
    const count = MAP_TAP_LOCATIONS.filter((location) => location.category === category.value).length;
    const input = el("input", {
      attrs: { type: "checkbox", name: "maptapCategories", value: category.value, checked: "", "aria-label": category.label },
    });
    categoryInputs.set(category.value, input);
    return el("label", {
      className: "maptap-category-option",
      children: [
        input,
        el("span", { className: "maptap-category-copy", children: [el("strong", { text: category.label }), el("small", { text: category.description })] }),
        el("span", { className: "maptap-category-count", text: String(count), attrs: { "aria-label": `${count} locations` } }),
      ],
    });
  });

  const globe = services.createGlobe({
    signal: controller.signal,
    onGuess: (point) => {
      void submitGuess(point);
    },
  });

  const infoOverlay = services.createInfoOverlay();

  function selectedCategories(): readonly MapTapCategory[] {
    return CATEGORIES.map((category) => category.value).filter((category) => selectedCategoryIds.has(category));
  }

  function selectionLabel(): string {
    const categories = selectedCategories();
    return categories.length === CATEGORIES.length
      ? "All location types"
      : categories.map((category) => CATEGORIES.find((item) => item.value === category)?.label ?? category).join(", ");
  }

  function updateCategorySetup(): void {
    const categories = selectedCategories();
    const locationCount = MAP_TAP_LOCATIONS.filter((location) => selectedCategoryIds.has(location.category)).length;
    selectionSummary.textContent = categories.length === 0
      ? "Choose at least one category to start."
      : `${formatNumber(locationCount)} locations across ${categories.length} ${categories.length === 1 ? "category" : "categories"}`;
    activeCategoriesLabel.textContent = ranked ? "All location types · all difficulties · standard scoring" : selectionLabel();
    startButton.disabled = categories.length === 0;
    toggleAllButton.textContent = categories.length === CATEGORIES.length ? "Clear all" : "Select all";
  }

  function selectedDifficulty(): MapTapDifficulty | "" {
    return difficultySelect.value as MapTapDifficulty | "";
  }

  function selectedDecayKm(): number {
    const parsed = Number(decayInput.value);
    return Number.isFinite(parsed) ? parsed : MAP_TAP_DEFAULT_DECAY_KM;
  }

  function setControlsDisabled(disabled: boolean): void {
    // Difficulty and score range live on the setup panel, so they're fixed for the whole run.
    newRoundButton.disabled = disabled;
    changeCategoriesButton.disabled = disabled || isDailyChallenge || ranked;
    // Reset only recentres the globe before you pin. Once the answer is revealed it stays
    // disabled — re-pinning a revealed target would let players inflate their skill.
    resetButton.disabled = disabled || isDailyChallenge || activeResult !== null || isSubmitting;
  }

  function renderRunProgress(): void {
    if (isDailyChallenge) return;
    const scored = runResults.length;
    const current = Math.min(runLength, scored + (activeResult ? 0 : 1));
    runLabel.textContent = `Target ${current} of ${runLength}`;
    runTotal.textContent = formatNumber(runResults.reduce((sum, item) => sum + item.score, 0));
    runDots.forEach((dot, index) => {
      const result = runResults[index];
      dot.classList.toggle("is-done", Boolean(result));
      dot.classList.toggle("is-strong", Boolean(result && result.score / result.maxScore >= 0.6));
      dot.classList.toggle("is-current", !result && !activeResult && index === scored);
    });
  }

  function renderTarget(target: MapTapRoundTarget | null): void {
    if (!target) {
      promptTarget.textContent = "Loading...";
      promptMeta.textContent = "";
      return;
    }
    promptTarget.textContent = target.name;
    promptMeta.textContent = `${formatCategory(target.category)} · ${target.difficulty}`;
  }

  function renderResult(result: MapTapGuessResult): void {
    resultPanel.hidden = false;
    const lastOfRun = !isDailyChallenge && runResults.length >= runLength;
    newRoundButton.textContent = isDailyChallenge ? options.dailyChallenge?.practice ? "Continue practice" : "Continue daily challenge" : lastOfRun ? "See results" : "Next target";
    const insideZone = result.distanceKm <= result.toleranceKm;
    const zoneNote = insideZone ? ` — right in the ${formatNumber(result.toleranceKm)} km target zone` : "";
    const verdict = result.score / result.maxScore >= 0.6 ? "Great pin!" : insideZone ? "Nailed the area!" : "Not quite — trace the line on the globe, then try the next one.";
    resultPanel.replaceChildren(
      newRoundButton,
      el("p", { className: "maptap-result-verdict", text: `${verdict} ${result.target.name} is highlighted on the globe.` }),
      el("div", { className: "maptap-result-score", children: [el("span", { text: isDailyChallenge ? "Round score" : "Score" }), el("strong", { text: isDailyChallenge ? `${scoreDailyMapTapRound(result.score, result.maxScore)}/10` : `${formatNumber(result.score)}/${formatNumber(result.maxScore)}` })] }),
      el("div", { className: "maptap-result-stat", children: [el("span", { text: "Distance" }), el("strong", { text: `${formatKm(result.distanceKm)}${zoneNote}` })] }),
      el("div", { className: "maptap-result-stat", children: [el("span", { text: "Actual" }), el("strong", { text: `${result.target.name} (${formatCategory(result.target.category)})` })] }),
    );
  }

  /** One target from the selection: a random selected category each round (staging's rule), falling back to the others if that category has nothing at this difficulty. */
  async function fetchSelectedTarget(difficulty: MapTapDifficulty | ""): Promise<MapTapRoundTarget | null> {
    for (const category of shuffled(selectedCategories())) {
      const target = await services.fetchRound({ category, difficulty }).catch(() => null);
      if (controller.signal.aborted || !hasStarted) return null;
      if (target) return target;
    }
    return null;
  }

  async function loadRound(): Promise<void> {
    if (!hasStarted) return;
    const loadId = ++loadSequence;
    activeTarget = null;
    activeResult = null;
    isSubmitting = false;
    isLoading = true;
    resultPanel.hidden = true;
    resultPanel.replaceChildren();
    infoOverlay.hide();
    globe.reset();
    globe.setAcceptingGuesses(false);
    setControlsDisabled(true);
    renderTarget(null);
    renderRunProgress();
    resetButton.textContent = "Reset view";
    statusText.textContent = "Loading a target...";

    // Explicit difficulty filter wins; otherwise casual rounds ride the adaptive ramp. A ranked
    // attempt draws from every difficulty so every player gets the same mix.
    const adaptiveDifficulty = !isDailyChallenge && !ranked && selectedDifficulty() === "" && options.storage
      ? difficultyForSkill(skill.level, adaptiveRoundIndex)
      : selectedDifficulty();
    const target = options.dailyChallenge?.target ?? (await fetchSelectedTarget(adaptiveDifficulty));
    // Aborted, or the player went back to setup / restarted while this was in flight.
    if (controller.signal.aborted || loadId !== loadSequence) return;
    isLoading = false;

    if (!target) {
      statusText.textContent = "We couldn’t find a target. Check your connection, then try again.";
      setControlsDisabled(false);
      resetButton.textContent = "Try again";
      return;
    }

    activeTarget = target;
    renderTarget(target);
    if (ranked) {
      statusText.textContent = "Ranked attempt: rotate or zoom the globe, then click once as close as you can.";
    } else if (!isDailyChallenge) {
      adaptiveRoundIndex += 1;
      statusText.textContent = `Rotate or zoom the globe, then click once as close as you can. ${describeMapTapSkill(skill.level)}`;
    } else {
      statusText.textContent = `${options.dailyChallenge?.practice ? "Practice" : "Daily"} MapTap: click once as close as you can.`;
    }
    globe.reset();
    globe.setAcceptingGuesses(true);
    setControlsDisabled(false);
  }

  function buildDailyResult(point: MapTapClick): MapTapGuessResult | null {
    const target = options.dailyChallenge?.target;
    if (!target) return null;
    const guess = { lat: point.lat, lng: normalizeLongitude(point.lng) };
    if (!isValidLatLng(guess)) return null;
    const scored = scoreMapTapGuess(guess, target, selectedDecayKm());
    return {
      target,
      guess,
      distanceKm: Math.round(scored.distanceKm * 10) / 10,
      score: scored.score,
      maxScore: MAP_TAP_MAX_SCORE,
      decayKm: scored.decayKm,
      toleranceKm: scored.toleranceKm,
    };
  }

  async function submitGuess(point: MapTapClick): Promise<void> {
    if (!activeTarget || activeResult || isSubmitting || runFinished) return;
    const guessSequence = loadSequence;
    isSubmitting = true;
    globe.setAcceptingGuesses(false);
    setControlsDisabled(true);
    statusText.textContent = "Checking your guess...";

    const result = options.dailyChallenge
      ? buildDailyResult(point)
      : await services.validateGuess({
          targetId: activeTarget.id,
          guessLat: point.lat,
          guessLng: point.lng,
          decayKm: ranked ? MAP_TAP_DEFAULT_DECAY_KM : selectedDecayKm(),
        }).catch(() => null);
    // Aborted, or the player went back to setup / restarted while the guess was checked.
    if (controller.signal.aborted || guessSequence !== loadSequence) return;

    isSubmitting = false;

    if (!result) {
      setControlsDisabled(false);
      statusText.textContent = "Could not validate that guess. Try the same target again.";
      globe.setAcceptingGuesses(true);
      return;
    }

    activeResult = result;
    options.dailyChallenge?.onResult?.(result);
    if (!isDailyChallenge) {
      runResults.push(result);
      // A ranked attempt leaves the adaptive skill alone (its difficulty mix is fixed).
      if (options.storage && !ranked) {
        skill = recordMapTapResult(skill, result.score / result.maxScore);
        saveMapTapSkill(options.storage, skill);
      }
    }
    setControlsDisabled(false);
    renderRunProgress();
    statusText.textContent = isDailyChallenge
      ? options.dailyChallenge?.practice ? "Result revealed. Continue your practice." : "Result revealed. Continue to the next daily round."
      : ranked ? `${formatNumber(result.score)} points. ${runResults.length} of ${runLength} targets pinned.` : describeMapTapSkill(skill.level);
    globe.reveal(result);
    renderResult(result);
    void services.fetchSummary(result.target.wikiSlug, controller.signal).then((summary) => {
      if (controller.signal.aborted || activeResult !== result) return;
      infoOverlay.show(result.target.name, summary);
    }).catch(() => undefined);
  }

  // ---- Run ending ---------------------------------------------------------------------------

  function showResults(): void {
    runFinished = true;
    infoOverlay.hide();
    globe.setAcceptingGuesses(false);
    const total = runResults.reduce((sum, item) => sum + item.score, 0);
    const maximum = runResults.reduce((sum, item) => sum + item.maxScore, 0) || runLength * MAP_TAP_MAX_SCORE;
    const averageKm = runResults.reduce((sum, item) => sum + item.distanceKm, 0) / Math.max(1, runResults.length);
    const best = runResults.reduce<MapTapGuessResult | null>((top, item) => (!top || item.score > top.score ? item : top), null);
    const ratio = total / maximum;
    const shareText = `Locato MapTap${ranked ? " (ranked)" : ""} ${formatNumber(total)}/${formatNumber(maximum)}\n${runResults.map((item) => shareSquare(item.score / item.maxScore)).join("")}\nAverage ${formatKm(averageKm)} off\nlocato.quest`;
    const runList = createRunList("Your targets", runResults.map((item) => ({
      label: item.target.name,
      detail: `${formatCategory(item.target.category)} · ${formatKm(item.distanceKm)} away`,
      value: formatNumber(item.score),
      tone: item.score / item.maxScore >= 0.6 ? "good" : item.score / item.maxScore >= 0.25 ? "ok" : "miss",
    })));

    if (ranked) {
      const rankedCard = createRankedResults(shell, {
        mode: "map-tap",
        title: ratio >= 0.7 ? "Superb pinning" : ratio >= 0.45 ? "Solid attempt" : "Attempt complete",
        total,
        stats: [
          { label: "Total score", value: formatNumber(total), note: `of ${formatNumber(maximum)}` },
          { label: "Average distance", value: formatKm(averageKm) },
          ...(best ? [{ label: "Best round", value: formatNumber(best.score), note: best.target.name }] : []),
        ],
        shareTitle: "Locato MapTap",
        shareText,
        onTryAgain: startRun,
        posting: submitRankedAttempt({ shell, mode: "map-tap", total, storage: options.storage ?? null, ...(services.postAttempt ? { post: services.postAttempt } : {}) }),
        tone: ratio >= 0.45 ? "celebrate" : "neutral",
      });
      insertIntoResults(rankedCard, runList);
      resultsStage.show(rankedCard);
      return;
    }

    const localBest = recordLocalBest(options.storage, MAP_TAP_BEST_RUN_KEY, total);
    const card = createResultsCard(shell, {
      kicker: `MapTap · Custom · ${selectionLabel()}`,
      title: localBest.isNew && localBest.previous > 0 ? "A new best run!" : ratio >= 0.7 ? "Superb pinning" : ratio >= 0.45 ? "Solid run" : "Run complete",
      subtitle: `${runLength} targets, ${formatNumber(total)} of ${formatNumber(maximum)} points.`,
      stats: [
        { label: "Total score", value: formatNumber(total), note: `of ${formatNumber(maximum)}` },
        { label: "Average distance", value: formatKm(averageKm) },
        ...(best ? [{ label: "Best round", value: formatNumber(best.score), note: best.target.name }] : []),
        { label: "Your best run", value: formatNumber(localBest.best), note: localBest.isNew ? "New best" : "On this device" },
      ],
      primary: { label: "Play again", onClick: startRun },
      secondary: [{ label: "Change categories", icon: "layout-grid", onClick: showSetup }],
      share: { title: "Locato MapTap", text: shareText },
      crossLink: rankedCrossLink(shell, "map-tap"),
      tone: ratio >= 0.45 ? "celebrate" : "neutral",
    });
    insertIntoResults(card, runList);
    resultsStage.show(card);
  }

  /** A fresh run with the current selection ("Play again" keeps the same categories; "Try again" starts a new ranked attempt). */
  let restarting = false;
  async function startRun(): Promise<void> {
    if (!isDailyChallenge && selectedCategoryIds.size === 0) return;
    if (restarting) return;
    if (services.restartRun) {
      restarting = true;
      loadSequence += 1;
      globe.setAcceptingGuesses(false);
      try { await services.restartRun(); }
      catch { statusText.textContent = "Could not restart this run. Try again."; return; }
      finally { restarting = false; }
      if (controller.signal.aborted) return;
    }
    hasStarted = true;
    runResults.splice(0);
    runFinished = false;
    resultsStage.hide();
    setupPanel.hidden = true;
    playPanel.hidden = false;
    updateCategorySetup();
    void loadRound();
  }

  /** Back to the category setup. Discards any run in progress (callers confirm first). */
  function showSetup(): void {
    if (isDailyChallenge || ranked) return;
    hasStarted = false;
    loadSequence += 1;
    runResults.splice(0);
    runFinished = false;
    activeTarget = null;
    activeResult = null;
    isSubmitting = false;
    isLoading = false;
    resultsStage.hide();
    resultPanel.hidden = true;
    resultPanel.replaceChildren();
    infoOverlay.hide();
    globe.reset();
    globe.setAcceptingGuesses(false);
    playPanel.hidden = true;
    setupPanel.hidden = false;
    renderRunProgress();
    updateCategorySetup();
    categoryInputs.values().next().value?.focus();
  }

  /** "Change categories" mid-run goes through the same guard as leaving: the run is discarded. */
  async function requestSetup(): Promise<void> {
    if (runInProgressMessage() && !(await shell.confirmLeave(
      `You're ${runResults.length} of ${runLength} targets into this run. Changing categories discards it and the score isn't kept.`,
      { title: "Change categories?", confirmLabel: "Discard run", cancelLabel: "Keep playing", tone: "danger" },
    ))) return;
    if (controller.signal.aborted) return;
    showSetup();
  }

  function runInProgressMessage(): string | null {
    if (!hasStarted || runFinished) return null;
    return runLeaveMessage(runResults.length, runLength, "targets");
  }

  for (const [category, input] of categoryInputs) {
    input.addEventListener("change", () => {
      if (input.checked) selectedCategoryIds.add(category);
      else selectedCategoryIds.delete(category);
      updateCategorySetup();
    }, { signal: controller.signal });
  }
  toggleAllButton.addEventListener("click", () => {
    const shouldSelectAll = selectedCategoryIds.size !== CATEGORIES.length;
    selectedCategoryIds.clear();
    for (const [category, input] of categoryInputs) {
      input.checked = shouldSelectAll;
      if (shouldSelectAll) selectedCategoryIds.add(category);
    }
    updateCategorySetup();
  }, { signal: controller.signal });
  startButton.addEventListener("click", startRun, { signal: controller.signal });
  changeCategoriesButton.addEventListener("click", () => void requestSetup(), { signal: controller.signal });
  resetButton.addEventListener("click", () => {
    if (activeResult || isSubmitting || isLoading) return;
    if (!activeTarget) { void loadRound(); return; }
    statusText.textContent = "View reset. Click once as close as you can.";
    globe.reset();
    globe.setAcceptingGuesses(true);
  }, { signal: controller.signal });
  newRoundButton.addEventListener("click", () => {
    if (isDailyChallenge) {
      if (!activeResult || dailyCompleted) return;
      dailyCompleted = true;
      options.dailyChallenge?.onComplete(activeResult);
      return;
    }
    if (runResults.length >= runLength) {
      showResults();
      return;
    }
    void loadRound();
  }, { signal: controller.signal });

  const setupPanel = el("section", {
    className: "maptap-setup",
    attrs: { "aria-label": "MapTap setup", ...(isDailyChallenge || ranked ? { hidden: "true" } : {}) },
    children: [
      el("div", {
        className: "maptap-setup-heading",
        children: [
          el("span", { className: "eyebrow", text: "MapTap setup" }),
          el("h1", { text: "What do you want to find?" }),
          el("p", { text: `Pick one category or mix several. Each of the ${runLength} targets is drawn from your selection.` }),
        ],
      }),
      el("fieldset", { className: "maptap-category-grid", children: [el("legend", { text: "Location categories" }), ...categoryOptions] }),
      el("div", { className: "maptap-setup-toolbar", children: [selectionSummary, toggleAllButton] }),
      el("div", {
        className: "maptap-setup-options",
        children: [
          el("label", { children: [el("span", { className: "stat-label", text: "Difficulty" }), difficultySelect] }),
          el("label", { children: [el("span", { className: "stat-label", text: "Score range" }), decayInput] }),
        ],
      }),
      startButton,
    ],
  });
  const playPanel = el("div", {
    className: "maptap-play-panel",
    attrs: isDailyChallenge || ranked ? {} : { hidden: "true" },
    children: [
      el("div", { className: "panel-title", children: [el("span", { className: "eyebrow", text: isDailyChallenge ? `${options.dailyChallenge?.practice ? "Daily practice" : "Daily challenge"} · MapTap` : ranked ? "MapTap · Ranked attempt" : "MapTap" }), el("h1", { text: "Click on:" }), promptTarget, promptMeta] }),
      runProgress,
      statusText,
      el("div", { className: "maptap-current-selection", attrs: isDailyChallenge ? { hidden: "true" } : {}, children: [el("span", { className: "stat-label", text: "Playing" }), activeCategoriesLabel] }),
      el("div", { className: "maptap-actions", attrs: isDailyChallenge ? { hidden: "true" } : {}, children: ranked ? [resetButton] : [resetButton, changeCategoriesButton] }),
      resultPanel,
    ],
  });

  const layout = el("section", {
    className: "maptap-layout",
    children: [
      el("div", { className: "maptap-map-panel", children: [globe.element, infoOverlay.element] }),
      el("aside", { className: "maptap-sidebar", children: [setupPanel, playPanel] }),
    ],
  });
  const resultsStage = createResultsStage(layout);

  const element = el("section", { className: "game-screen maptap-screen gb-screen" });
  const bar = isDailyChallenge
    ? createDailyStageBar(element, {
        stage: "MapTap",
        ...(options.dailyChallenge?.title ? { title: options.dailyChallenge.title } : {}),
        practice: options.dailyChallenge?.practice ?? false,
        ...(options.dailyChallenge?.progress ? { progress: options.dailyChallenge.progress } : {}),
        onLeave: options.onHome,
      })
    : ranked
    ? createRankedBar(element, shell, { gameMode: "map-tap", inProgress: () => hasStarted && !runFinished })
    : createPracticeBar(element, shell, {
        gameMode: "map-tap",
        leaveGuard: runInProgressMessage,
        extraMenuItems: [
          { label: "Restart run", icon: "rotate-ccw", onSelect: () => { if (hasStarted) startRun(); } },
          { label: "Change categories", icon: "layout-grid", onSelect: () => void requestSetup() },
        ],
      });
  element.append(bar.element, layout, resultsStage.element);

  updateCategorySetup();
  renderRunProgress();
  if (isDailyChallenge || ranked) void loadRound();

  return {
    element,
    destroy: () => {
      controller.abort();
      if ("destroy" in bar) bar.destroy();
    },
  };
}
