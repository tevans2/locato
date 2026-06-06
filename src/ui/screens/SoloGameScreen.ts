import type { Country, CountryIndex } from "../../core/countries";
import { getCurrentCountry, type GameEngine, type GameEvent, type GameState } from "../../core/game";
import type { GameMode } from "../../core/modes";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createBoardView, revealCountryOnBoard, resetBoardView, updateContinentCounts, type BoardView } from "../dom/renderBoard";
import { createFeedbackView, showFeedback, type FeedbackView } from "../dom/renderFeedback";
import { createFlagView, updateFlagView, type FlagView } from "../dom/renderFlag";
import { createStatsView, updateStatsView, type StatsView } from "../dom/renderStats";

export interface SoloGameScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly engine: GameEngine;
  readonly mode: GameMode;
  readonly onHome: () => void;
  readonly onStateChange: (state: GameState) => void;
  readonly onReset: () => void;
}

interface SoloViews {
  readonly stats: StatsView;
  readonly flag: FlagView;
  readonly feedback: FeedbackView;
  readonly board: BoardView;
}

function visibleCountries(index: CountryIndex, state: GameState): readonly Country[] {
  const ids = new Set(state.poolCountryIds);
  return index.countries.filter((country) => ids.has(country.id));
}

function applyEvents(events: readonly GameEvent[], views: SoloViews, index: CountryIndex): void {
  for (const event of events) {
    if (event.type === "GUESS_CORRECT") {
      const country = index.byId[event.countryId];
      if (country) {
        revealCountryOnBoard(views.board, country);
        showFeedback(views.feedback, `Correct: ${country.name}. +${event.points} points.`, "good");
      }
      continue;
    }

    if (event.type === "GUESS_WRONG") {
      showFeedback(views.feedback, "Not quite. Streak reset, flag still live.", "bad");
      continue;
    }

    if (event.type === "ROUND_SKIPPED") {
      showFeedback(views.feedback, "Skipped. Streak reset — this flag can return later.", "neutral");
      continue;
    }

    if (event.type === "HINT_REVEALED") {
      const wordLabel = event.hint.wordCount === 1 ? "word" : "words";
      showFeedback(views.feedback, `Hint: starts with ${event.hint.firstLetter}, ${event.hint.letterCount} letters, ${event.hint.wordCount} ${wordLabel}.`, "neutral");
      continue;
    }

    if (event.type === "GAME_COMPLETED") {
      showFeedback(views.feedback, "Complete. Every flag in this mode has been solved.", "good");
    }
  }
}

export function createSoloGameScreen(options: SoloGameScreenOptions): Screen {
  const controller = new AbortController();
  const { countryIndex, engine, mode } = options;
  const initialState = engine.getState();
  const countries = visibleCountries(countryIndex, initialState);
  const stats = createStatsView();
  const flag = createFlagView();
  const feedback = createFeedbackView();
  const board = createBoardView(countries);
  const views: SoloViews = { stats, flag, feedback, board };
  const input = el("input", {
    attrs: { id: "guess-input", name: "guess", type: "text", autocomplete: "off", autocapitalize: "words", spellcheck: "false", placeholder: "e.g. Brazil, Japan, ZA..." },
  });
  const submitButton = el("button", { className: "primary-action", text: "Lock in", attrs: { type: "submit" } });
  const hintButton = el("button", { className: "secondary-action", text: "Hint", attrs: { type: "button" } });
  const skipButton = el("button", { className: "secondary-action", text: "Skip", attrs: { type: "button" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart", attrs: { type: "button" } });

  hintButton.toggleAttribute("disabled", !mode.hints.enabled);
  skipButton.toggleAttribute("disabled", !mode.allowSkip);

  const form = el("form", {
    className: "guess-form",
    children: [el("label", { text: "Your guess", attrs: { for: "guess-input" } }), el("div", { className: "input-row", children: [input, submitButton] })],
  });

  function render(): void {
    const state = engine.getState();
    const current = getCurrentCountry(countryIndex, state);
    updateStatsView(stats, countryIndex, state);
    updateFlagView(flag, current, state.roundNumber);
    updateContinentCounts(board, countries, state.guessedCountryIds);
    input.disabled = state.status !== "playing";
    submitButton.disabled = state.status !== "playing";
    hintButton.disabled = state.status !== "playing" || !mode.hints.enabled;
    skipButton.disabled = state.status !== "playing" || !mode.allowSkip;
    options.onStateChange(state);
  }

  function dispatchAndRender(events: readonly GameEvent[]): void {
    applyEvents(events, views, countryIndex);
    render();
    if (events.some((event) => event.type === "GUESS_CORRECT")) input.value = "";
    if (engine.getState().status === "playing") input.focus();
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

  hintButton.addEventListener("click", () => dispatchAndRender(engine.dispatch({ type: "REQUEST_HINT", now: Date.now() })), { signal: controller.signal });
  skipButton.addEventListener("click", () => dispatchAndRender(engine.dispatch({ type: "SKIP_ROUND", now: Date.now() })), { signal: controller.signal });
  resetButton.addEventListener(
    "click",
    () => {
      resetBoardView(board);
      options.onReset();
      dispatchAndRender(engine.dispatch({ type: "RESET_GAME", now: Date.now() }));
      showFeedback(feedback, "Fresh run started.", "neutral");
    },
    { signal: controller.signal },
  );

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

  for (const countryId of initialState.guessedCountryIds) {
    const country = countryIndex.byId[countryId];
    if (country) revealCountryOnBoard(board, country);
  }

  const element = el("section", {
    className: "game-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("button", { className: "ghost-action", text: "← Home", on: { click: options.onHome } }),
          el("div", { children: [el("p", { className: "eyebrow", text: mode.label }), el("h1", { text: "Flag Rush" })] }),
        ],
      }),
      stats.element,
      el("div", {
        className: "play-layout",
        children: [
          flag.element,
          el("aside", {
            className: "answer-panel",
            children: [
              el("div", { className: "panel-title", children: [el("h2", { text: "What country is this?" }), el("p", { text: mode.description })] }),
              form,
              feedback.element,
              el("div", { className: "actions", children: [hintButton, skipButton, resetButton] }),
            ],
          }),
        ],
      }),
      el("section", { className: "board-panel", children: [el("div", { className: "board-heading", children: [el("h2", { text: "Continent board" }), el("span", { text: "Correct guesses reveal countries by region." })] }), board.element] }),
    ],
  });

  render();
  showFeedback(feedback, initialState.lastResult?.message ?? "First flag is ready. Type the country when you know it.", "neutral");

  return {
    element,
    destroy: () => controller.abort(),
  };
}
