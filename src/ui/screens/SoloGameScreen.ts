import type { AuthUser } from "../../core/auth";
import { isCorrectAnswer, type Country, type CountryIndex } from "../../core/countries";
import { getCategory } from "../../core/categories";
import { DAILY_COUNTRY_COUNT, scoreDailyRound, type DailyRoundMark } from "../../core/dailyChallenge";
import { isPromptGameModeId, type GameModeId } from "../../core/gameModes";
import { getCurrentCountry, TOTAL_HINTS, type GameEngine, type GameEvent, type GameState } from "../../core/game";
import type { WorldCountryFeature } from "../../core/map";
import { timerKeysForMode } from "../../core/timer/keys";
import { formatTimerCompletionSuffix, submitTimerToLeaderboard } from "../../core/timer/leaderboardSync";
import { createPlayTimer, formatElapsedTime, formatStoredTime, type PlayTimer, type PlayTimerMode } from "../../core/timer/playTimer";
import { recordSoloAchievements, type Achievement } from "../../storage/achievements";
import type { Screen } from "../../app/router";
import type { AuthControls } from "../components/AuthPanel";
import { createGameModeDropdown } from "../dom/gameModeDropdown";
import { el } from "../dom/createElement";
import { createAtlasView, setAtlasOpen, updateAtlasView, type AtlasView } from "../dom/renderAtlas";
import { createFeedbackView, showFeedback, type FeedbackView } from "../dom/renderFeedback";
import { createPromptView, updatePromptView, type PromptView } from "../dom/renderPrompt";
import { createStatsView, updateStatsView, type StatsView } from "../dom/renderStats";
import { createFlagColorRevealView } from "../dom/renderFlagColorReveal";
import { createWorldMapView, setWorldMapTargetCountry, updateWorldMapView, type WorldMapView } from "../dom/renderWorldMap";

export interface SoloGameScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly engine: GameEngine;
  readonly selectedGameMode: GameModeId;
  readonly storage: Storage;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onStateChange: (state: GameState) => void;
  readonly onReset: () => void;
  readonly onMultiplayer: () => void;
  readonly onDailyChallenge: () => void;
  readonly onExitDailyChallenge?: () => void;
  readonly onViewStats?: () => void;
  readonly onLeaderboard: () => void;
  readonly getAuthUser: () => AuthUser | null;
  readonly authControls?: AuthControls;
  readonly worldCountryFeatures?: readonly WorldCountryFeature[];
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

function countryForGuess(index: CountryIndex, answer: string): Country | null {
  for (const country of index.countries) {
    if (isCorrectAnswer(index, country.id, answer)) return country;
  }
  return null;
}

export function createSoloGameScreen(options: SoloGameScreenOptions): Screen {
  const controller = new AbortController();
  const { countryIndex, engine } = options;
  const isDailyChallenge = options.dailyChallenge !== undefined;
  const initialState = engine.getState();
  const countries = visibleCountries(countryIndex, initialState);
  const dailyMarks: DailyRoundMark[] = [];
  let dailyHintsUsed = 0;
  let dailyRoundHintsUsed = 0;
  let dailyScore = 0;
  let dailyCompleted = false;
  const stats = createStatsView();
  const prompt = createPromptView();
  const flagColorReveal = createFlagColorRevealView();
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
  const exitDailyButton = el("button", { className: "ghost-action", text: "Back to modes", attrs: { type: "button" } });
  const leaderboardButton = el("button", { className: "ghost-action", text: "Leaderboards", attrs: { type: "button" } });
  const timerModeSelect = el("select", {
    className: "country-guess-timer-select",
    attrs: { id: "solo-timer-mode", name: "timerMode", "aria-label": "Solo timer mode" },
    children: [
      el("option", { text: "Practice", attrs: { value: "off" } }),
      el("option", { text: "Timer", attrs: { value: "count-up" } }),
    ],
  });
  const timerElapsed = el("strong", { className: "stat-value", text: "—" });
  const timerLast = el("strong", { className: "stat-value", text: "—" });
  const timerBest = el("strong", { className: "stat-value", text: "—" });
  const achievementPanel = el("section", { className: "achievement-panel compact", attrs: { hidden: "true" } });
  const timerPanel = el("div", {
    className: "stats-panel country-guess-stats solo-timer-stats",
    children: [
      el("div", {
        className: "stat-card country-guess-mode-card",
        children: [el("label", { className: "stat-label", text: "Mode", attrs: { for: "solo-timer-mode" } }), timerModeSelect],
      }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Time" }), timerElapsed] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Previous" }), timerLast] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Best" }), timerBest] }),
    ],
  });

  let playTimer: PlayTimer;
  let activeFlagColorTarget: string | null = null;
  const dailyMap =
    options.worldCountryFeatures && options.worldCountryFeatures.length > 0
      ? createWorldMapView(options.worldCountryFeatures, countryIndex, {
          onCountryClick: (countryId) => {
            const state = engine.getState();
            const current = getCurrentCountry(countryIndex, state);
            const category = state.currentCategoryId ? getCategory(state.currentCategoryId) : undefined;
            if (state.status !== "playing" || !current || category?.prompt(current).kind !== "map-click") return;
            const clickedCountry = countryIndex.byId[countryId];
            if (!clickedCountry) return;
            dispatchAndRender(engine.dispatch({ type: "SUBMIT_GUESS", value: clickedCountry.code, now: Date.now() }));
          },
        })
      : null;

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

  function renderTimer(): void {
    timerModeSelect.value = playTimer.mode;
    timerPanel.classList.toggle("timer-is-active", playTimer.mode === "count-up");
    timerElapsed.textContent = playTimer.mode === "count-up" ? formatElapsedTime(playTimer.currentElapsedMs()) : "—";
    timerLast.textContent = formatStoredTime(playTimer.readLast());
    timerBest.textContent = formatStoredTime(playTimer.readBest());
  }

  async function finishTimerRun(finalTimeMs: number): Promise<{ readonly isNewLocalBest: boolean; readonly serverAccepted: boolean | null }> {
    const isNewLocalBest = playTimer.writeCompletion(finalTimeMs);
    const serverAccepted = await submitTimerToLeaderboard({
      gameMode: options.selectedGameMode,
      variant: "",
      timeMs: finalTimeMs,
      isLoggedIn: options.getAuthUser() !== null,
    });
    return { isNewLocalBest, serverAccepted };
  }

  function applyEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === "GUESS_CORRECT") {
        playTimer.startIfNeeded();
        const country = countryIndex.byId[event.countryId];
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
        const country = countryIndex.byId[event.countryId];
        if (country) showFeedback(views.feedback, `Answer: ${country.name}.`, "bad");
        continue;
      }

      if (event.type === "GAME_COMPLETED") {
        if (!isDailyChallenge) showAchievements(recordSoloAchievements(options.storage, { completed: true, wrongAnswers: engine.getState().wrongAnswers, bestStreak: engine.getState().bestStreak, gameMode: options.selectedGameMode }));
        if (playTimer.mode === "count-up") {
          const finalTimeMs = playTimer.stop();
          void finishTimerRun(finalTimeMs).then((result) => {
            showFeedback(
              views.feedback,
              `Complete. Every prompt solved in ${formatTimerCompletionSuffix(finalTimeMs, result, options.getAuthUser() !== null)}`,
              "good",
            );
          });
        } else {
          showFeedback(
            views.feedback,
            "Complete. Every prompt in this mix has been solved. Switch to Timer mode to post a time to the leaderboard.",
            "good",
          );
        }
      }
    }
  }

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

  function resetRun(message: string): void {
    setAtlasOpen(atlas, false);
    updateAtlasView(atlas, countries, new Set());
    options.onReset();
    playTimer.reset();
    dispatchAndRender(engine.dispatch({ type: "RESET_GAME", now: Date.now() }));
    showFeedback(feedback, message, "neutral");
  }

  function render(persist = true): void {
    const state = engine.getState();
    const current = getCurrentCountry(countryIndex, state);
    const category = state.currentCategoryId ? getCategory(state.currentCategoryId) : undefined;
    const content = current && category ? category.prompt(current) : null;
    updateStatsView(stats, countryIndex, state);
    if ((content?.kind === "map-click" || content?.kind === "map-highlight") && dailyMap) {
      activeFlagColorTarget = null;
      prompt.status.textContent = `Round ${state.roundNumber}`;
      prompt.kicker.textContent = category?.label ?? "Map";
      prompt.imageSlot.replaceChildren(
        el("div", {
          className: "daily-map-prompt",
          children: [
            el("div", { className: "prompt-text daily-map-prompt-text", text: content.kind === "map-click" ? `Click ${content.value}` : "Spot the highlighted country" }),
            dailyMap.element,
          ],
        }),
      );
      updateWorldMapView(dailyMap, state.guessedCountryIds, countries.length);
      const targetId = current?.id ?? null;
      setWorldMapTargetCountry(dailyMap, content.kind === "map-highlight" ? targetId : null);
      if (content.kind === "map-highlight" && targetId !== null) dailyMap.focusCountry(targetId);
    } else if (content?.kind === "flag-colors") {
      prompt.status.textContent = `Round ${state.roundNumber}`;
      prompt.kicker.textContent = category?.label ?? "Flag colours";
      if (activeFlagColorTarget !== content.value) {
        activeFlagColorTarget = content.value;
        flagColorReveal.reset(content.value);
      }
      prompt.imageSlot.replaceChildren(flagColorReveal.element);
    } else {
      activeFlagColorTarget = null;
      if (dailyMap) setWorldMapTargetCountry(dailyMap, null);
      updatePromptView(prompt, content, state.roundNumber, category?.label ?? "Prompt");
    }
    updateAtlasView(atlas, countries, state.guessedCountryIds);
    const playing = state.status === "playing";
    input.disabled = !playing;
    submitButton.disabled = !playing;
    hintButton.disabled = !playing;
    hintButton.textContent = state.hintLevel >= TOTAL_HINTS ? "Reveal answer" : "Hint";
    skipButton.disabled = !playing;
    renderTimer();
    if (persist) options.onStateChange(state);
  }

  function dispatchAndRender(events: readonly GameEvent[], persist = true): void {
    if (isDailyChallenge) recordDailyEvents(events);
    applyEvents(events);
    render(persist);
    if (events.some((event) => event.type === "GUESS_CORRECT")) input.value = "";
    if (engine.getState().status === "playing") input.focus();
    if (isDailyChallenge) completeDailyIfNeeded(events);
  }

  function recordDailyEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === "HINT_REVEALED") {
        dailyHintsUsed += 1;
        dailyRoundHintsUsed += 1;
        continue;
      }

      if (event.type === "GUESS_CORRECT") {
        dailyScore += scoreDailyRound(dailyRoundHintsUsed);
        dailyMarks.push(dailyRoundHintsUsed > 0 ? "hint" : "correct");
        dailyRoundHintsUsed = 0;
        continue;
      }

      if (event.type === "ANSWER_REVEALED" || event.type === "ROUND_SKIPPED") {
        dailyScore += scoreDailyRound(dailyRoundHintsUsed, true);
        dailyMarks.push("miss");
        dailyRoundHintsUsed = 0;
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
      score: dailyScore,
      timeMs: Math.max(0, (state.endedAt ?? Date.now()) - (state.startedAt ?? Date.now())),
      hintsUsed: dailyHintsUsed,
      marks: marks.slice(0, DAILY_COUNTRY_COUNT),
    });
  }

  playTimer = createPlayTimer({
    storage: options.storage,
    keys: timerKeysForMode(options.selectedGameMode),
    isComplete: () => engine.getState().status === "complete",
    onTick: renderTimer,
  });

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      if (engine.getState().currentCategoryId === "flag-colors") {
        const guessedCountry = countryForGuess(countryIndex, input.value);
        if (guessedCountry) flagColorReveal.addGuess(guessedCountry.flagSrc);
      }
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
      resetRun(playTimer.mode === "count-up" ? "Timer reset. Start with your first correct answer." : "Fresh run started.");
    },
    { signal: controller.signal },
  );
  timerModeSelect.addEventListener(
    "change",
    () => {
      const nextMode: PlayTimerMode = timerModeSelect.value === "count-up" ? "count-up" : "off";
      playTimer.setMode(nextMode);
      resetRun(nextMode === "count-up" ? "Timer mode ready. The clock starts on your first correct answer." : "Practice mode ready.");
    },
    { signal: controller.signal },
  );
  multiplayerButton.addEventListener("click", options.onMultiplayer, { signal: controller.signal });
  dailyButton.addEventListener("click", options.onDailyChallenge, { signal: controller.signal });
  exitDailyButton.addEventListener("click", () => options.onExitDailyChallenge?.(), { signal: controller.signal });
  leaderboardButton.addEventListener("click", options.onLeaderboard, { signal: controller.signal });

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
          el("div", {
            className: "game-header-actions",
            children: [dailyButton, leaderboardButton, multiplayerButton, ...(options.authControls ? [options.authControls.trigger] : [])],
          }),
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
              timerPanel,
              stats.element,
              feedback.element,
              achievementPanel,
              el("div", { className: "actions", children: [hintButton, skipButton, ...(isDailyChallenge ? [exitDailyButton] : [resetButton]), atlas.element] }),
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
      playTimer.destroy();
      controller.abort();
    },
  };
}
