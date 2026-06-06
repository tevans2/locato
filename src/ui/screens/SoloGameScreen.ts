import { CONTINENTS, type Continent, type Country, type CountryIndex } from "../../core/countries";
import { getCurrentCountry, type GameEngine, type GameEvent, type GameState } from "../../core/game";
import type { GameMode, GameModeId } from "../../core/modes";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createAtlasView, setAtlasOpen, updateAtlasView, type AtlasView } from "../dom/renderAtlas";
import { createFeedbackView, showFeedback, type FeedbackView } from "../dom/renderFeedback";
import { createFlagView, updateFlagView, type FlagView } from "../dom/renderFlag";
import { createStatsView, updateStatsView, type StatsView } from "../dom/renderStats";

export interface SoloGameScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly engine: GameEngine;
  readonly mode: GameMode;
  readonly modes: readonly GameMode[];
  readonly onModeChange: (modeId: GameModeId, continent?: Continent) => void;
  readonly onStateChange: (state: GameState) => void;
  readonly onReset: () => void;
}

interface SoloViews {
  readonly stats: StatsView;
  readonly flag: FlagView;
  readonly feedback: FeedbackView;
  readonly atlas: AtlasView;
}

function visibleCountries(index: CountryIndex, state: GameState): readonly Country[] {
  const ids = new Set(state.poolCountryIds);
  return index.countries.filter((country) => ids.has(country.id));
}

function applyEvents(events: readonly GameEvent[], views: SoloViews, index: CountryIndex): void {
  const timerExpired = events.some((event) => event.type === "TIMER_EXPIRED");
  for (const event of events) {
    if (event.type === "GUESS_CORRECT") {
      const country = index.byId[event.countryId];
      if (country) showFeedback(views.feedback, `Correct: ${country.name}. +${event.points} points.`, "good");
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
      showFeedback(views.feedback, `${event.hint.title}: ${event.hint.message}`, "neutral");
      continue;
    }

    if (event.type === "GAME_COMPLETED") {
      if (!timerExpired) showFeedback(views.feedback, "Complete. Every flag in this mode has been solved.", "good");
      continue;
    }

    if (event.type === "TIMER_EXPIRED") {
      showFeedback(views.feedback, "Time. Final score locked.", "neutral");
      continue;
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
  const atlas = createAtlasView(countries);
  const views: SoloViews = { stats, flag, feedback, atlas };
  const input = el("input", {
    attrs: { id: "guess-input", name: "guess", type: "text", autocomplete: "off", autocapitalize: "words", spellcheck: "false", placeholder: "e.g. Brazil, Japan, ZA..." },
  });
  const submitButton = el("button", { className: "primary-action", text: "Lock in", attrs: { type: "submit" } });
  const startButton = el("button", { className: "primary-action start-action", text: "Start timed rush", attrs: { type: "button" } });
  const hintButton = el("button", { className: "secondary-action", text: "Hint", attrs: { type: "button" } });
  const skipButton = el("button", { className: "secondary-action", text: "Skip", attrs: { type: "button" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart", attrs: { type: "button" } });
  const modeSelect = el("select", {
    className: "mode-select",
    attrs: { "aria-label": "Game mode" },
    children: options.modes.map((gameMode) => el("option", { text: gameMode.label, attrs: { value: gameMode.id } })),
  });
  modeSelect.value = mode.id;

  const continentSelect = el("select", {
    className: "mode-select",
    attrs: { "aria-label": "Continent" },
    children: CONTINENTS.map((continent) => el("option", { text: continent, attrs: { value: continent } })),
  });
  const firstPoolCountryId = initialState.poolCountryIds[0];
  continentSelect.value = mode.id === "continent" && firstPoolCountryId !== undefined ? countryIndex.byId[firstPoolCountryId]?.continent ?? "Africa" : "Africa";
  continentSelect.hidden = mode.id !== "continent";
  const modeDescription = el("p", { className: "mode-description", text: mode.description });


  modeSelect.addEventListener(
    "change",
    () => {
      const nextModeId = modeSelect.value as GameModeId;
      options.onModeChange(nextModeId, nextModeId === "continent" ? (continentSelect.value as Continent) : undefined);
    },
    { signal: controller.signal },
  );

  continentSelect.addEventListener(
    "change",
    () => options.onModeChange("continent", continentSelect.value as Continent),
    { signal: controller.signal },
  );

  hintButton.toggleAttribute("disabled", !mode.hints.enabled);
  skipButton.toggleAttribute("disabled", !mode.allowSkip);

  const form = el("form", {
    className: "guess-form",
    children: [el("label", { text: "Your guess", attrs: { for: "guess-input" } }), el("div", { className: "input-row", children: [input, submitButton] })],
  });

  function render(persist = true): void {
    const state = engine.getState();
    const current = getCurrentCountry(countryIndex, state);
    updateStatsView(stats, countryIndex, state);
    updateFlagView(flag, current, state.roundNumber, state.status);
    updateAtlasView(atlas, countries, state.guessedCountryIds);
    startButton.hidden = state.status !== "idle";
    input.disabled = state.status !== "playing";
    submitButton.disabled = state.status !== "playing";
    hintButton.disabled = state.status !== "playing" || !mode.hints.enabled;
    skipButton.disabled = state.status !== "playing" || !mode.allowSkip;
    if (persist) options.onStateChange(state);
  }

  function dispatchAndRender(events: readonly GameEvent[], persist = true): void {
    applyEvents(events, views, countryIndex);
    render(persist);
    if (events.some((event) => event.type === "GUESS_CORRECT")) input.value = "";
    if (engine.getState().status === "playing") input.focus();
  }

  const timerId =
    mode.durationSeconds === undefined
      ? null
      : window.setInterval(() => {
          const events = engine.dispatch({ type: "TICK", now: Date.now() });
          if (events.length > 0) dispatchAndRender(events);
          else if (engine.getState().status === "playing") render(false);
        }, 250);

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

  startButton.addEventListener(
    "click",
    () => {
      dispatchAndRender(engine.dispatch({ type: "START_GAME", modeId: mode.id, seed: engine.getState().seed, now: Date.now() }));
      showFeedback(feedback, "Timed Rush started. Two minutes.", "neutral");
    },
    { signal: controller.signal },
  );
  hintButton.addEventListener("click", () => dispatchAndRender(engine.dispatch({ type: "REQUEST_HINT", now: Date.now() })), { signal: controller.signal });
  skipButton.addEventListener("click", () => dispatchAndRender(engine.dispatch({ type: "SKIP_ROUND", now: Date.now() })), { signal: controller.signal });
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
    children: [
      el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }),
      el("span", { className: "brand-name", text: "locato" }),
    ],
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
          logo,
          el("div", { className: "mode-controls", children: [el("div", { className: "mode-select-row", children: [modeSelect, continentSelect] }), modeDescription] }),
        ],
      }),
      el("div", {
        className: "play-layout",
        children: [
          flag.element,
          el("aside", {
            className: "answer-panel",
            children: [
              el("div", { className: "panel-title", children: [el("h2", { text: "Name the place" })] }),
              startButton,
              form,
              stats.element,
              feedback.element,
              el("div", { className: "actions", children: [hintButton, skipButton, resetButton, atlas.element] }),
            ],
          }),
        ],
      }),
    ],
  });

  render();
  showFeedback(feedback, initialState.lastResult?.message ?? (initialState.status === "idle" ? "Timed Rush is ready. Press start to reveal the first flag." : "First flag is ready. Type the country when you know it."), "neutral");

  return {
    element,
    destroy: () => {
      if (timerId !== null) window.clearInterval(timerId);
      controller.abort();
    },
  };
}
