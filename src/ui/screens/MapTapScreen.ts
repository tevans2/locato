import type { Screen } from "../../app/router";
import { fetchMapTapRound, fetchWikipediaSummary, MAP_TAP_DEFAULT_DECAY_KM, validateMapTapGuess, type MapTapCategory, type MapTapDifficulty, type MapTapGuessResult, type MapTapRoundTarget } from "../../core/maptap";
import type { GameModeId } from "../../core/gameModes";
import { el } from "../dom/createElement";
import { createGameModeDropdown } from "../dom/gameModeDropdown";
import { createMapTapGlobe, type MapTapClick } from "../components/MapTapGlobe";
import { createMapTapInfoOverlay } from "../components/MapTapInfoOverlay";

export interface MapTapScreenOptions {
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onMultiplayer?: () => void;
  readonly onDailyChallenge?: () => void;
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

function createLogo(): HTMLElement {
  return el("div", {
    className: "brand-lockup compact",
    children: [el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }), el("span", { className: "brand-name", text: "locato" })],
  });
}

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
  let activeTarget: MapTapRoundTarget | null = null;
  let activeResult: MapTapGuessResult | null = null;
  let isSubmitting = false;

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
  const decayInput = el("input", {
    className: "maptap-decay-input",
    attrs: { id: "maptap-decay", name: "maptapDecay", type: "number", min: "100", max: "10000", step: "100", value: String(MAP_TAP_DEFAULT_DECAY_KM), "aria-label": "MapTap score decay in kilometres" },
  });

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
    categorySelect.disabled = disabled;
    difficultySelect.disabled = disabled;
    decayInput.disabled = disabled;
    newRoundButton.disabled = disabled;
    resetButton.disabled = disabled || activeResult === null;
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
    resultPanel.replaceChildren(
      newRoundButton,
      el("div", { className: "maptap-result-score", children: [el("span", { text: "Score" }), el("strong", { text: `${result.score.toLocaleString()}/${result.maxScore.toLocaleString()}` })] }),
      el("div", { className: "maptap-result-stat", children: [el("span", { text: "Distance" }), el("strong", { text: formatDistance(result.distanceKm) })] }),
      el("div", { className: "maptap-result-stat", children: [el("span", { text: "Actual" }), el("strong", { text: `${result.target.name} (${result.target.lat.toFixed(4)}, ${result.target.lng.toFixed(4)})` })] }),
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

    const target = await fetchMapTapRound({ category: selectedCategory(), difficulty: selectedDifficulty() });
    if (controller.signal.aborted) return;

    if (!target) {
      statusText.textContent = "Could not load a MapTap target. Make sure the Bun server is running so /api/maptap/round is available.";
      setControlsDisabled(false);
      return;
    }

    activeTarget = target;
    renderTarget(target);
    statusText.textContent = "Rotate or zoom the globe, then click once as close as you can.";
    globe.reset();
    globe.setAcceptingGuesses(true);
    setControlsDisabled(false);
  }

  async function submitGuess(point: MapTapClick): Promise<void> {
    if (!activeTarget || activeResult || isSubmitting) return;
    isSubmitting = true;
    globe.setAcceptingGuesses(false);
    setControlsDisabled(true);
    statusText.textContent = "Checking your guess...";

    const result = await validateMapTapGuess({
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
    statusText.textContent = "Result revealed.";
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
    statusText.textContent = activeTarget ? "Target restarted. Click once as close as you can." : "Loading a target...";
    globe.reset();
    globe.setAcceptingGuesses(activeTarget !== null);
    setControlsDisabled(false);
  }, { signal: controller.signal });
  newRoundButton.addEventListener("click", () => void loadRound(), { signal: controller.signal });
  dailyButton.addEventListener("click", () => options.onDailyChallenge?.(), { signal: controller.signal });
  multiplayerButton.addEventListener("click", () => options.onMultiplayer?.(), { signal: controller.signal });

  const element = el("section", {
    className: "game-screen maptap-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("div", { className: "game-header-left", children: [createLogo(), gameModeDropdown.element] }),
          el("div", { className: "game-header-actions", children: [dailyButton, multiplayerButton] }),
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
                children: [
                  el("label", { children: [el("span", { className: "stat-label", text: "Category" }), categorySelect] }),
                  el("label", { children: [el("span", { className: "stat-label", text: "Difficulty" }), difficultySelect] }),
                  el("label", { children: [el("span", { className: "stat-label", text: "Decay km" }), decayInput] }),
                ],
              }),
              el("div", { className: "maptap-actions", children: [resetButton] }),
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
