import { createMobileGameNav } from "../dom/mobileGameNav";
import type { Screen } from "../../app/router";
import { fetchMapTapRound, fetchWikipediaSummary, isValidLatLng, MAP_TAP_DEFAULT_DECAY_KM, MAP_TAP_MAX_SCORE, normalizeLongitude, scoreMapTapGuess, validateMapTapGuess, type MapTapCategory, type MapTapDifficulty, type MapTapGuessResult, type MapTapLocation, type MapTapRoundTarget } from "../../core/maptap";
import { describeMapTapSkill, difficultyForSkill, defaultMapTapSkill, readMapTapSkill, recordMapTapResult, saveMapTapSkill } from "../../core/maptap/skill";
import type { GameModeId } from "../../core/gameModes";
import { el } from "../dom/createElement";
import { createGameModeDropdown } from "../dom/gameModeDropdown";
import { createMapTapGlobe, type MapTapClick } from "../components/MapTapGlobe";
import { createMapTapInfoOverlay } from "../components/MapTapInfoOverlay";
import { createBrandLockup } from "../dom/createBrandLockup";

export interface MapTapScreenOptions {
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
  };
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

function formatDistance(distanceKm: number): string {
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm).toLocaleString()} km`;
}

function formatCategory(category: MapTapCategory): string {
  if (category === "poi") return "Point of interest";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function optionNodes<T extends string>(items: readonly { readonly value: T; readonly label: string }[]): readonly HTMLOptionElement[] {
  return items.map((item) => el("option", { text: item.label, attrs: { value: item.value } }));
}

export function createMapTapScreen(options: MapTapScreenOptions): Screen {
  const controller = new AbortController();
  const mobileNav = createMobileGameNav(options, controller.signal);
  const isDailyChallenge = options.dailyChallenge !== undefined;
  let activeTarget: MapTapRoundTarget | null = null;
  let activeResult: MapTapGuessResult | null = null;
  let isSubmitting = false;
  let dailyCompleted = false;
  let skill = options.storage ? readMapTapSkill(options.storage) : defaultMapTapSkill;
  let adaptiveRoundIndex = 0;
  const gameModeDropdown = createGameModeDropdown({
    selectedMode: "map-tap",
    signal: controller.signal,
    name: "maptap-game-mode",
    onChange: options.onGameModeChange,
  });

  const promptTarget = el("strong", { text: "Loading..." });
  const promptMeta = el("span", { className: "maptap-prompt-meta", text: "" });
  const statusText = el("p", { className: "maptap-status", attrs: { role: "status" }, text: "Loading a target..." });
  const resultPanel = el("section", { className: "maptap-result-panel", attrs: { hidden: "true" } });
  const newRoundButton = el("button", { className: "primary-action", text: "Next target", attrs: { type: "button" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart target", attrs: { type: "button" } });
  const dailyButton = el("button", { className: "ghost-action nav-action daily-action", text: "Daily Challenge", attrs: { type: "button", "aria-label": "Open daily challenge", ...(options.onDailyChallenge ? {} : { hidden: "true" }) } });
  const multiplayerButton = el("button", { className: "ghost-action nav-action", text: "Multiplayer", attrs: { type: "button", "aria-label": "Open multiplayer", ...(options.onMultiplayer ? {} : { hidden: "true" }) } });
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

  const globe = createMapTapGlobe({
    signal: controller.signal,
    onGuess: (point) => {
      void submitGuess(point);
    },
  });

  const infoOverlay = createMapTapInfoOverlay();

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
    categorySelect.disabled = disabled || isDailyChallenge;
    difficultySelect.disabled = disabled || isDailyChallenge;
    decayInput.disabled = disabled || isDailyChallenge;
    newRoundButton.disabled = disabled;
    resetButton.disabled = disabled || activeResult === null || isDailyChallenge;
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
    newRoundButton.textContent = isDailyChallenge ? "Continue daily challenge" : "Next target";
    const insideZone = result.distanceKm <= result.toleranceKm;
    const zoneNote = insideZone ? ` — right in the ${Math.round(result.toleranceKm).toLocaleString()} km target zone` : "";
    const verdict = result.score / result.maxScore >= 0.6 ? "Great pin!" : insideZone ? "Nailed the area!" : "Not quite — trace the line on the globe, then try the next one.";
    resultPanel.replaceChildren(
      newRoundButton,
      el("p", { className: "maptap-result-verdict", text: `${verdict} ${result.target.name} is highlighted on the globe.` }),
      el("div", { className: "maptap-result-score", children: [el("span", { text: "Score" }), el("strong", { text: `${result.score.toLocaleString()}/${result.maxScore.toLocaleString()}` })] }),
      el("div", { className: "maptap-result-stat", children: [el("span", { text: "Distance" }), el("strong", { text: `${formatDistance(result.distanceKm)}${zoneNote}` })] }),
      el("div", { className: "maptap-result-stat", children: [el("span", { text: "Actual" }), el("strong", { text: `${result.target.name} (${formatCategory(result.target.category)})` })] }),
    );
  }

  async function loadRound(): Promise<void> {
    activeTarget = null;
    activeResult = null;
    isSubmitting = false;
    resultPanel.hidden = true;
    resultPanel.replaceChildren();
    infoOverlay.hide();
    globe.reset();
    globe.setAcceptingGuesses(false);
    setControlsDisabled(true);
    renderTarget(null);
    statusText.textContent = "Loading a target...";

    // Explicit difficulty filter wins; otherwise casual rounds ride the adaptive ramp.
    const adaptiveDifficulty = !isDailyChallenge && selectedDifficulty() === "" && options.storage
      ? difficultyForSkill(skill.level, adaptiveRoundIndex)
      : selectedDifficulty();
    const target = options.dailyChallenge?.target ?? (await fetchMapTapRound({ category: selectedCategory(), difficulty: adaptiveDifficulty }));
    if (controller.signal.aborted) return;

    if (!target) {
      statusText.textContent = "We couldn’t find a target. Check your connection, then try again.";
      setControlsDisabled(false);
      resetButton.disabled = false;
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
    if (!activeTarget || activeResult || isSubmitting) return;
    isSubmitting = true;
    globe.setAcceptingGuesses(false);
    setControlsDisabled(true);
    statusText.textContent = "Checking your guess...";

    const result = options.dailyChallenge
      ? buildDailyResult(point)
      : await validateMapTapGuess({
          targetId: activeTarget.id,
          guessLat: point.lat,
          guessLng: point.lng,
          decayKm: selectedDecayKm(),
        });
    if (controller.signal.aborted) return;

    isSubmitting = false;
    setControlsDisabled(false);

    if (!result) {
      statusText.textContent = "Could not validate that guess. Try the same target again.";
      globe.setAcceptingGuesses(true);
      return;
    }

    activeResult = result;
    setControlsDisabled(false);
    if (!isDailyChallenge && options.storage) {
      skill = recordMapTapResult(skill, result.score / result.maxScore);
      saveMapTapSkill(options.storage, skill);
    }
    statusText.textContent = isDailyChallenge
      ? "Result revealed. Continue to the next daily round."
      : describeMapTapSkill(skill.level);
    globe.reveal(result);
    renderResult(result);
    void fetchWikipediaSummary(result.target.wikiSlug, controller.signal).then((summary) => {
      if (controller.signal.aborted || activeResult !== result) return;
      infoOverlay.show(result.target.name, summary);
    });
  }

  categorySelect.addEventListener("change", () => void loadRound(), { signal: controller.signal });
  difficultySelect.addEventListener("change", () => void loadRound(), { signal: controller.signal });
  resetButton.addEventListener("click", () => {
    activeResult = null;
    resultPanel.hidden = true;
    resultPanel.replaceChildren();
    if (!activeTarget) { void loadRound(); return; }
    statusText.textContent = "Target restarted. Click once as close as you can.";
    globe.reset();
    globe.setAcceptingGuesses(activeTarget !== null);
    setControlsDisabled(false);
  }, { signal: controller.signal });
  newRoundButton.addEventListener("click", () => {
    if (isDailyChallenge) {
      if (!activeResult || dailyCompleted) return;
      dailyCompleted = true;
      options.dailyChallenge?.onComplete(activeResult);
      return;
    }
    void loadRound();
  }, { signal: controller.signal });
  dailyButton.addEventListener("click", () => options.onDailyChallenge?.(), { signal: controller.signal });
  multiplayerButton.addEventListener("click", () => options.onMultiplayer?.(), { signal: controller.signal });

  const element = el("section", {
    className: "game-screen maptap-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("div", { className: "game-header-left", children: [createBrandLockup(options.onHome), gameModeDropdown.element] }),
          el("div", { className: "game-header-actions", children: [dailyButton, multiplayerButton, mobileNav.button, mobileNav.sheet] }),
        ],
      }),
      el("section", {
        className: "maptap-layout",
        children: [
          el("div", { className: "maptap-map-panel", children: [globe.element, infoOverlay.element] }),
          el("aside", {
            className: "maptap-sidebar",
            children: [
              el("div", { className: "panel-title", children: [el("span", { className: "eyebrow", text: "MapTap" }), el("h1", { text: "Click on:" }), promptTarget, promptMeta] }),
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
      }),
    ],
  });

  void loadRound();

  return {
    element,
    destroy: () => {
      controller.abort();
    },
  };
}
