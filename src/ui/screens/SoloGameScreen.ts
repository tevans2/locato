import type { AuthUser } from "../../core/auth";
import type { RunType, ShellContext } from "../shell/types";
import { isCorrectAnswer, type Country, type CountryId, type CountryIndex } from "../../core/countries";
import { buildPromptSlots, getCategory, type PromptSlot, type PromptContent } from "../../core/categories";
import type { RankedSession } from "./RankedSession";
import { matchesCapitalName } from "../../core/categories/matching";
import { DAILY_COUNTRY_COUNT, scoreDailyRound, type DailyRoundMark, type DailyRoundResult } from "../../core/dailyChallenge";
import { DEFAULT_FLAG_POOL, type FlagPool } from "../../core/flagPools";
import { getGameModeOption, isLeaderboardMode, type GameModeId, type PromptGameModeId } from "../../core/gameModes";
import { getCurrentCountry, TOTAL_HINTS, type GameEngine, type GameEvent, type GameState } from "../../core/game";
import type { WorldCountryFeature } from "../../core/map";
import { timerKeysForMode } from "../../core/timer/keys";
import { formatTimerCompletionSuffix, postTimedRun } from "../../core/timer/leaderboardSync";
import { createPlayTimer, formatElapsedTime, formatStoredTime, type PlayTimer } from "../../core/timer/playTimer";
import { recordSoloAchievements, type Achievement } from "../../storage/achievements";
import type { Screen } from "../../app/router";
import type { AuthControls } from "../components/AuthPanel";
import { createFlagPoolSelector } from "../dom/flagPoolSelector";
import { el } from "../dom/createElement";
import { createAtlasView, setAtlasOpen, updateAtlasView, type AtlasView } from "../dom/renderAtlas";
import { appendFeedbackAction, createFeedbackView, hideFeedback, showFeedback, type FeedbackView } from "../dom/renderFeedback";
import { ACADEMY_COUNTRY_CODES } from "../../core/academy/groups";
import { createPromptView, updatePromptView, type PromptView } from "../dom/renderPrompt";
import { createStatsView, updateFreePlayStatsView, updateStatsView, type StatsView } from "../dom/renderStats";
import { createFlagColorRevealView } from "../dom/renderFlagColorReveal";
import { createWorldMapView, setWorldMapTargetCountry, updateWorldMapView, type WorldMapView } from "../dom/renderWorldMap";
import { createCapitalRecallMapView, type CapitalRecallMapView } from "../dom/renderCapitalRecallMap";
import { bindKeyboardAwareInput, dismissKeyboardIfTouchInput, isTouchKeyboardViewport, shouldAutoFocusTextInput } from "../dom/mobileKeyboard";
import { confirmDialog } from "../shell/confirmDialog";
import { createFocusBar, type FocusBarHandle } from "../shell/FocusBar";
import "../../styles/game-screens.css";
import { createGameBar, type GameBarHandle } from "../shell/GameBar";
import { markShellScreen } from "../shell/types";
import { createRunResults, formatRunTime, formatTimeSpent, hideResultsIn, showResultsIn, type TimedPostOutcome } from "./gameResults";

/** Answered prompts after which Restart asks before wiping the run. */
export const RESTART_CONFIRM_THRESHOLD = 5;

export interface DailyPromptProgress {
  readonly score: number;
  readonly hintsUsed: number;
  readonly marks: readonly DailyRoundMark[];
  /** Penalties already taken on the round in progress. */
  readonly roundHintsUsed: number;
  readonly roundWrongGuesses: number;
  readonly rounds?: readonly DailyRoundResult[];
}

export interface SoloGameScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly countryIndex: CountryIndex;
  readonly engine: GameEngine;
  readonly ranked?: { readonly session: RankedSession; readonly prompt: () => PromptContent | null; readonly subscribe: (callback: (events: readonly GameEvent[]) => void) => () => void };
  readonly selectedGameMode: PromptGameModeId;
  /**
   * From the route: "timed" runs show the clock in the GameBar and post to the leaderboard
   * (leaderboard modes only); everything else is a practice run with no clock.
   */
  readonly run?: RunType;
  readonly flagPool?: FlagPool;
  readonly onFlagPoolChange?: (flagPool: FlagPool) => void;
  readonly storage: Storage;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onStateChange: (state: GameState) => void;
  readonly onReset: () => void;
  /** Legacy header callbacks: the GameBar / FocusBar navigate through `shell` now. */
  readonly onHome?: () => void;
  readonly onMultiplayer?: () => void;
  readonly onDailyChallenge?: () => void;
  /** The daily's ✕ (App says the daily is saved). */
  readonly onExitDailyChallenge?: () => void;
  readonly onViewStats?: () => void;
  readonly onViewFriends?: () => void;
  readonly onLeaderboard?: () => void;
  /** Open a country's Academy profile; offered after a skip or reveal so misses become lessons. */
  readonly onOpenCountry?: (code: string) => void;
  readonly getAuthUser: () => AuthUser | null;
  readonly authControls?: AuthControls;
  readonly worldCountryFeatures?: readonly WorldCountryFeature[];
  readonly dailyChallenge?: {
    readonly date: string;
    readonly onComplete: (result: { readonly score: number; readonly timeMs: number; readonly hintsUsed: number; readonly marks: readonly DailyRoundMark[]; readonly rounds: readonly DailyRoundResult[] }) => void;
    readonly title?: string;
    readonly practice?: boolean;
    readonly promptSlots?: readonly PromptSlot[];
    /** Progress restored from a saved daily (the engine carries the matching state). */
    readonly initialProgress?: DailyPromptProgress;
    /** Called after every answer, hint or wrong guess so the daily can be saved and resumed. */
    readonly onProgress?: (progress: DailyPromptProgress) => void;
    /** Rounds across every daily stage (default DAILY_COUNTRY_COUNT); the prompt stage is first. */
    readonly totalRounds?: number;
    readonly roundOffset?: number;
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
  const activeFlagPool = options.flagPool ?? DEFAULT_FLAG_POOL;
  const initialState = engine.getState();
  const countries = visibleCountries(countryIndex, initialState);
  const restoredDaily = options.dailyChallenge?.initialProgress;
  const dailyMarks: DailyRoundMark[] = [...(restoredDaily?.marks ?? [])];
  const dailyRounds: DailyRoundResult[] = [...(restoredDaily?.rounds ?? [])];
  const dailyAssignments = new Map((options.dailyChallenge?.promptSlots ?? buildPromptSlots(countryIndex, initialState.categoryIds, initialState.seed)).map((slot) => [slot.countryId, slot.categoryId]));
  let dailyHintsUsed = restoredDaily?.hintsUsed ?? 0;
  let dailyRoundHintsUsed = restoredDaily?.roundHintsUsed ?? 0;
  let dailyRoundWrongGuesses = restoredDaily?.roundWrongGuesses ?? 0;
  let dailyScore = restoredDaily?.score ?? 0;
  let dailyCompleted = false;
  let soloHintsUsed = 0;
  const stats = createStatsView();
  const prompt = createPromptView();
  const flagColorReveal = createFlagColorRevealView();
  const feedback = createFeedbackView();
  hideFeedback(feedback);
  const atlas = createAtlasView(countries);
  const views: SoloViews = { stats, prompt, feedback, atlas };
  const input = el("input", {
    attrs: { id: "guess-input", name: "guess", type: "text", autocomplete: "off", autocapitalize: "words", autocorrect: "off", spellcheck: "false", inputmode: "text", enterkeyhint: "done", placeholder: "e.g. Brazil, Japan, ZA..." },
  });
  const guessLabel = el("label", { text: "Your guess", attrs: { for: "guess-input" } });
  const submitButton = el("button", { className: "primary-action guess-submit-action", text: "Enter", attrs: { type: "submit", "aria-label": "Enter guess" } });
  const hintButton = el("button", { className: "secondary-action hint-action", text: "Hint", attrs: { type: "button", "aria-label": "Get a hint" } });
  const skipButton = el("button", { className: "secondary-action", text: "Pass", attrs: { type: "button", "aria-label": "Reveal this answer" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart", attrs: { type: "button" } });
  const freePlayToggle = el("button", {
    className: "freeplay-toggle",
    text: "Free play",
    attrs: { type: "button", "aria-pressed": "false", title: "Pick any country on the map and name its capital — no prompts" },
  });
  const shell = options.shell;
  // A timed run needs a leaderboard mode and never applies to the daily.
  const timed = !isDailyChallenge && options.run === "timed" && isLeaderboardMode(options.selectedGameMode);
  const runType: RunType = timed ? "timed" : "practice";
  const leaderboardVariant = options.selectedGameMode === "flags" && activeFlagPool !== "countries" ? activeFlagPool : "";
  if (timed) resetButton.textContent = "Restart run";
  const mobileHintButton = el("button", { className: "mobile-hint-action", text: "Hint", attrs: { type: "button", "aria-label": "Get a hint" } });
  const mobileSkipButton = el("button", { className: "mobile-pass-action", text: "Pass", attrs: { type: "button", "aria-label": "Reveal this answer" } });
  const mobileExtrasToggle = el("button", { className: "mobile-extras-toggle", text: "Details", attrs: { type: "button", "aria-expanded": "false" } });
  const mobileExtrasPanel = el("div", { className: "mobile-extras-panel" });
  const hintPopoverTitle = el("strong", { className: "hint-popover-title" });
  const hintPopoverMessage = el("span", { className: "hint-popover-message" });
  const hintPopoverClose = el("button", { className: "hint-popover-close", text: "×", attrs: { type: "button", "aria-label": "Dismiss hint" } });
  const hintPopover = el("aside", {
    className: "hint-popover",
    attrs: { hidden: "true", "aria-live": "polite", "aria-label": "Hint" },
    children: [el("div", { className: "hint-popover-copy", children: [hintPopoverTitle, hintPopoverMessage] }), hintPopoverClose],
  });
  // Timed runs: the live clock sits in the GameBar pill; the panel keeps previous / best.
  const clockValue = el("span", { className: "game-run-clock-value", text: formatElapsedTime(0), attrs: { "aria-label": "Elapsed time" } });
  const timerLast = el("strong", { className: "stat-value", text: "—" });
  const timerBest = el("strong", { className: "stat-value", text: "—" });
  const achievementPanel = el("section", { className: "achievement-panel compact", attrs: { hidden: "true" } });
  const timerPanel = timed
    ? el("div", {
        className: "stats-panel country-guess-stats solo-timer-stats timer-is-active",
        children: [
          el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Previous" }), timerLast] }),
          el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Best" }), timerBest] }),
        ],
      })
    : null;
  const resultsHost = el("div", { className: "game-results-host", attrs: { hidden: "" } });
  // Countries passed or revealed this run (plus the engine's skipped set on a resumed run).
  const missedCountryIds = new Set<CountryId>(initialState.skippedCountryIds);
  const flagPoolSelector = !isDailyChallenge && !timed && options.selectedGameMode === "flags" && options.onFlagPoolChange
    ? createFlagPoolSelector({
        value: activeFlagPool,
        signal: controller.signal,
        label: "Flag set",
        onChange: options.onFlagPoolChange,
      })
    : null;

  let playTimer: PlayTimer;
  let activeFlagColorTarget: string | null = null;
  let activeMapPromptKey: string | null = null;
  let latestCapitalRecallCountryId: CountryId | null = null;
  let revealAnswerArmed = false;
  // Free play: type as many capitals as you can, any order — no prompts, no picking.
  // Progress lives here, separate from the engine's guided run, so toggling never mixes them.
  let freePlayEnabled = false;
  let freePlayLatestCountryId: CountryId | null = null;
  let freePlayAttempts = 0;
  let freePlayCorrect = 0;
  let freePlayStreak = 0;
  const freePlayGuessedCountryIds = new Set<CountryId>();
  const cleanDailyMapCountryIds: ReadonlySet<CountryId> = new Set();
  const capitalRecallMap: CapitalRecallMapView | null =
    !isDailyChallenge && options.selectedGameMode === "capital-recall" && options.worldCountryFeatures && options.worldCountryFeatures.length > 0
      ? createCapitalRecallMapView(options.worldCountryFeatures, countryIndex, { signal: controller.signal })
      : null;
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

  function hideHintPopover(): void {
    hintPopover.hidden = true;
  }

  function showHintPopover(title: string, message: string): void {
    hintPopoverTitle.textContent = title;
    hintPopoverMessage.textContent = message;
    hintPopover.hidden = false;
  }

  function renderTimer(): void {
    if (!timed) return;
    clockValue.textContent = formatElapsedTime(options.ranked?.session.elapsedMs() ?? playTimer.currentElapsedMs());
    timerLast.textContent = formatStoredTime(playTimer.readLast());
    timerBest.textContent = formatStoredTime(playTimer.readBest());
  }

  function offerCountryProfile(country: Country): void {
    const openCountry = options.onOpenCountry ?? shell?.openCountry;
    if (isDailyChallenge || !openCountry || !ACADEMY_COUNTRY_CODES.includes(country.code)) return;
    appendFeedbackAction(views.feedback, `Learn about ${country.name} →`, () => openCountry(country.code));
  }

  function answerLabelFor(country: Country): string {
    return options.selectedGameMode === "capital-recall" ? country.capital : country.name;
  }

  async function finishTimerRun(finalTimeMs: number): Promise<TimedPostOutcome> {
    const isNewLocalBest = playTimer.writeCompletion(finalTimeMs);
    if (options.ranked) return { isNewLocalBest, ...await options.ranked.session.post() };
    const posting = await postTimedRun({
      gameMode: options.selectedGameMode,
      variant: leaderboardVariant,
      timeMs: finalTimeMs,
      isLoggedIn: options.getAuthUser() !== null,
    });
    return { isNewLocalBest, ...posting };
  }

  function applyEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === "GUESS_CORRECT") {
        revealAnswerArmed = false;
        playTimer.startIfNeeded();
        hideHintPopover();
        const country = countryIndex.byId[event.countryId];
        if (options.selectedGameMode === "capital-recall") latestCapitalRecallCountryId = event.countryId;
        const points = isDailyChallenge ? dailyRounds.at(-1)?.points ?? 0 : event.points;
        if (country) showFeedback(views.feedback, `Correct: ${answerLabelFor(country)}. +${points} points.`, "good");
        continue;
      }

      if (event.type === "GUESS_WRONG") {
        revealAnswerArmed = false;
        showFeedback(views.feedback, isDailyChallenge ? `Not quite. This round is now worth up to ${scoreDailyRound(dailyRoundHintsUsed, false, dailyRoundWrongGuesses)} points. Try again.` : "Not quite. Streak reset, prompt still live.", "bad");
        continue;
      }

      if (event.type === "ROUND_SKIPPED") {
        revealAnswerArmed = false;
        hideHintPopover();
        const skipped = countryIndex.byId[event.previousCountryId];
        missedCountryIds.add(event.previousCountryId);
        // Daily passes reveal the answer separately; elsewhere, name what was skipped so the miss teaches something.
        showFeedback(views.feedback, skipped && !isDailyChallenge ? `Skipped — that was ${answerLabelFor(skipped)}. It can return later.` : "Skipped. Streak reset — this prompt can return later.", "neutral");
        if (skipped) offerCountryProfile(skipped);
        continue;
      }

      if (event.type === "HINT_REVEALED") {
        revealAnswerArmed = false;
        if (!isDailyChallenge) soloHintsUsed += 1;
        showHintPopover(event.hint.title, event.hint.message);
        showFeedback(views.feedback, isDailyChallenge ? `Hint ready. This round is now worth up to ${scoreDailyRound(dailyRoundHintsUsed, false, dailyRoundWrongGuesses)} points.` : "Hint ready.", "neutral");
        continue;
      }

      if (event.type === "ANSWER_REVEALED") {
        revealAnswerArmed = false;
        const country = countryIndex.byId[event.countryId];
        missedCountryIds.add(event.countryId);
        if (country) {
          if (options.selectedGameMode === "capital-recall") latestCapitalRecallCountryId = event.countryId;
          showHintPopover("Answer", answerLabelFor(country));
          showFeedback(views.feedback, `Answer: ${answerLabelFor(country)}.`, "bad");
          offerCountryProfile(country);
        }
        continue;
      }

      if (event.type === "GAME_COMPLETED") {
        revealAnswerArmed = false;
        hideHintPopover();
        if (!isDailyChallenge) {
          const state = engine.getState();
          showAchievements(recordSoloAchievements(options.storage, {
            completed: true,
            wrongAnswers: state.wrongAnswers,
            bestStreak: state.bestStreak,
            gameMode: options.selectedGameMode,
            hintsUsed: soloHintsUsed,
            countryIndex,
            guessedCountryIds: state.guessedCountryIds,
          }));
        }
        if (isDailyChallenge) continue;
        if (timed) {
          const localTimeMs = playTimer.stop();
          const finalTimeMs = options.ranked?.session.state.timeMs ?? localTimeMs;
          const posting = finishTimerRun(finalTimeMs);
          void posting.then((result) => {
            showFeedback(views.feedback, `Complete. Every prompt solved in ${formatTimerCompletionSuffix(finalTimeMs, result, options.getAuthUser() !== null)}`, "good");
          });
          showRunResults(posting, finalTimeMs);
        } else {
          showFeedback(views.feedback, "Complete. Every prompt in this mix has been solved.", "good");
          showRunResults();
        }
      }
    }
  }

  /** The end-of-run card (docs/navigation.md: every run ends on a results screen). */
  function showRunResults(posting?: Promise<TimedPostOutcome>, finalTimeMs?: number): void {
    if (!shell || isDailyChallenge) return;
    const state = engine.getState();
    const answered = state.correctAnswers + state.wrongAnswers;
    const accuracy = answered > 0 ? `${Math.round((state.correctAnswers / answered) * 100)}%` : "—";
    const spentMs = Math.max(0, (state.endedAt ?? Date.now()) - (state.startedAt ?? Date.now()));
    const missed = [...missedCountryIds].map((id) => countryIndex.byId[id]).filter((country): country is Country => Boolean(country));
    const label = getGameModeOption(options.selectedGameMode).label;
    const card = createRunResults(shell, {
      mode: options.selectedGameMode,
      run: runType,
      variant: leaderboardVariant,
      title: timed ? formatRunTime(finalTimeMs ?? 0) : missed.length === 0 ? "Clean sweep" : "Run complete",
      ...(timed
        ? {}
        : { subtitle: `You worked through all ${state.poolCountryIds.length} prompts${missed.length === 0 ? " without a single pass" : ` and passed on ${missed.length}`}.` }),
      stats: timed
        ? [
            // The title is the final time, so the stats carry the context around it.
            { label: "Your best", value: formatStoredTime(playTimer.readBest()) },
            { label: "Accuracy", value: accuracy },
            { label: "Best streak", value: String(state.bestStreak) },
          ]
        : [
            { label: "Score", value: String(state.score) },
            { label: "Accuracy", value: accuracy },
            { label: "Best streak", value: String(state.bestStreak) },
            { label: "Time spent", value: formatTimeSpent(spentMs) },
          ],
      missed,
      ...(missed.length > 0 ? { missedTitle: "Passed or revealed" } : {}),
      onPlayAgain: () => {
        missedCountryIds.clear();
        hideResultsIn(element, resultsHost);
        resetRun(timed ? "New timed run. The clock starts on your first correct answer." : "Fresh run started.");
      },
      shareText: timed
        ? `I cleared ${label} on Locato in ${formatRunTime(finalTimeMs ?? 0)} (timed run).`
        : `I cleared ${label} on Locato — ${state.score} points, ${accuracy} accuracy.`,
      ...(posting ? { posting } : {}),
    });
    showResultsIn(element, resultsHost, card);
  }

  const form = el("form", {
    className: "guess-form",
    children: [
      guessLabel,
      el("div", { className: "input-row", children: [input, submitButton, mobileHintButton] }),
      el("div", { className: "mobile-daily-actions", children: [mobileSkipButton] }),
    ],
  });

  function playableCapitalTotal(): number {
    return countryIndex.countries.filter((country) => country.capital.length > 0).length;
  }

  function resetFreePlayProgress(): void {
    freePlayLatestCountryId = null;
    freePlayAttempts = 0;
    freePlayCorrect = 0;
    freePlayStreak = 0;
    freePlayGuessedCountryIds.clear();
  }

  // `solved` selects which pool to scan: unsolved for scoring, solved for the
  // "already named" hint. Auto-submit accepts exact answers only; Enter also
  // accepts the same close misspellings as guided Capital Recall.
  function findCapitalMatch(value: string, solved: boolean, auto: boolean): Country | null {
    return (
      countryIndex.countries.find(
        (country) =>
          country.capital.length > 0 &&
          freePlayGuessedCountryIds.has(country.id) === solved &&
          matchesCapitalName(country, value, auto),
      ) ?? null
    );
  }

  function handleFreePlayGuess(auto: boolean): void {
    const value = input.value;
    if (value.trim().length === 0) return;

    const match = findCapitalMatch(value, false, auto);

    if (match === null) {
      if (auto) return; // keep typing — no penalty until Enter
      const solved = findCapitalMatch(value, true, auto);
      freePlayAttempts += 1;
      freePlayStreak = 0;
      render(false);
      showFeedback(views.feedback, solved ? `${solved.capital} is already named.` : "No new capital recognized yet.", "neutral");
      if (shouldAutoFocusTextInput()) input.select();
      return;
    }

    playTimer.startIfNeeded();
    freePlayGuessedCountryIds.add(match.id);
    freePlayAttempts += 1;
    freePlayCorrect += 1;
    freePlayStreak += 1;
    freePlayLatestCountryId = match.id;
    input.value = "";

    const total = playableCapitalTotal();
    if (freePlayGuessedCountryIds.size >= total) {
      // Casual ruleset: no leaderboard submission, unlike timed guided runs.
      const timeSuffix = playTimer.mode === "count-up" ? ` in ${formatElapsedTime(playTimer.stop())}` : "";
      showFeedback(views.feedback, `All ${total} capitals named${timeSuffix}. Free play complete.`, "good");
    } else {
      showFeedback(views.feedback, `Correct: ${match.capital}. ${freePlayGuessedCountryIds.size} of ${total}.`, "good");
    }
    render(false);
    if (shouldAutoFocusTextInput()) input.focus();
  }

  function setFreePlayEnabled(enabled: boolean): void {
    if (freePlayEnabled === enabled) return;
    freePlayEnabled = enabled;
    resetFreePlayProgress();
    freePlayToggle.classList.toggle("is-active", enabled);
    freePlayToggle.setAttribute("aria-pressed", String(enabled));
    hideHintPopover();
    hideFeedback(feedback);
    input.value = "";
    render(false);
    showFeedback(feedback, enabled ? "Free play: type as many capitals as you can — any order." : "Back to guided prompts.", "neutral");
  }

  function resetRun(message: string): void {
    if (options.ranked) message = "New timed run. The server clock is running.";
    activeMapPromptKey = null;
    latestCapitalRecallCountryId = null;
    resetFreePlayProgress();
    setAtlasOpen(atlas, false);
    updateAtlasView(atlas, countries, new Set());
    options.onReset();
    playTimer.reset();
    soloHintsUsed = 0;
    missedCountryIds.clear();
    hideResultsIn(element, resultsHost);
    dispatchAndRender(engine.dispatch({ type: "RESET_GAME", now: Date.now() }));
    showFeedback(feedback, message, "neutral");
  }

  function render(persist = true): void {
    const state = engine.getState();
    const current = getCurrentCountry(countryIndex, state);
    const displayRound = state.roundNumber + (options.dailyChallenge?.roundOffset ?? 0);
    const category = state.currentCategoryId ? getCategory(state.currentCategoryId) : undefined;
    const content = options.ranked ? options.ranked.prompt() : current && category ? category.prompt(current) : null;
    const isCapitalRecallMode = options.selectedGameMode === "capital-recall";
    if (dailyMap) dailyMap.element.classList.toggle("is-click-country-mode", content?.kind === "map-click" && state.status === "playing");
    freePlayToggle.hidden = capitalRecallMap === null || timed;
    guessLabel.textContent = isCapitalRecallMode ? "Capital" : "Your guess";
    input.placeholder = isCapitalRecallMode
      ? "e.g. Tokyo, Abuja, Brasília..."
      : "e.g. Brazil, Japan, ZA...";
    if (freePlayEnabled) {
      updateFreePlayStatsView(stats, {
        found: freePlayGuessedCountryIds.size,
        total: playableCapitalTotal(),
        attempts: freePlayAttempts,
        correct: freePlayCorrect,
        streak: freePlayStreak,
      });
    } else {
      updateStatsView(stats, countryIndex, state);
      if (isDailyChallenge) {
        stats.scoreLabel.textContent = options.dailyChallenge?.practice ? "Round score" : "Daily score";
        stats.score.textContent = `${dailyScore}/${options.dailyChallenge?.practice ? 10 : 100}`;
        const total = options.dailyChallenge?.totalRounds ?? DAILY_COUNTRY_COUNT;
        const completed = dailyMarks.length + (options.dailyChallenge?.roundOffset ?? 0);
        stats.remaining.textContent = String(Math.max(0, total - completed));
        stats.progress.textContent = `${completed} of ${total} rounds completed`;
        stats.progressFill.style.transform = `scaleX(${(completed / total).toFixed(4)})`;
      }
    }
    if (isCapitalRecallMode && capitalRecallMap) {
      activeFlagColorTarget = null;
      activeMapPromptKey = null;
      if (dailyMap) setWorldMapTargetCountry(dailyMap, null);
      prompt.status.textContent = freePlayEnabled ? "Free play" : state.status === "complete" ? "Complete" : `Round ${state.roundNumber}`;
      prompt.kicker.textContent = "Capital recall";
      capitalRecallMap.element.classList.toggle("is-freeplay", freePlayEnabled);
      if (prompt.imageSlot.firstElementChild !== capitalRecallMap.element) {
        prompt.imageSlot.replaceChildren(capitalRecallMap.element);
      }
      capitalRecallMap.update(
        freePlayEnabled ? freePlayGuessedCountryIds : state.guessedCountryIds,
        freePlayEnabled ? freePlayLatestCountryId : current?.id ?? null,
        freePlayEnabled ? freePlayLatestCountryId : latestCapitalRecallCountryId,
      );
    } else if ((content?.kind === "map-click" || content?.kind === "map-highlight") && dailyMap) {
      activeFlagColorTarget = null;
      prompt.status.textContent = `Round ${displayRound}`;
      prompt.kicker.textContent = category?.label ?? "Map";
      prompt.imageSlot.replaceChildren(
        el("div", {
          className: "daily-map-prompt",
          children: [
            el("div", { className: "prompt-text daily-map-prompt-text", text: content.kind === "map-click" ? `Click ${content.value}` : "Which country is this?" }),
            dailyMap.element,
          ],
        }),
      );
      const targetId = current?.id ?? null;
      const mapPromptKey = `${state.roundNumber}:${content.kind}:${targetId ?? "none"}`;
      updateWorldMapView(dailyMap, isDailyChallenge ? cleanDailyMapCountryIds : state.guessedCountryIds);
      setWorldMapTargetCountry(dailyMap, content.kind === "map-highlight" ? targetId : null);
      if (activeMapPromptKey !== mapPromptKey) {
        activeMapPromptKey = mapPromptKey;
        dailyMap.showCountryLabel(null);
        if (content.kind === "map-highlight" && targetId !== null) {
          dailyMap.focusCountry(targetId, { animate: false });
        } else {
          dailyMap.resetView({ animate: false });
        }
      }
    } else if (content?.kind === "flag-colors") {
      activeMapPromptKey = null;
      prompt.status.textContent = `Round ${state.roundNumber}`;
      prompt.kicker.textContent = category?.label ?? "Flag colours";
      if (activeFlagColorTarget !== content.value) {
        activeFlagColorTarget = content.value;
        flagColorReveal.reset(content.value);
      }
      if (prompt.imageSlot.firstElementChild !== flagColorReveal.element) {
        prompt.imageSlot.replaceChildren(flagColorReveal.element);
      }
    } else {
      activeFlagColorTarget = null;
      activeMapPromptKey = null;
      if (dailyMap) setWorldMapTargetCountry(dailyMap, null);
      updatePromptView(prompt, content, displayRound, category?.label ?? "Prompt");
    }
    updateAtlasView(atlas, countries, freePlayEnabled ? freePlayGuessedCountryIds : state.guessedCountryIds);
    const playing = state.status === "playing";
    const acceptingInput = freePlayEnabled || playing;
    if (!playing || state.hintLevel < TOTAL_HINTS) revealAnswerArmed = false;
    const revealAnswerReady = state.hintLevel >= TOTAL_HINTS;
    const hintLabel = revealAnswerReady ? (revealAnswerArmed ? "Reveal answer" : "Reveal answer?") : "Hint";
    input.disabled = !acceptingInput;
    submitButton.disabled = !acceptingInput;
    hintButton.hidden = freePlayEnabled;
    mobileHintButton.hidden = freePlayEnabled;
    hintButton.disabled = !playing;
    mobileHintButton.disabled = !playing;
    hintButton.textContent = hintLabel;
    mobileHintButton.textContent = hintLabel;
    hintButton.classList.toggle("is-reveal-armed", revealAnswerReady);
    mobileHintButton.classList.toggle("is-reveal-armed", revealAnswerReady);
    hintButton.setAttribute("aria-label", revealAnswerReady ? hintLabel : "Get a hint");
    mobileHintButton.setAttribute("aria-label", revealAnswerReady ? hintLabel : "Get a hint");
    skipButton.hidden = freePlayEnabled;
    mobileSkipButton.hidden = freePlayEnabled;
    skipButton.disabled = !playing;
    mobileSkipButton.disabled = !playing;
    renderTimer();
    if (persist) options.onStateChange(state);
  }

  function dispatchAndRender(events: readonly GameEvent[], persist = true): void {
    if (isDailyChallenge) recordDailyEvents(events);
    applyEvents(events);
    render(persist);
    const correct = events.some((event) => event.type === "GUESS_CORRECT");
    if (correct) {
      input.value = "";
    }
    if (engine.getState().status === "playing" && shouldAutoFocusTextInput()) input.focus();
    if (isDailyChallenge && events.length > 0) {
      options.dailyChallenge?.onProgress?.({ score: dailyScore, hintsUsed: dailyHintsUsed, marks: [...dailyMarks], rounds: [...dailyRounds], roundHintsUsed: dailyRoundHintsUsed, roundWrongGuesses: dailyRoundWrongGuesses });
    }
    if (isDailyChallenge) renderDailyProgress();
    if (isDailyChallenge) completeDailyIfNeeded(events);
  }

  function recordDailyEvents(events: readonly GameEvent[]): void {
    function recordRound(countryId: CountryId, missed: boolean): void {
      dailyRounds.push({ categoryId: dailyAssignments.get(countryId) ?? "flags", countryCode: countryIndex.byId[countryId]!.code,
        points: scoreDailyRound(dailyRoundHintsUsed, missed, dailyRoundWrongGuesses), hintsUsed: dailyRoundHintsUsed, wrongGuesses: dailyRoundWrongGuesses, missed });
    }
    for (const event of events) {
      if (event.type === "HINT_REVEALED") {
        dailyHintsUsed += 1;
        dailyRoundHintsUsed += 1;
        continue;
      }

      if (event.type === "GUESS_WRONG") {
        dailyRoundWrongGuesses += 1;
        continue;
      }

      if (event.type === "GUESS_CORRECT") {
        recordRound(event.countryId, false);
        dailyScore += scoreDailyRound(dailyRoundHintsUsed, false, dailyRoundWrongGuesses);
        dailyMarks.push(dailyRoundHintsUsed > 0 || dailyRoundWrongGuesses > 0 ? "hint" : "correct");
        dailyRoundHintsUsed = 0;
        dailyRoundWrongGuesses = 0;
        continue;
      }

      if (event.type === "ANSWER_REVEALED" || event.type === "ROUND_SKIPPED") {
        recordRound(event.type === "ANSWER_REVEALED" ? event.countryId : event.previousCountryId, true);
        dailyScore += scoreDailyRound(dailyRoundHintsUsed, true, dailyRoundWrongGuesses);
        dailyMarks.push("miss");
        dailyRoundHintsUsed = 0;
        dailyRoundWrongGuesses = 0;
      }
    }
  }

  function completeDailyIfNeeded(events: readonly GameEvent[]): void {
    if (!options.dailyChallenge || dailyCompleted || !events.some((event) => event.type === "GAME_COMPLETED")) return;

    dailyCompleted = true;
    const state = engine.getState();
    options.dailyChallenge.onComplete({
      score: dailyScore,
      timeMs: Math.max(0, (state.endedAt ?? Date.now()) - (state.startedAt ?? Date.now())),
      hintsUsed: dailyHintsUsed,
      marks: [...dailyMarks],
      rounds: [...dailyRounds],
    });
  }

  playTimer = createPlayTimer({
    storage: options.storage,
    keys: timerKeysForMode(options.selectedGameMode, activeFlagPool),
    isComplete: () => engine.getState().status === "complete",
    onTick: renderTimer,
  });

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      if (freePlayEnabled) {
        handleFreePlayGuess(false);
        return;
      }
      if (!options.ranked && engine.getState().currentCategoryId === "flag-colors") {
        const guessedCountry = countryForGuess(countryIndex, input.value);
        if (guessedCountry) flagColorReveal.addGuess(guessedCountry.flagSrc);
      }
      dispatchAndRender(engine.dispatch({ type: "SUBMIT_GUESS", value: input.value, now: Date.now() }));
      if (engine.getState().lastResult?.type === "wrong" && shouldAutoFocusTextInput()) input.select();
    },
    { signal: controller.signal },
  );

  input.addEventListener(
    "input",
    () => {
      if (isDailyChallenge) return;
      if (freePlayEnabled) {
        handleFreePlayGuess(true);
        return;
      }
      const events = engine.dispatch({ type: "SUBMIT_GUESS", value: input.value, now: Date.now(), auto: true });
      if (events.length > 0) dispatchAndRender(events);
    },
    { signal: controller.signal },
  );

  function requestHint(): void {
    const state = engine.getState();
    if (state.hintLevel >= TOTAL_HINTS) {
      if (!revealAnswerArmed) {
        revealAnswerArmed = true;
        showHintPopover("Reveal answer?", "No hints left for this prompt. Tap Reveal answer again to show the answer.");
        showFeedback(views.feedback, "No hints left. Confirm before revealing the answer.", "neutral");
        render(false);
        return;
      }

      revealAnswerArmed = false;
      dispatchAndRender(engine.dispatch({ type: "REVEAL_ANSWER", now: Date.now() }));
      return;
    }

    revealAnswerArmed = false;
    dispatchAndRender(engine.dispatch({ type: "REQUEST_HINT", now: Date.now() }));
  }

  function skipRound(): void {
    dismissKeyboardIfTouchInput(input);
    hideHintPopover();
    dispatchAndRender(engine.dispatch(isDailyChallenge ? { type: "REVEAL_ANSWER", now: Date.now() } : { type: "SKIP_ROUND", now: Date.now() }));
  }

  function keepInputFocusedForTouchAction(button: HTMLButtonElement): void {
    button.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "touch" && document.activeElement === input && isTouchKeyboardViewport()) event.preventDefault();
      },
      { signal: controller.signal },
    );
  }

  keepInputFocusedForTouchAction(hintButton);
  keepInputFocusedForTouchAction(mobileHintButton);

  hintButton.addEventListener("click", requestHint, { signal: controller.signal });
  mobileHintButton.addEventListener("click", requestHint, { signal: controller.signal });
  skipButton.addEventListener("click", skipRound, { signal: controller.signal });
  mobileSkipButton.addEventListener("click", skipRound, { signal: controller.signal });
  hintPopoverClose.addEventListener("click", hideHintPopover, { signal: controller.signal });
  /** Ask before wiping a run with real progress; short runs reset straight away. */
  async function confirmWipeRun(message: string, confirmLabel: string): Promise<boolean> {
    const state = engine.getState();
    const answered = state.guessedCountryIds.size + state.skippedCountryIds.size;
    if (state.status === "complete" || answered < RESTART_CONFIRM_THRESHOLD) return true;
    return confirmDialog(`${message} You've answered ${answered} so far — this run will be lost.`, { confirmLabel, cancelLabel: "Keep playing", tone: "danger" });
  }

  function restartFromMenu(): void {
    dismissKeyboardIfTouchInput(input);
    void confirmWipeRun(timed ? "Restart this timed run?" : "Start a fresh run?", "Restart").then((confirmed) => {
      if (!confirmed || controller.signal.aborted) return;
      resetRun(timed ? "Timer reset. The clock starts on your first correct answer." : "Fresh run started.");
    });
  }
  resetButton.addEventListener("click", restartFromMenu, { signal: controller.signal });
  freePlayToggle.addEventListener("click", () => setFreePlayEnabled(!freePlayEnabled), { signal: controller.signal });

  mobileExtrasToggle.addEventListener(
    "click",
    () => {
      const open = mobileExtrasPanel.classList.toggle("is-open");
      mobileExtrasToggle.setAttribute("aria-expanded", String(open));
      mobileExtrasToggle.textContent = open ? "Hide details" : "Details";
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

  atlas.openButton.addEventListener("click", () => setAtlasOpen(atlas, true), { signal: controller.signal });
  atlas.closeButton.addEventListener("click", () => setAtlasOpen(atlas, false), { signal: controller.signal });
  atlas.overlay.addEventListener("click", () => setAtlasOpen(atlas, false), { signal: controller.signal });

  // Phones: the feedback line (with its "Learn about X →" link) and the score stay visible;
  // only the secondary tools fold into Details.
  mobileExtrasPanel.replaceChildren(
    ...(timerPanel ? [timerPanel] : []),
    achievementPanel,
    el("div", { className: "actions solo-action-grid", children: [hintButton, skipButton, ...(isDailyChallenge ? [] : [resetButton]), atlas.element] }),
  );

  /** A timed run is "in progress" from the first answer until it completes. */
  function timedRunInProgress(): boolean {
    const state = engine.getState();
    return timed && state.status === "playing" && (state.attempts > 0 || state.guessedCountryIds.size > 0 || playTimer.currentElapsedMs() > 0);
  }

  let gameBar: GameBarHandle | null = null;
  let focusBar: FocusBarHandle | null = null;
  const dailyTotalRounds = options.dailyChallenge?.totalRounds ?? DAILY_COUNTRY_COUNT;
  const dailyRoundLabel = el("span", { className: "daily-round-label" });
  function renderDailyProgress(): void {
    if (!focusBar) return;
    const done = Math.min(dailyMarks.length + (options.dailyChallenge?.roundOffset ?? 0), dailyTotalRounds);
    const round = Math.min(done + 1, dailyTotalRounds);
    const label = `${options.dailyChallenge?.practice ? "Review" : "Round"} ${round} of ${dailyTotalRounds}`;
    dailyRoundLabel.textContent = label;
    focusBar.setProgress(done / dailyTotalRounds, label);
  }
  if (isDailyChallenge) {
    focusBar = createFocusBar({
      // App's exit says "Your daily progress is saved — resume any time today".
      onClose: () => (options.onExitDailyChallenge ?? (() => shell?.openSection("daily")))(),
      closeLabel: options.dailyChallenge?.practice ? "Back to daily result" : "Leave the daily challenge (progress is saved)",
      title: options.dailyChallenge?.title ?? "Daily challenge",
      progress: 0,
      progressLabel: "Daily challenge progress",
      trailing: dailyRoundLabel,
    });
    renderDailyProgress();
  } else if (shell) {
    gameBar = createGameBar(shell, {
      gameMode: options.selectedGameMode,
      run: runType,
      ...(timed ? { clock: clockValue } : {}),
      // A cold timed link backs out to its own board rather than the Compete landing tab.
      onBack: () => shell.goBack(timed ? () => shell.openCompete(options.selectedGameMode, leaderboardVariant || undefined) : "play"),
      backLabel: timed ? "Back to Compete" : "Back",
      onHowToPlay: () => showHintPopover("How to play", getGameModeOption(options.selectedGameMode).description),
      extraMenuItems: [{ label: timed ? "Restart run" : "Start a fresh run", icon: "rotate-ccw", onSelect: restartFromMenu }],
      leaveGuard: () => (timedRunInProgress() ? "This timed run is still going — it won't be posted." : null),
      timedVariant: () => leaderboardVariant || undefined,
    });
  }

  const element = el("section", {
    className: isDailyChallenge ? "game-screen daily-game-screen" : `game-screen solo-game-screen is-${runType}-run`,
    attrs: { "data-run": isDailyChallenge ? "daily" : runType, "data-mode": options.selectedGameMode },
    children: [
      ...(focusBar ? [focusBar.element] : gameBar ? [gameBar.element] : []),
      resultsHost,
      el("div", {
        className: "play-layout",
        children: [
          prompt.element,
          el("aside", {
            className: "answer-panel",
            children: [
              el("div", { className: "panel-title has-freeplay-toggle", children: [el("h2", { text: "Name the place" }), freePlayToggle] }),
              form,
              feedback.element,
              stats.element,
              ...(flagPoolSelector ? [flagPoolSelector.element] : []),
              hintPopover,
              mobileExtrasToggle,
              mobileExtrasPanel,
            ],
          }),
        ],
      }),
    ],
  });
  markShellScreen(element, isDailyChallenge ? "focus" : "game");

  bindKeyboardAwareInput(element, input, controller.signal);
  if (timed) playTimer.setMode("count-up");
  if (options.ranked) playTimer.startIfNeeded();
  const unsubscribeRanked = options.ranked?.subscribe((events) => {
    if (controller.signal.aborted) return;
    if (events.some((e) => e.type === "GAME_RESET")) playTimer.startIfNeeded();
    dispatchAndRender(events);
    if (events.some((event) => event.type === "GUESS_WRONG") && shouldAutoFocusTextInput()) input.select();
    if (!events.length && engine.getState().lastResult?.message) showFeedback(feedback, engine.getState().lastResult!.message, "bad");
  });
  render();
  if (initialState.lastResult?.message) showFeedback(feedback, initialState.lastResult.message, "neutral");
  else if (timed) showFeedback(feedback, options.ranked ? "Timed run. The server clock is running." : "Timed run. The clock starts on your first correct answer.", "neutral");
  // A resumed run that had already finished opens on its results.
  if (!isDailyChallenge && initialState.status === "complete") showRunResults();

  return {
    element,
    destroy: () => {
      unsubscribeRanked?.();
      playTimer.destroy();
      gameBar?.destroy();
      controller.abort();
    },
  };
}
