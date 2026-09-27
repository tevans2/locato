import type { ShellContext } from "../shell/types";
import type { Screen } from "../../app/router";
import { fetchMapTapRound, fetchWikipediaSummary, isValidLatLng, MAP_TAP_DEFAULT_DECAY_KM, MAP_TAP_MAX_SCORE, normalizeLongitude, scoreMapTapGuess, validateMapTapGuess, type MapTapCategory, type MapTapDifficulty, type MapTapGuessResult, type MapTapLocation, type MapTapRoundTarget } from "../../core/maptap";
import { describeMapTapSkill, difficultyForSkill, defaultMapTapSkill, readMapTapSkill, recordMapTapResult, saveMapTapSkill } from "../../core/maptap/skill";
import type { GameModeId } from "../../core/gameModes";
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
  // When provided, casual rounds pick targets from an adaptive difficulty ramp persisted
  // across visits. Daily challenge rounds are unaffected.
  readonly storage?: Storage;
  readonly dailyChallenge?: {
    readonly date: string;
    readonly target: MapTapLocation;
    readonly onComplete: (result: MapTapGuessResult) => void;
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
}

const CATEGORIES: readonly { readonly value: "" | MapTapCategory; readonly label: string }[] = [
  { value: "", label: "All categories" },
  { value: "city", label: "Cities" },
  { value: "mountain", label: "Mountains" },
  { value: "poi", label: "Points of interest" },
  { value: "landmark", label: "Landmarks" },
];

const DIFFICULTIES: readonly { readonly value: "" | MapTapDifficulty; readonly label: string }[] = [
  { value: "", label: "All difficulties" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

function formatCategory(category: MapTapCategory): string {
  if (category === "poi") return "Point of interest";
  return category.charAt(0).toUpperCase() + category.slice(1);
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
  let activeTarget: MapTapRoundTarget | null = null;
  let activeResult: MapTapGuessResult | null = null;
  let isSubmitting = false;
  let isLoading = false;
  let dailyCompleted = false;
  let skill = options.storage ? readMapTapSkill(options.storage) : defaultMapTapSkill;
  let adaptiveRoundIndex = 0;
  /** This practice run's scored targets (never more than MAP_TAP_RUN_LENGTH). */
  const runResults: MapTapGuessResult[] = [];
  let runFinished = false;

  const promptTarget = el("strong", { text: "Loading..." });
  const promptMeta = el("span", { className: "maptap-prompt-meta", text: "" });
  const runLabel = el("span", { className: "maptap-run-label" });
  const runTotal = el("strong", { className: "maptap-run-total", text: "0" });
  const runDots = Array.from({ length: MAP_TAP_RUN_LENGTH }, () => el("span", { className: "maptap-run-dot" }));
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
  const categorySelect = el("select", {
    className: "maptap-filter-select",
    attrs: { id: "maptap-category", name: "maptapCategory", "aria-label": "MapTap category" },
    children: optionNodes(CATEGORIES),
  });
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

  const globe = services.createGlobe({
    signal: controller.signal,
    onGuess: (point) => {
      void submitGuess(point);
    },
  });

  const infoOverlay = services.createInfoOverlay();

  function selectedCategory(): MapTapCategory | "" {
    return categorySelect.value as MapTapCategory | "";
  }

  function selectedDifficulty(): MapTapDifficulty | "" {
    return difficultySelect.value as MapTapDifficulty | "";
  }

  function selectedDecayKm(): number {
    const parsed = Number(decayInput.value);
    return Number.isFinite(parsed) ? parsed : MAP_TAP_DEFAULT_DECAY_KM;
  }

  function setControlsDisabled(disabled: boolean): void {
    // Filters change the *next* target; once a pin is revealed they wait for "Next target".
    const lockFilters = disabled || isDailyChallenge || activeResult !== null;
    categorySelect.disabled = lockFilters;
    difficultySelect.disabled = lockFilters;
    decayInput.disabled = lockFilters;
    newRoundButton.disabled = disabled;
    // Reset only recentres the globe before you pin. Once the answer is revealed it stays
    // disabled — re-pinning a revealed target would let players inflate their skill.
    resetButton.disabled = disabled || isDailyChallenge || activeResult !== null || isSubmitting;
  }

  function renderRunProgress(): void {
    if (isDailyChallenge) return;
    const scored = runResults.length;
    const current = Math.min(MAP_TAP_RUN_LENGTH, scored + (activeResult ? 0 : 1));
    runLabel.textContent = `Target ${current} of ${MAP_TAP_RUN_LENGTH}`;
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
    const lastOfRun = !isDailyChallenge && runResults.length >= MAP_TAP_RUN_LENGTH;
    newRoundButton.textContent = isDailyChallenge ? "Continue daily challenge" : lastOfRun ? "See results" : "Next target";
    const insideZone = result.distanceKm <= result.toleranceKm;
    const zoneNote = insideZone ? ` — right in the ${formatNumber(result.toleranceKm)} km target zone` : "";
    const verdict = result.score / result.maxScore >= 0.6 ? "Great pin!" : insideZone ? "Nailed the area!" : "Not quite — trace the line on the globe, then try the next one.";
    resultPanel.replaceChildren(
      newRoundButton,
      el("p", { className: "maptap-result-verdict", text: `${verdict} ${result.target.name} is highlighted on the globe.` }),
      el("div", { className: "maptap-result-score", children: [el("span", { text: "Score" }), el("strong", { text: `${formatNumber(result.score)}/${formatNumber(result.maxScore)}` })] }),
      el("div", { className: "maptap-result-stat", children: [el("span", { text: "Distance" }), el("strong", { text: `${formatKm(result.distanceKm)}${zoneNote}` })] }),
      el("div", { className: "maptap-result-stat", children: [el("span", { text: "Actual" }), el("strong", { text: `${result.target.name} (${formatCategory(result.target.category)})` })] }),
    );
  }

  async function loadRound(): Promise<void> {
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

    // Explicit difficulty filter wins; otherwise casual rounds ride the adaptive ramp.
    const adaptiveDifficulty = !isDailyChallenge && selectedDifficulty() === "" && options.storage
      ? difficultyForSkill(skill.level, adaptiveRoundIndex)
      : selectedDifficulty();
    const target = options.dailyChallenge?.target ?? (await services.fetchRound({ category: selectedCategory(), difficulty: adaptiveDifficulty }).catch(() => null));
    if (controller.signal.aborted) return;
    isLoading = false;

    if (!target) {
      statusText.textContent = "We couldn’t find a target. Check your connection, then try again.";
      setControlsDisabled(false);
      resetButton.textContent = "Try again";
      return;
    }

    activeTarget = target;
    renderTarget(target);
    if (!isDailyChallenge) {
      adaptiveRoundIndex += 1;
      statusText.textContent = `Rotate or zoom the globe, then click once as close as you can. ${describeMapTapSkill(skill.level)}`;
    } else {
      statusText.textContent = "Daily MapTap: click once as close as you can.";
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
          decayKm: selectedDecayKm(),
        }).catch(() => null);
    if (controller.signal.aborted) return;

    isSubmitting = false;

    if (!result) {
      setControlsDisabled(false);
      statusText.textContent = "Could not validate that guess. Try the same target again.";
      globe.setAcceptingGuesses(true);
      return;
    }

    activeResult = result;
    if (!isDailyChallenge) {
      runResults.push(result);
      if (options.storage) {
        skill = recordMapTapResult(skill, result.score / result.maxScore);
        saveMapTapSkill(options.storage, skill);
      }
    }
    setControlsDisabled(false);
    renderRunProgress();
    statusText.textContent = isDailyChallenge
      ? "Result revealed. Continue to the next daily round."
      : describeMapTapSkill(skill.level);
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
    const maximum = runResults.reduce((sum, item) => sum + item.maxScore, 0) || MAP_TAP_RUN_LENGTH * MAP_TAP_MAX_SCORE;
    const averageKm = runResults.reduce((sum, item) => sum + item.distanceKm, 0) / Math.max(1, runResults.length);
    const best = runResults.reduce<MapTapGuessResult | null>((top, item) => (!top || item.score > top.score ? item : top), null);
    const localBest = recordLocalBest(options.storage, MAP_TAP_BEST_RUN_KEY, total);
    const ratio = total / maximum;

    const card = createResultsCard(shell, {
      kicker: "MapTap · Practice",
      title: localBest.isNew && localBest.previous > 0 ? "A new best run!" : ratio >= 0.7 ? "Superb pinning" : ratio >= 0.45 ? "Solid run" : "Run complete",
      subtitle: `${MAP_TAP_RUN_LENGTH} targets, ${formatNumber(total)} of ${formatNumber(maximum)} points.`,
      stats: [
        { label: "Total score", value: formatNumber(total), note: `of ${formatNumber(maximum)}` },
        { label: "Average distance", value: formatKm(averageKm) },
        ...(best ? [{ label: "Best round", value: formatNumber(best.score), note: best.target.name }] : []),
        { label: "Your best run", value: formatNumber(localBest.best), note: localBest.isNew ? "New best" : "On this device" },
      ],
      primary: { label: "Play again", onClick: startRun },
      share: {
        title: "Locato MapTap",
        text: `Locato MapTap ${formatNumber(total)}/${formatNumber(maximum)}\n${runResults.map((item) => shareSquare(item.score / item.maxScore)).join("")}\nAverage ${formatKm(averageKm)} off\nlocato.quest`,
      },
      tone: ratio >= 0.45 ? "celebrate" : "neutral",
    });
    insertIntoResults(card, createRunList("Your targets", runResults.map((item) => ({
      label: item.target.name,
      detail: `${formatCategory(item.target.category)} · ${formatKm(item.distanceKm)} away`,
      value: formatNumber(item.score),
      tone: item.score / item.maxScore >= 0.6 ? "good" : item.score / item.maxScore >= 0.25 ? "ok" : "miss",
    }))));
    resultsStage.show(card);
  }

  function startRun(): void {
    runResults.splice(0);
    runFinished = false;
    resultsStage.hide();
    void loadRound();
  }

  categorySelect.addEventListener("change", () => void loadRound(), { signal: controller.signal });
  difficultySelect.addEventListener("change", () => void loadRound(), { signal: controller.signal });
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
    if (runResults.length >= MAP_TAP_RUN_LENGTH) {
      showResults();
      return;
    }
    void loadRound();
  }, { signal: controller.signal });

  const layout = el("section", {
    className: "maptap-layout",
    children: [
      el("div", { className: "maptap-map-panel", children: [globe.element, infoOverlay.element] }),
      el("aside", {
        className: "maptap-sidebar",
        children: [
          el("div", { className: "panel-title", children: [el("span", { className: "eyebrow", text: isDailyChallenge ? "Daily challenge · MapTap" : "MapTap" }), el("h1", { text: "Click on:" }), promptTarget, promptMeta] }),
          runProgress,
          statusText,
          el("div", {
            className: "maptap-filters",
            attrs: isDailyChallenge ? { hidden: "true" } : {},
            children: [
              el("label", { children: [el("span", { className: "stat-label", text: "Category" }), categorySelect] }),
              el("label", { children: [el("span", { className: "stat-label", text: "Difficulty" }), difficultySelect] }),
              el("label", { children: [el("span", { className: "stat-label", text: "Scoring" }), decayInput] }),
            ],
          }),
          el("div", { className: "maptap-actions", attrs: isDailyChallenge ? { hidden: "true" } : {}, children: [resetButton] }),
          resultPanel,
        ],
      }),
    ],
  });
  const resultsStage = createResultsStage(layout);

  const element = el("section", { className: "game-screen maptap-screen gb-screen" });
  const bar = isDailyChallenge
    ? createDailyStageBar(element, {
        stage: "MapTap",
        ...(options.dailyChallenge?.progress ? { progress: options.dailyChallenge.progress } : {}),
        onLeave: options.onHome,
      })
    : createPracticeBar(element, shell, {
        gameMode: "map-tap",
        leaveGuard: () => (runFinished ? null : runLeaveMessage(runResults.length, MAP_TAP_RUN_LENGTH, "targets")),
        extraMenuItems: [{ label: "Restart run", icon: "rotate-ccw", onSelect: startRun }],
      });
  element.append(bar.element, layout, resultsStage.element);

  renderRunProgress();
  void loadRound();

  return {
    element,
    destroy: () => {
      controller.abort();
      if ("destroy" in bar) bar.destroy();
    },
  };
}
