import { createMobileGameNav } from "../dom/mobileGameNav";
import type { Screen } from "../../app/router";
import { fetchMapTapRound, fetchWikipediaSummary, isValidLatLng, MAP_TAP_CATEGORY_OPTIONS, MAP_TAP_DEFAULT_DECAY_KM, MAP_TAP_LOCATIONS, MAP_TAP_MAX_SCORE, normalizeLongitude, scoreMapTapGuess, validateMapTapGuess, type MapTapCategory, type MapTapDifficulty, type MapTapGuessResult, type MapTapLocation, type MapTapRoundTarget } from "../../core/maptap";
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

const CATEGORIES = MAP_TAP_CATEGORY_OPTIONS;

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
  const labels: Record<MapTapCategory, string> = {
    city: "City",
    region: "Region",
    mountain: "Mountain",
    "mountain-range": "Mountain range",
    ocean: "Ocean or sea",
    poi: "Natural wonder",
    landmark: "Landmark",
  };
  return labels[category];
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
  let hasStarted = isDailyChallenge;
  const selectedCategoryIds = new Set<MapTapCategory>(CATEGORIES.map((category) => category.value));
  let skill = options.storage ? readMapTapSkill(options.storage) : defaultMapTapSkill;
  let adaptiveRoundIndex = 0;

  const gameModeDropdown = createGameModeDropdown({
    selectedMode: "map-tap",
    signal: controller.signal,
    name: "maptap-game-mode",
    onChange: options.onGameModeChange,
  });

  const promptTarget = el("strong", { text: isDailyChallenge ? "Loading..." : "Ready when you are" });
  const promptMeta = el("span", { className: "maptap-prompt-meta", text: "" });
  const statusText = el("p", { className: "maptap-status", attrs: { role: "status" }, text: isDailyChallenge ? "Loading a target..." : "Choose the places you want to play." });
  const resultPanel = el("section", { className: "maptap-result-panel", attrs: { hidden: "true" } });
  const newRoundButton = el("button", { className: "primary-action", text: "Next target", attrs: { type: "button" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart target", attrs: { type: "button" } });
  const dailyButton = el("button", { className: "ghost-action nav-action daily-action", text: "Daily Challenge", attrs: { type: "button", "aria-label": "Open daily challenge", ...(options.onDailyChallenge ? {} : { hidden: "true" }) } });
  const multiplayerButton = el("button", { className: "ghost-action nav-action", text: "Multiplayer", attrs: { type: "button", "aria-label": "Open multiplayer", ...(options.onMultiplayer ? {} : { hidden: "true" }) } });
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
  const startButton = el("button", { className: "primary-action maptap-start-action", text: "Start MapTap", attrs: { type: "button" } });
  const toggleAllButton = el("button", { className: "ghost-action maptap-toggle-all", text: "Clear all", attrs: { type: "button" } });
  const changeCategoriesButton = el("button", { className: "ghost-action", text: "Change categories", attrs: { type: "button" } });
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
  decayInput.value = String(MAP_TAP_DEFAULT_DECAY_KM);


  const globe = createMapTapGlobe({
    signal: controller.signal,
    onGuess: (point) => {
      void submitGuess(point);
    },
  });

  const infoOverlay = createMapTapInfoOverlay();

  function selectedCategories(): readonly MapTapCategory[] {
    return CATEGORIES.map((category) => category.value).filter((category) => selectedCategoryIds.has(category));
  }

  function selectedDifficulty(): MapTapDifficulty | "" {
    return difficultySelect.value as MapTapDifficulty | "";
  }

  function selectedDecayKm(): number {
    const parsed = Number(decayInput.value);
    return Number.isFinite(parsed) ? parsed : MAP_TAP_DEFAULT_DECAY_KM;
  }

  function setControlsDisabled(disabled: boolean): void {
    difficultySelect.disabled = disabled || isDailyChallenge;
    decayInput.disabled = disabled || isDailyChallenge;
    newRoundButton.disabled = disabled;
    resetButton.disabled = disabled || activeResult === null || isDailyChallenge;
    changeCategoriesButton.disabled = disabled || isDailyChallenge;
  }

  function updateCategorySetup(): void {
    const categories = selectedCategories();
    const locationCount = MAP_TAP_LOCATIONS.filter((location) => selectedCategoryIds.has(location.category)).length;
    selectionSummary.textContent = categories.length === 0
      ? "Choose at least one category to start."
      : `${locationCount} locations across ${categories.length} ${categories.length === 1 ? "category" : "categories"}`;
    activeCategoriesLabel.textContent = categories.length === CATEGORIES.length
      ? "All location types"
      : categories.map((category) => CATEGORIES.find((item) => item.value === category)?.label ?? category).join(", ");
    startButton.disabled = categories.length === 0;
    toggleAllButton.textContent = categories.length === CATEGORIES.length ? "Clear all" : "Select all";
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
    if (!hasStarted) return;
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
    const categories = selectedCategories();
    const category = categories[Math.floor(Math.random() * categories.length)];
    const target = options.dailyChallenge?.target ?? (category ? await fetchMapTapRound({ category, difficulty: adaptiveDifficulty }) : null);

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
  startButton.addEventListener("click", () => {
    if (selectedCategoryIds.size === 0) return;
    hasStarted = true;
    setupPanel.hidden = true;
    playPanel.hidden = false;
    updateCategorySetup();
    void loadRound();
  }, { signal: controller.signal });
  changeCategoriesButton.addEventListener("click", () => {
    hasStarted = false;
    activeTarget = null;
    activeResult = null;
    resultPanel.hidden = true;
    infoOverlay.hide();
    globe.reset();
    globe.setAcceptingGuesses(false);
    playPanel.hidden = true;
    setupPanel.hidden = false;
    updateCategorySetup();
  }, { signal: controller.signal });
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

  const setupPanel = el("section", {
    className: "maptap-setup",
    attrs: isDailyChallenge ? { hidden: "true" } : {},
    children: [
      el("div", { className: "maptap-setup-heading", children: [el("span", { className: "eyebrow", text: "MapTap setup" }), el("h1", { text: "What do you want to find?" }), el("p", { text: "Pick one category or mix several. Each round will choose from your selection." })] }),
      el("fieldset", { className: "maptap-category-grid", children: [el("legend", { text: "Location categories" }), ...categoryOptions] }),
      el("div", { className: "maptap-setup-toolbar", children: [selectionSummary, toggleAllButton] }),
      el("div", {
        className: "maptap-setup-options",
        children: [
          el("label", { children: [el("span", { className: "stat-label", text: "Difficulty" }), difficultySelect] }),
          el("label", { children: [el("span", { className: "stat-label", text: "Score range (km)" }), decayInput] }),
        ],
      }),
      startButton,
    ],
  });
  const playPanel = el("div", {
    className: "maptap-play-panel",
    attrs: isDailyChallenge ? {} : { hidden: "true" },
    children: [
      el("div", { className: "panel-title", children: [el("span", { className: "eyebrow", text: "MapTap" }), el("h1", { text: "Click on:" }), promptTarget, promptMeta] }),
      statusText,
      el("div", { className: "maptap-current-selection", attrs: isDailyChallenge ? { hidden: "true" } : {}, children: [el("span", { className: "stat-label", text: "Playing" }), activeCategoriesLabel] }),
      el("div", { className: "maptap-actions", attrs: isDailyChallenge ? { hidden: "true" } : {}, children: [resetButton, changeCategoriesButton] }),
      resultPanel,
    ],
  });

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
            children: [setupPanel, playPanel],

          }),
        ],
      }),
    ],
  });

  updateCategorySetup();
  if (isDailyChallenge) void loadRound();

  return {
    element,
    destroy: () => {
      controller.abort();
    },
  };
}
