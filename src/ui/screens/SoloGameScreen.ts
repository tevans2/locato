import { type Country, type CountryIndex } from "../../core/countries";
import { getCategory } from "../../core/categories";
import { DAILY_COUNTRY_COUNT, type DailyRoundMark } from "../../core/dailyChallenge";
import { isPromptGameModeId, type GameModeId } from "../../core/gameModes";
import { getCurrentCountry, TOTAL_HINTS, type GameEngine, type GameEvent, type GameState } from "../../core/game";
import type { Screen } from "../../app/router";
import type { AuthControls } from "../components/AuthPanel";
import { createGameModeDropdown } from "../dom/gameModeDropdown";
import { el } from "../dom/createElement";
import { createAtlasView, setAtlasOpen, updateAtlasView, type AtlasView } from "../dom/renderAtlas";
import { createFeedbackView, showFeedback, type FeedbackView } from "../dom/renderFeedback";
import { createPromptView, updatePromptView, type PromptView } from "../dom/renderPrompt";
import { createStatsView, updateStatsView, type StatsView } from "../dom/renderStats";

export interface SoloGameScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly engine: GameEngine;
  readonly selectedGameMode: GameModeId;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onStateChange: (state: GameState) => void;
  readonly onReset: () => void;
  readonly onMultiplayer: () => void;
  readonly onDailyChallenge: () => void;
  readonly authControls?: AuthControls;
  readonly dailyChallenge?: {
    readonly date: string;
    readonly onComplete: (result: { readonly score: number; readonly timeMs: number; readonly hintsUsed: number; readonly marks: readonly DailyRoundMark[] }) => void;
  };
}

interface SoloViews {
  readonly stats: StatsView;
  readonly prompt: PromptView;
  readonly feedback: FeedbackView;
  readonly atlas: AtlasView;
}

function visibleCountries(index: CountryIndex, state: GameState): readonly Country[] {
  const ids = new Set(state.poolCountryIds);
  return index.countries.filter((country) => ids.has(country.id));
}

function applyEvents(events: readonly GameEvent[], views: SoloViews, index: CountryIndex): void {
  for (const event of events) {
    if (event.type === "GUESS_CORRECT") {
      const country = index.byId[event.countryId];
      if (country) showFeedback(views.feedback, `Correct: ${country.name}. +${event.points} points.`, "good");
      continue;
    }

    if (event.type === "GUESS_WRONG") {
      showFeedback(views.feedback, "Not quite. Streak reset, prompt still live.", "bad");
      continue;
    }

    if (event.type === "ROUND_SKIPPED") {
      showFeedback(views.feedback, "Skipped. Streak reset — this prompt can return later.", "neutral");
      continue;
    }

    if (event.type === "HINT_REVEALED") {
      showFeedback(views.feedback, `${event.hint.title}: ${event.hint.message}`, "neutral");
      continue;
    }

    if (event.type === "ANSWER_REVEALED") {
      const country = index.byId[event.countryId];
      if (country) showFeedback(views.feedback, `Answer: ${country.name}.`, "bad");
      continue;
    }

    if (event.type === "GAME_COMPLETED") {
      showFeedback(views.feedback, "Complete. Every prompt in this mix has been solved.", "good");
      continue;
    }
  }
}

export function createSoloGameScreen(options: SoloGameScreenOptions): Screen {
  const controller = new AbortController();
  const { countryIndex, engine } = options;
  const isDailyChallenge = options.dailyChallenge !== undefined;
  const initialState = engine.getState();
  const countries = visibleCountries(countryIndex, initialState);
  const dailyMarks: DailyRoundMark[] = [];
  let dailyHintsUsed = 0;
  let dailyRoundHadHint = false;
  let dailyCompleted = false;
  const stats = createStatsView();
  const prompt = createPromptView();
  const feedback = createFeedbackView();
  const atlas = createAtlasView(countries);
  const views: SoloViews = { stats, prompt, feedback, atlas };
  const input = el("input", {
    attrs: { id: "guess-input", name: "guess", type: "text", autocomplete: "off", autocapitalize: "words", spellcheck: "false", placeholder: "e.g. Brazil, Japan, ZA..." },
  });
  const submitButton = el("button", { className: "primary-action", text: "Lock in", attrs: { type: "submit" } });
  const hintButton = el("button", { className: "secondary-action", text: "Hint", attrs: { type: "button" } });
  const skipButton = el("button", { className: "secondary-action", text: "Skip", attrs: { type: "button" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart", attrs: { type: "button" } });
  const multiplayerButton = el("button", { className: "ghost-action", text: "Multiplayer", attrs: { type: "button" } });
  const dailyButton = el("button", { className: "ghost-action daily-action", text: "Daily Challenge", attrs: { type: "button", ...(isDailyChallenge ? { disabled: "" } : {}) } });

  const gameModeDropdown = createGameModeDropdown({
    selectedMode: options.selectedGameMode,
    signal: controller.signal,
    onChange: (gameMode) => {
      if (isPromptGameModeId(gameMode) && gameMode === engine.getState().categoryIds[0] && engine.getState().categoryIds.length === 1) return;
      options.onGameModeChange(gameMode);
    },
  });

  const form = el("form", {
    className: "guess-form",
    children: [el("label", { text: "Your guess", attrs: { for: "guess-input" } }), el("div", { className: "input-row", children: [input, submitButton] })],
  });

  function render(persist = true): void {
    const state = engine.getState();
    const current = getCurrentCountry(countryIndex, state);
    const category = state.currentCategoryId ? getCategory(state.currentCategoryId) : undefined;
    const content = current && category ? category.prompt(current) : null;
    updateStatsView(stats, countryIndex, state);
    updatePromptView(prompt, content, state.roundNumber, category?.label ?? "Prompt");
    updateAtlasView(atlas, countries, state.guessedCountryIds);
    const playing = state.status === "playing";
    input.disabled = !playing;
    submitButton.disabled = !playing;
    hintButton.disabled = !playing;
    hintButton.textContent = state.hintLevel >= TOTAL_HINTS ? "Reveal answer" : "Hint";
    skipButton.disabled = !playing;
    if (persist) options.onStateChange(state);
  }

  function dispatchAndRender(events: readonly GameEvent[], persist = true): void {
    if (isDailyChallenge) recordDailyEvents(events);
    applyEvents(events, views, countryIndex);
    render(persist);
    if (events.some((event) => event.type === "GUESS_CORRECT")) input.value = "";
    if (engine.getState().status === "playing") input.focus();
    if (isDailyChallenge) completeDailyIfNeeded(events);
  }

  function recordDailyEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === "HINT_REVEALED") {
        dailyHintsUsed += 1;
        dailyRoundHadHint = true;
        continue;
      }

      if (event.type === "GUESS_CORRECT") {
        dailyMarks.push(dailyRoundHadHint ? "hint" : "correct");
        dailyRoundHadHint = false;
        continue;
      }

      if (event.type === "ANSWER_REVEALED" || event.type === "ROUND_SKIPPED") {
        dailyMarks.push("miss");
        dailyRoundHadHint = false;
      }
    }
  }

  function completeDailyIfNeeded(events: readonly GameEvent[]): void {
    if (!options.dailyChallenge || dailyCompleted || !events.some((event) => event.type === "GAME_COMPLETED")) return;

    dailyCompleted = true;
    const state = engine.getState();
    const marks = [...dailyMarks];
    while (marks.length < DAILY_COUNTRY_COUNT) marks.push("miss");

    options.dailyChallenge.onComplete({
      score: state.correctAnswers,
      timeMs: Math.max(0, (state.endedAt ?? Date.now()) - (state.startedAt ?? Date.now())),
      hintsUsed: dailyHintsUsed,
      marks: marks.slice(0, DAILY_COUNTRY_COUNT),
    });
  }

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      dispatchAndRender(engine.dispatch({ type: "SUBMIT_GUESS", value: input.value, now: Date.now() }));
      if (engine.getState().lastResult?.type === "wrong") input.select();
    },
    { signal: controller.signal },
  );

  input.addEventListener(
    "input",
    () => {
      const events = engine.dispatch({ type: "SUBMIT_GUESS", value: input.value, now: Date.now(), auto: true });
      if (events.length > 0) dispatchAndRender(events);
    },
    { signal: controller.signal },
  );

  hintButton.addEventListener(
    "click",
    () => {
      const command = engine.getState().hintLevel >= TOTAL_HINTS ? ({ type: "REVEAL_ANSWER", now: Date.now() } as const) : ({ type: "REQUEST_HINT", now: Date.now() } as const);
      dispatchAndRender(engine.dispatch(command));
    },
    { signal: controller.signal },
  );
  skipButton.addEventListener("click", () => dispatchAndRender(engine.dispatch(isDailyChallenge ? { type: "REVEAL_ANSWER", now: Date.now() } : { type: "SKIP_ROUND", now: Date.now() })), { signal: controller.signal });
  resetButton.addEventListener(
    "click",
    () => {
      setAtlasOpen(atlas, false);
      updateAtlasView(atlas, countries, new Set());
      options.onReset();
      dispatchAndRender(engine.dispatch({ type: "RESET_GAME", now: Date.now() }));
      showFeedback(feedback, "Fresh run started.", "neutral");
    },
    { signal: controller.signal },
  );
  multiplayerButton.addEventListener("click", options.onMultiplayer, { signal: controller.signal });
  dailyButton.addEventListener("click", options.onDailyChallenge, { signal: controller.signal });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") input.value = "";
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "h") {
        event.preventDefault();
        hintButton.click();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight") {
        event.preventDefault();
        skipButton.click();
      }
    },
    { signal: controller.signal },
  );

  updateAtlasView(atlas, countries, initialState.guessedCountryIds);
  const logo = el("div", {
    className: "brand-lockup compact",
    children: [el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }), el("span", { className: "brand-name", text: "locato" })],
  });

  atlas.openButton.addEventListener("click", () => setAtlasOpen(atlas, true), { signal: controller.signal });
  atlas.closeButton.addEventListener("click", () => setAtlasOpen(atlas, false), { signal: controller.signal });
  atlas.overlay.addEventListener("click", () => setAtlasOpen(atlas, false), { signal: controller.signal });

  const element = el("section", {
    className: "game-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("div", { className: "game-header-left", children: [logo, isDailyChallenge ? el("div", { className: "daily-badge", text: `Daily ${options.dailyChallenge?.date ?? ""}` }) : gameModeDropdown.element] }),
          el("div", { className: "game-header-actions", children: [dailyButton, multiplayerButton, ...(options.authControls ? [options.authControls.trigger] : [])] }),
        ],
      }),
      el("div", {
        className: "play-layout",
        children: [
          prompt.element,
          el("aside", {
            className: "answer-panel",
            children: [
              el("div", { className: "panel-title", children: [el("h2", { text: "Name the place" })] }),
              form,
              stats.element,
              feedback.element,
              el("div", { className: "actions", children: [hintButton, skipButton, ...(isDailyChallenge ? [] : [resetButton]), atlas.element] }),
            ],
          }),
        ],
      }),
    ],
  });

  render();
  showFeedback(feedback, initialState.lastResult?.message ?? "First prompt is ready. Type the country when you know it.", "neutral");

  return {
    element,
    destroy: () => {
      controller.abort();
    },
  };
}
