import { type CountryId, type CountryIndex } from "../core/countries";
import { createGameEngine, createRandomSeed, type GameEngine, type GameState } from "../core/game";
import { createDailyChallenge, createDailyShareText, DAILY_COUNTRY_COUNT, DAILY_MAX_SCORE, DAILY_POINTS_PER_ROUND, scoreDailyMapTapRound, scoreDailyRound, type DailyRoundMark } from "../core/dailyChallenge";
import { DEFAULT_CATEGORY_IDS, resolveCategoryIds } from "../core/categories";
import { createPromptCountryIndex, DEFAULT_FLAG_POOL, isFlagPool, normalizeFlagPool, type FlagPool } from "../core/flagPools";
import { isMapTapGameModeId, isPromptGameModeId, isStreetViewGameModeId, isWorldMapGameModeId, isWorldSplitGameModeId, promptGameModeFromCategoryIds, type GameModeId, type WorldMapGameModeId } from "../core/gameModes";
import { clearSoloRun, createSoloSave, hydrateGameState, isSoloSaveResumable, persistSoloRun, readLatestSoloSave, readSoloSave } from "../storage/localSave";
import { clearDailyProgress, createDailyResultSave, readDailyProgress, readDailyResult, saveDailyProgress, saveDailyResult, type DailyResultSave, type DailyStage } from "../storage/dailySave";
import { createWebSocketMultiplayerTransport, resolveDefaultWebSocketUrl, type MultiplayerTransport } from "../core/multiplayer";
import { loadWorldCountryFeatures, type WorldCountryFeature } from "../core/map";
import { fetchDailyChallengeResult, recordGame, saveDailyChallengeResult, type DailyChallengeResult } from "../core/auth";
import { type WorldMapRunResult } from "../ui/screens/CountryGuessingScreen";
import { findMapTapLocation } from "../core/maptap/locations";
import { streetViewCountryRounds } from "../core/streetview";
import { createDailyResultScreen } from "../ui/screens/DailyResultScreen";
import { createAuthControls } from "../ui/components/AuthPanel";
import { createStatsScreen } from "../ui/screens/StatsScreen";
import { createFriendsScreen } from "../ui/screens/FriendsScreen";
import { createSocialClient, resolveSocialUrl } from "../core/social/SocialClient";
import type { SocialServerMessage } from "../core/social/socialProtocol";
import { createCompeteScreen } from "../ui/screens/CompeteScreen";
import { createLandingScreen } from "../ui/screens/LandingScreen";
import { el } from "../ui/dom/createElement";
import { createThemeToggle } from "../ui/theme";
import { createSoundToggle } from "../ui/dom/sfx";
import { buildRouteUrl, routeFromLocation, type AppRoute, type Screen } from "./router";
import { createAcademyProgressStore } from "./academyProgress";
import { isLeaderboardMode } from "../core/gameModes";
import { confirmDialog as shellConfirmDialog } from "../ui/shell/confirmDialog";
import { createShellControls } from "../ui/shell/controls";
import { openGamePicker } from "../ui/shell/GamePicker";
import { SECTION_ROUTES } from "../ui/shell/SiteHeader";
import type { RunType, ShellContext } from "../ui/shell/types";

export interface AppOptions {
  readonly root: HTMLElement;
  readonly countryIndex: CountryIndex;
  readonly storage: Storage;
}

export interface App {
  readonly start: () => void;
  readonly navigate: (route: AppRoute) => void;
}

function createEngine(countryIndex: CountryIndex, categoryIds: readonly string[], initialState: GameState | null, poolCountryIds?: readonly CountryId[]): GameEngine {
  return createGameEngine({
    countryIndex,
    categoryIds,
    seed: initialState?.seed ?? createRandomSeed(),
    poolOrdering: "fame-ramp",
    ...(poolCountryIds ? { poolCountryIds } : {}),
    ...(initialState ? { initialState } : {}),
  });
}

function createDefaultOnlineTransport(): MultiplayerTransport {
  return createWebSocketMultiplayerTransport(resolveDefaultWebSocketUrl(window.location));
}

interface NavigateOptions {
  /** Push a browser history entry (default). Pass false when rendering an existing entry (popstate/start). */
  readonly push?: boolean;
  /** Replace the current history entry instead of pushing (e.g. flipping through atlas pages). */
  readonly replace?: boolean;
}

interface HistoryState {
  readonly route: AppRoute;
  readonly idx: number;
  /** The route this entry was pushed from, so "Back to X" buttons can pop instead of stacking. */
  readonly prev?: AppRoute;
}

export function createApp(options: AppOptions): App {
  let activeScreen: Screen | null = null;
  let navigationRun = 0;

  // Tracks the in-flight solo session so it can be recorded when it ends (completion, reset,
  // category change, or navigating away) — not only on full 196-country completion.
  let lastSoloState: GameState | null = null;

  // Account controls persist across navigation and are fixed to the top-right of the viewport.
  // Persistent social channel (presence + friend/invite events) for the signed-in user.
  const social = createSocialClient(resolveSocialUrl(window.location));
  const academyProgress = createAcademyProgressStore(options.storage);
  const authControls = createAuthControls({
    onAuthChange: (state) => {
      if (state.user) social.connect();
      else social.disconnect();
      if (state.user) void academyProgress.syncWithAccount();
      else academyProgress.detachAccount();
    },
    onViewStats: () => navigate({ type: "stats" }),
    onViewFriends: () => navigate({ type: "friends" }),
  });
  const themeToggle = createThemeToggle(options.storage);
  const soundToggle = createSoundToggle();

  const globalControls = el("div", { className: "global-controls", attrs: { "aria-label": "Account and preferences" }, children: [soundToggle, themeToggle, authControls.trigger] });

  // Navigation shell (docs/navigation.md): one context handed to every screen as `shell`.
  // Screens that render a shell header mark their root `data-shell`; for those,
  // attachGlobalControls leaves the legacy fixed cluster off and the account trigger lives in
  // `shell.controls` (which SiteHeader places on its right).
  const shellControls = createShellControls({ storage: options.storage, account: authControls.trigger });
  const shell: ShellContext = {
    openSection: (section) => navigate(SECTION_ROUTES[section]),
    goHome: () => navigate({ type: "landing" }),
    goBack: (fallback = "play") => {
      if ((historyState()?.idx ?? 0) > 0) window.history.back();
      else navigate(SECTION_ROUTES[fallback]);
    },
    openGame: (mode, run = "practice", variant) => openGame(mode, run, variant),
    openGamePicker: (picker) => {
      openGamePicker({
        ...(picker?.current ? { current: picker.current } : {}),
        ...(picker?.run ? { currentRun: picker.run } : {}),
        onPick: (mode, run) => openGame(mode, run),
      });
    },
    openCountry: (code) => navigate({ type: "country-profile", code: code.toUpperCase() }),
    openCompete: (mode, variant) => navigate({ type: "compete", ...(mode ? { mode } : {}), ...(variant ? { variant } : {}) }),
    openAccount: () => authControls.openPanel(),
    controls: shellControls.element,
    confirmLeave: (message, confirmOptions) => shellConfirmDialog(message, confirmOptions),
    signedIn: () => Boolean(authControls.getUser()),
    storage: options.storage,
  };

  /** Timed runs open `&run=timed` for leaderboard modes; everything else opens the mode's practice run. */
  function openGame(mode: GameModeId, run: RunType, variant?: string): void {
    if (run === "timed" && isLeaderboardMode(mode)) {
      if (isPromptGameModeId(mode)) {
        const flagPool = mode === "flags" && isFlagPool(variant) ? { flagPool: variant } : {};
        navigate({ type: "solo-game", categoryIds: [mode], run: "timed", ...flagPool });
      } else if (isWorldMapGameModeId(mode)) {
        navigate({ type: "country-guessing", mode, run: "timed", ...(mode === "puzzle" && variant ? { continent: variant } : {}) });
      }
      return;
    }
    handleGameModeChange(mode);
  }

  // Every navigation is mirrored into the browser history (the state carries the
  // route), so the browser back/forward buttons move through the app, and in-app
  // "Back" buttons can simply pop the real history.
  function historyState(): HistoryState | null {
    const state = window.history.state as Partial<HistoryState> | null;
    return state && typeof state === "object" && state.route ? (state as HistoryState) : null;
  }

  function pushRoute(route: AppRoute): void {
    const current = historyState();
    // Re-selecting the current screen shouldn't stack duplicate history entries.
    if (current && JSON.stringify(current.route) === JSON.stringify(route)) return;
    window.history.pushState({ route, idx: (current?.idx ?? 0) + 1, ...(current ? { prev: current.route } : {}) } satisfies HistoryState, "", buildRouteUrl(route, window.location));
  }

  function replaceRoute(route: AppRoute): void {
    const current = historyState();
    window.history.replaceState({ route, idx: current?.idx ?? 0, ...(current?.prev ? { prev: current.prev } : {}) } satisfies HistoryState, "", buildRouteUrl(route, window.location));
  }

  /** Return to a screen of this type: pop history when we came straight from it, else push it. */
  function returnTo(route: AppRoute): void {
    const current = historyState();
    if (current && current.idx > 0 && current.prev?.type === route.type) window.history.back();
    else navigate(route);
  }

  function goBack(): void {
    // If this is the first in-app entry (e.g. the tab opened on this screen),
    // going back would leave the site — fall back to home instead.
    if ((historyState()?.idx ?? 0) > 0) window.history.back();
    else navigate({ type: "landing" });
  }

  function attachGlobalControls(): void {
    if (activeScreen?.element.dataset.shell) {
      // Shell screens carry their own controls in their header (or ⋯ menu).
      globalControls.remove();
      shellControls.adoptAccount();
      options.root.append(authControls.panel);
      return;
    }
    const gamePreferences = activeScreen?.element.querySelector("[data-game-preferences]");
    // The immersive game has fixed contrast; the site theme remains available on other screens.
    globalControls.replaceChildren(soundToggle, ...(gamePreferences ? [] : [themeToggle]), authControls.trigger);
    (gamePreferences ?? options.root).append(globalControls);
    options.root.append(authControls.panel);
  }

  // Seeds currently being recorded — prevents concurrent double-fire (e.g. a seed-change flush
  // racing a navigate flush) within this page load.
  const recordingSeeds = new Set<string>();

  // Record a finished solo session. Idempotent per seed. The persistent dedup key is written
  // ONLY after a successful record, so a failed attempt (guest / offline / 401) can still record
  // later once the player signs in — instead of being permanently marked "recorded".
  async function recordSoloSession(state: GameState | null): Promise<void> {
    if (!state || state.correctAnswers + state.wrongAnswers === 0) return;
    const key = `locato.recorded:${state.seed}`;
    if (options.storage.getItem(key) || recordingSeeds.has(state.seed)) return;
    recordingSeeds.add(state.seed);
    try {
      const stats = await recordGame({ mode: "solo", categoryIds: state.categoryIds, correctAnswers: state.correctAnswers, wrongAnswers: state.wrongAnswers, score: state.score, bestStreak: state.bestStreak });
      if (stats) {
        options.storage.setItem(key, "1");
        authControls.refreshStats(stats);
      }
    } finally {
      recordingSeeds.delete(state.seed);
    }
  }

  // Record a finished world-map run. Each run is emitted once by the screen, so no dedup needed.
  async function recordWorldMapGame(r: WorldMapRunResult): Promise<void> {
    const stats = await recordGame({
      mode: "world-map",
      categoryIds: [`world-map:${r.playMode}`],
      correctAnswers: 0,
      wrongAnswers: 0,
      score: 0,
      bestStreak: 0,
      durationMs: r.completed && r.timed ? r.durationMs : 0,
      completed: r.completed,
      countriesFound: r.countriesFound,
      countriesTotal: r.countriesTotal,
      playMode: r.playMode,
    });
    if (stats) authControls.refreshStats(stats);
  }

  attachGlobalControls();

  function mount(screen: Screen, showGlobalControls = true): void {
    activeScreen?.destroy();
    activeScreen = screen;
    options.root.replaceChildren(screen.element, authControls.panel);
    options.root.scrollTop = 0;
    if (showGlobalControls) attachGlobalControls();
  }

  // The You tab the next Stats screen opens on (Friends → "Achievements" lands there).
  let pendingStatsTab: "stats" | "achievements" = "stats";

  // The daily screen currently mounted while a daily is in progress (null otherwise), so the header
  // "Daily challenge" link doesn't restart a daily you're already playing.
  let activeDailyScreen: Screen | null = null;

  function mountDaily(screen: Screen): void {
    mount(screen);
    activeDailyScreen = screen;
  }

  /** Screens with unsaved state (a multiplayer room, a lesson) set data-leave-confirm to the question to ask. */
  function confirmLeaveActiveScreen(): Promise<boolean> {
    const message = activeScreen?.element.dataset.leaveConfirm;
    return message ? shellConfirmDialog(message, { confirmLabel: "Leave", cancelLabel: "Stay" }) : Promise.resolve(true);
  }

  function showNotice(message: string): void {
    const toast = el("div", { className: "game-invite-toast app-notice-toast", attrs: { role: "status" }, children: [el("span", { className: "invite-toast-text", text: message })] });
    options.root.append(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function dailyAccountResultToLocal(result: DailyChallengeResult): DailyResultSave {
    return { version: 2, ...result, shareText: createDailyShareText(result.date, result.score, result.timeMs, result.marks) };
  }

  function dailyLocalResultToAccount(result: DailyResultSave): DailyChallengeResult {
    const { version: _version, ...payload } = result;
    return payload;
  }

  function mountDailyResult(result: DailyResultSave): void {
    mount(
      createDailyResultScreen({ shell, result, storage: options.storage }),
    );
  }

  // Every mode keeps its own practice save and opening a mode always resumes it; a fresh run is an
  // explicit Restart. `_continueSaved` (the old `resume=1` flag) is still parsed but no longer needed.
  // A timed run (`&run=timed`, from Compete) always starts fresh and is never saved, so it can't
  // overwrite or clear the mode's practice run (see persistSoloRun).
  async function startSolo(categoryIds: readonly string[] | undefined, _continueSaved = false, requestedFlagPool?: FlagPool, requestedRun: RunType = "practice"): Promise<void> {
    const run = navigationRun;
    mount(createLoadingScreen("Preparing your game…"));
    const { createSoloGameScreen } = await import("../ui/screens/SoloGameScreen");
    if (run !== navigationRun) return;
    // No mode given (landing "Resume game"): the most recently played mode.
    const latest = categoryIds ? null : readLatestSoloSave(options.storage);
    const resolved = resolveCategoryIds(categoryIds ?? latest?.categoryIds ?? DEFAULT_CATEGORY_IDS);
    const soloRun: RunType = requestedRun === "timed" && resolved.length === 1 && isLeaderboardMode(resolved[0]!) ? "timed" : "practice";
    const requestedPool = requestedFlagPool === undefined ? undefined : normalizeFlagPool(requestedFlagPool);
    const lookupPool = resolved.includes("flags") ? requestedPool ?? (latest ? normalizeFlagPool(latest.flagPool) : undefined) : undefined;
    const candidate = soloRun === "timed" ? null : readSoloSave(options.storage, resolved, lookupPool);
    const save = candidate && isSoloSaveResumable(candidate) ? candidate : null;
    const activeCategories = save ? save.categoryIds : resolved;
    const activeFlagPool = activeCategories.includes("flags") ? normalizeFlagPool(requestedPool ?? candidate?.flagPool) : DEFAULT_FLAG_POOL;
    const promptCountryIndex = createPromptCountryIndex(options.countryIndex, activeCategories, activeFlagPool);
    const initialState = save ? hydrateGameState(promptCountryIndex, save) : null;
    if (initialState) {
      const current = historyState();
      const resumedRoute: AppRoute = { type: "solo-game", categoryIds: activeCategories, continueSaved: true, ...(activeCategories.includes("flags") ? { flagPool: activeFlagPool } : {}) };
      window.history.replaceState({ route: resumedRoute, idx: current?.idx ?? 0, ...(current?.prev ? { prev: current.prev } : {}) } satisfies HistoryState, "", buildRouteUrl(resumedRoute, window.location));
    }
    let worldCountryFeatures: readonly WorldCountryFeature[] | undefined;

    if (activeCategories.includes("capital-recall")) {
      const loading = createLoadingScreen("Loading capital map...");
      mount(loading);

      try {
        worldCountryFeatures = await loadWorldCountryFeatures();
      } catch (error) {
        if (run !== navigationRun) return;
        showLoadError(error);
        return;
      }

      if (run !== navigationRun) return;
    }

    const engine = createEngine(promptCountryIndex, activeCategories, initialState);

    mount(
      createSoloGameScreen({ shell,
        countryIndex: promptCountryIndex,
        onOpenCountry: (code) => navigate({ type: "country-profile", code }),
        engine,
        selectedGameMode: promptGameModeFromCategoryIds(activeCategories),
        run: soloRun,
        flagPool: activeFlagPool,
        onFlagPoolChange: (nextFlagPool) => {
          // Each flag set keeps its own run; switching resumes the other set's save.
          void recordSoloSession(lastSoloState);
          lastSoloState = null;
          navigate({ type: "solo-game", categoryIds: activeCategories, continueSaved: false, flagPool: nextFlagPool });
        },
        onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
        onHome: () => navigate({ type: "landing" }),
        onReset: () => {
          // Record the finished run before starting a fresh one.
          void recordSoloSession(lastSoloState);
          lastSoloState = null;
          clearSoloRun(options.storage, activeCategories, soloRun, activeFlagPool);
        },
        onStateChange: (state) => {
          persistSoloRun(options.storage, promptCountryIndex, state, soloRun, Date.now(), activeFlagPool);
          // A new seed means the previous session ended (reset / new game) — record it.
          if (lastSoloState && lastSoloState.seed !== state.seed) void recordSoloSession(lastSoloState);
          lastSoloState = state;
          // Also record the moment a run is fully completed.
          if (state.status === "complete") void recordSoloSession(state);
        },
        onMultiplayer: () => navigate({ type: "multiplayer" }),
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
        onViewStats: () => navigate({ type: "stats" }),
        onViewFriends: () => navigate({ type: "friends" }),
        onLeaderboard: () =>
          navigate({
            type: "leaderboard",
            mode: promptGameModeFromCategoryIds(activeCategories),
            ...(activeCategories.length === 1 && activeCategories[0] === "flags" && activeFlagPool !== "countries" ? { variant: activeFlagPool } : {}),
          }),
        getAuthUser: () => authControls.getUser(),
        authControls,
        storage: options.storage,
        ...(worldCountryFeatures ? { worldCountryFeatures } : {}),
      }),
    );
  }

  async function startDailyChallenge(): Promise<void> {
    const run = navigationRun;
    mount(createLoadingScreen("Preparing the daily challenge…"));
    const [{ createSoloGameScreen }, { createStreetViewCountryScreen }] = await Promise.all([import("../ui/screens/SoloGameScreen"), import("../ui/screens/StreetViewCountryScreen")]);
    if (run !== navigationRun) return;
    const challenge = createDailyChallenge(options.countryIndex);
    const activeUser = authControls.getUser();
    const activeUserId = activeUser?.id ?? null;
    const localResult = readDailyResult(options.storage, challenge.date, activeUserId);

    if (activeUserId) {
      mount(createLoadingScreen("Loading Daily Challenge..."));
      const accountResult = await fetchDailyChallengeResult(challenge.date);
      if (run !== navigationRun || authControls.getUser()?.id !== activeUserId) return;

      if (accountResult) {
        const result = dailyAccountResultToLocal(accountResult);
        saveDailyResult(options.storage, result, activeUserId);
        mountDailyResult(result);
        return;
      }

      if (localResult) {
        mountDailyResult(localResult);
        void saveDailyChallengeResult(dailyLocalResultToAccount(localResult)).then((synced) => {
          if (!synced || run !== navigationRun || authControls.getUser()?.id !== activeUserId) return;
          const result = dailyAccountResultToLocal(synced);
          saveDailyResult(options.storage, result, activeUserId);
          mountDailyResult(result);
        });
        return;
      }
    } else if (localResult) {
      mountDailyResult(localResult);
      return;
    }

    // Resume today's daily where the player left off (a stale day's progress is discarded on read).
    const progressUserId = activeUserId;
    const saved = readDailyProgress(options.storage, challenge.date, challenge.seed, progressUserId);

    mount(createLoadingScreen("Loading Daily Challenge..."));
    let worldCountryFeatures: readonly WorldCountryFeature[];
    try {
      worldCountryFeatures = await loadWorldCountryFeatures();
    } catch (error) {
      if (run !== navigationRun) return;
      showLoadError(error);
      return;
    }
    if (run !== navigationRun) return;

    // Elapsed time counts play only: resuming continues the clock from the saved total.
    const dailyStartedAt = Date.now() - (saved?.elapsedMs ?? 0);
    const restoredPromptState = saved?.stage === "prompt" && saved.engine ? hydrateGameState(options.countryIndex, saved.engine) : null;
    // A prompt stage saved as complete (it should have handed off) resumes at the next stage.
    const promptAlreadyDone = saved?.stage === "prompt" && restoredPromptState?.status === "complete";
    const resumeStage: DailyStage = promptAlreadyDone ? "map-tap" : saved?.stage ?? "prompt";
    // Prompt-stage totals live in the prompt screen until it completes; later stages add to these.
    const carryTotals = saved !== null && (saved.stage !== "prompt" || promptAlreadyDone);
    let dailyScore = carryTotals ? saved.score : 0;
    let dailyHintsUsed = carryTotals ? saved.hintsUsed : 0;
    const dailyMarks: DailyRoundMark[] = carryTotals ? [...saved.marks] : [];

    function persistDaily(
      stage: DailyStage,
      prompt?: { readonly score: number; readonly hintsUsed: number; readonly marks: readonly DailyRoundMark[]; readonly engine: GameState; readonly roundHintsUsed: number; readonly roundWrongGuesses: number },
    ): void {
      const marks = prompt?.marks ?? dailyMarks;
      const now = Date.now();
      saveDailyProgress(options.storage, {
        version: 1,
        date: challenge.date,
        seed: challenge.seed,
        stage,
        roundIndex: marks.length,
        score: Math.max(0, Math.min(DAILY_MAX_SCORE, prompt?.score ?? dailyScore)),
        marks: [...marks],
        hintsUsed: prompt?.hintsUsed ?? dailyHintsUsed,
        elapsedMs: Math.max(0, now - dailyStartedAt),
        engine: prompt ? createSoloSave(options.countryIndex, prompt.engine, now) : null,
        roundHintsUsed: prompt?.roundHintsUsed ?? 0,
        roundWrongGuesses: prompt?.roundWrongGuesses ?? 0,
        updatedAt: now,
      }, progressUserId);
    }

    // Leaving the daily keeps its per-round save; say so rather than asking.
    function leaveDaily(go: () => void): void {
      go();
      showNotice("Your daily progress is saved — resume any time today.");
    }

    function normalizedDailyMarks(): readonly DailyRoundMark[] {
      const marks = dailyMarks.slice(0, DAILY_COUNTRY_COUNT);
      while (marks.length < DAILY_COUNTRY_COUNT) marks.push("miss");
      return marks;
    }

    function addDailyMark(mark: DailyRoundMark): void {
      if (dailyMarks.length < DAILY_COUNTRY_COUNT) dailyMarks.push(mark);
    }

    function finishDailyChallenge(): void {
      const result = createDailyResultSave({
        date: challenge.date,
        seed: challenge.seed,
        score: Math.max(0, Math.min(DAILY_MAX_SCORE, dailyScore)),
        timeMs: Math.max(0, Date.now() - dailyStartedAt),
        hintsUsed: dailyHintsUsed,
        marks: normalizedDailyMarks(),
      });
      const completionUserId = authControls.getUser()?.id ?? null;
      saveDailyResult(options.storage, result, completionUserId);
      clearDailyProgress(options.storage, progressUserId);
      activeDailyScreen = null;
      mountDailyResult(result);
      if (completionUserId) {
        const completionRun = navigationRun;
        void saveDailyChallengeResult(dailyLocalResultToAccount(result)).then((synced) => {
          if (!synced || completionRun !== navigationRun || authControls.getUser()?.id !== completionUserId) return;
          const accountResult = dailyAccountResultToLocal(synced);
          saveDailyResult(options.storage, accountResult, completionUserId);
          mountDailyResult(accountResult);
        });
      }
    }

    // Stage screens share these: leaving says the daily is saved; the header daily link is a no-op.
    const dailyStageNav = {
      onGameModeChange: (gameMode: GameModeId) => leaveDaily(() => handleGameModeChange(gameMode)),
      onHome: () => leaveDaily(() => navigate({ type: "landing" })),
      onMultiplayer: () => leaveDaily(() => navigate({ type: "multiplayer" })),
      onDailyChallenge: () => undefined,
    };

    function startDailyStreetViewRound(): void {
      persistDaily("street-view");
      const round = streetViewCountryRounds.find((item) => item.countryCode === challenge.streetViewCountryCode && options.countryIndex.byCode.has(item.countryCode));
      if (!round) {
        addDailyMark("miss");
        finishDailyChallenge();
        return;
      }

      mountDaily(
        createStreetViewCountryScreen({ shell,
          countryIndex: options.countryIndex,
          ...dailyStageNav,
          dailyChallenge: {
            date: challenge.date,
            round,
            progress: { round: Math.min(DAILY_COUNTRY_COUNT, dailyMarks.length + 1), total: DAILY_COUNTRY_COUNT },
            onComplete: ({ missed, wrongGuesses }) => {
              dailyScore += scoreDailyRound(0, missed, wrongGuesses);
              addDailyMark(missed ? "miss" : wrongGuesses > 0 ? "hint" : "correct");
              finishDailyChallenge();
            },
          },
        }),
      );
    }

    async function startDailyMapTapRound(): Promise<void> {
      persistDaily("map-tap");
      const location = findMapTapLocation(challenge.mapTapTargetId);
      if (!location) {
        addDailyMark("miss");
        startDailyStreetViewRound();
        return;
      }

      const { createMapTapScreen } = await import("../ui/screens/MapTapScreen");
      if (run !== navigationRun) return;

      mountDaily(
        createMapTapScreen({ shell,
          ...dailyStageNav,
          dailyChallenge: {
            date: challenge.date,
            target: location,
            progress: { round: Math.min(DAILY_COUNTRY_COUNT, dailyMarks.length + 1), total: DAILY_COUNTRY_COUNT },
            onComplete: (mapTapResult) => {
              const points = scoreDailyMapTapRound(mapTapResult.score, mapTapResult.maxScore);
              dailyScore += points;
              addDailyMark(points >= DAILY_POINTS_PER_ROUND ? "correct" : points > 0 ? "hint" : "miss");
              startDailyStreetViewRound();
            },
          },
        }),
      );
    }

    if (resumeStage === "map-tap") {
      await startDailyMapTapRound();
      return;
    }
    if (resumeStage === "street-view") {
      startDailyStreetViewRound();
      return;
    }

    const engine = createGameEngine({
      countryIndex: options.countryIndex,
      categoryIds: challenge.categoryIds,
      seed: challenge.seed,
      poolCountryIds: challenge.countryIds,
      // Same deterministic ramp as solo: famous countries first, widening out. Keeps the
      // daily winnable for casual players while staying identical for everyone that day.
      poolOrdering: "fame-ramp",
      now: dailyStartedAt,
      ...(restoredPromptState ? { initialState: restoredPromptState } : {}),
    });
    const restoredPrompt = saved?.stage === "prompt" && restoredPromptState
      ? { score: saved.score, hintsUsed: saved.hintsUsed, marks: saved.marks, roundHintsUsed: saved.roundHintsUsed, roundWrongGuesses: saved.roundWrongGuesses }
      : undefined;
    const promptProgress = restoredPrompt ?? { score: 0, hintsUsed: 0, marks: [], roundHintsUsed: 0, roundWrongGuesses: 0 };
    persistDaily("prompt", { ...promptProgress, engine: engine.getState() });

    mountDaily(
      createSoloGameScreen({ shell,
        countryIndex: options.countryIndex,
        engine,
        selectedGameMode: "flags",
        storage: options.storage,
        worldCountryFeatures,
        onGameModeChange: dailyStageNav.onGameModeChange,
        onHome: dailyStageNav.onHome,
        onReset: () => undefined,
        onStateChange: () => undefined,
        onMultiplayer: dailyStageNav.onMultiplayer,
        onDailyChallenge: () => undefined,
        // "Back to modes": the game list. The daily is saved and resumes on return.
        onExitDailyChallenge: () => leaveDaily(() => navigate({ type: "landing" })),
        onLeaderboard: () => leaveDaily(() => navigate({ type: "leaderboard", mode: "flags" })),
        getAuthUser: () => authControls.getUser(),
        authControls,
        dailyChallenge: {
          date: challenge.date,
          ...(restoredPrompt ? { initialProgress: restoredPrompt } : {}),
          onProgress: (progress) => persistDaily("prompt", { ...progress, engine: engine.getState() }),
          onComplete: (dailyResult) => {
            dailyScore += dailyResult.score;
            dailyHintsUsed += dailyResult.hintsUsed;
            for (const mark of dailyResult.marks) addDailyMark(mark);
            runNavigation(startDailyMapTapRound());
          },
        },
      }),
    );
  }

  // Switching games never discards a saved run: each mode resumes its own practice save.
  function handleGameModeChange(gameMode: GameModeId): void {
    navigationRun += 1;

    if (isPromptGameModeId(gameMode)) {
      navigate({ type: "solo-game", categoryIds: [gameMode] });
      return;
    }

    if (isWorldMapGameModeId(gameMode)) {
      navigate({ type: "country-guessing", mode: gameMode });
      return;
    }

    if (isStreetViewGameModeId(gameMode)) {
      navigate({ type: gameMode === "geoguessr" ? "geoguessr" : "streetview-country" });
      return;
    }

    if (isMapTapGameModeId(gameMode)) {
      navigate({ type: "map-tap" });
      return;
    }

    if (isWorldSplitGameModeId(gameMode)) {
      navigate({ type: "worldsplit" });
    }
  }

  function createLoadingScreen(message: string): Screen {
    const element = document.createElement("section");
    element.className = "game-screen loading-screen";
    element.append(
      el("span", { className: "loading-mark", attrs: { "aria-hidden": "true" } }),
      el("h1", { text: "Loading…" }),
      el("p", { text: message, attrs: { role: "status" } }),
      el("button", { className: "ghost-action", text: "Back to home", attrs: { type: "button" }, on: { click: () => navigate({ type: "landing" }) } }),
    );

    return {
      element,
      destroy: () => undefined,
    };
  }

  function showLoadError(error: unknown): void {
    const route = historyState()?.route ?? { type: "landing" };
    console.error("Unable to open game screen", error);
    const screen = createLoadingScreen("Please check your connection and try again.");
    screen.element.classList.add("is-error");
    screen.element.querySelector("h1")!.textContent = "Couldn’t load this page.";
    screen.element.querySelector("p")!.setAttribute("role", "alert");
    screen.element.append(el("button", { className: "primary-action", text: "Try again", attrs: { type: "button" }, on: { click: () => navigate(route, { push: false }) } }));
    mount(screen);
  }

  function runNavigation(task: Promise<unknown>): void {
    const run = navigationRun;
    void task.catch((error: unknown) => { if (run === navigationRun) showLoadError(error); });
  }

  async function startCountryGuessing(initialMode: WorldMapGameModeId = "name-all", runType: RunType = "practice", continent?: string): Promise<void> {
    const run = navigationRun;
    const loading = createLoadingScreen("Loading world map...");
    mount(loading);

    try {
      const [worldCountryFeatures, { createCountryGuessingScreen }] = await Promise.all([loadWorldCountryFeatures(), import("../ui/screens/CountryGuessingScreen")]);

      if (run !== navigationRun) {
        return;
      }

      mount(
        createCountryGuessingScreen({ shell,
          countryIndex: options.countryIndex,
          worldCountryFeatures,
          storage: options.storage,
          initialMode,
          run: runType,
          ...(continent ? { puzzleContinent: continent } : {}),
          onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
          onHome: () => navigate({ type: "landing" }),
          onMultiplayer: () => navigate({ type: "multiplayer" }),
          onDailyChallenge: () => navigate({ type: "daily-challenge" }),
          onRecordGame: (r) => void recordWorldMapGame(r),
          onViewStats: () => navigate({ type: "stats" }),
          onViewFriends: () => navigate({ type: "friends" }),
          authControls,
          onLeaderboard: () => navigate({ type: "leaderboard", mode: initialMode }),
          getAuthUser: () => authControls.getUser(),
        }),
      );
    } catch (error) {
      if (run !== navigationRun) {
        return;
      }

      showLoadError(error);
    }
  }

  async function startStreetViewCountry(): Promise<void> {
    const run = navigationRun;
    mount(createLoadingScreen("Finding a street to explore…"));
    const { createStreetViewCountryScreen } = await import("../ui/screens/StreetViewCountryScreen");
    if (run !== navigationRun) return;
    mount(
      createStreetViewCountryScreen({ shell,
        countryIndex: options.countryIndex,
        onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
        onHome: () => navigate({ type: "landing" }),
        onMultiplayer: () => navigate({ type: "multiplayer" }),
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
      }),
    );
  }

  async function startGeoGuessr(): Promise<void> {
    const run = navigationRun;
    mount(createLoadingScreen("Preparing your first location..."));

    const { createGeoGuessrScreen } = await import("../ui/screens/GeoGuessrScreen");
    if (run !== navigationRun) return;

    mount(
      createGeoGuessrScreen({ shell,
        countryIndex: options.countryIndex,
        storage: options.storage,
        onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
        onHome: () => navigate({ type: "landing" }),
        onMultiplayer: () => navigate({ type: "multiplayer" }),
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
      }),
    );
  }

  async function startMapTap(): Promise<void> {
    const run = navigationRun;
    mount(createLoadingScreen("Loading MapTap..."));

    const { createMapTapScreen } = await import("../ui/screens/MapTapScreen");
    if (run !== navigationRun) return;

    mount(
      createMapTapScreen({ shell,
        onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
        onHome: () => navigate({ type: "landing" }),
        onMultiplayer: () => navigate({ type: "multiplayer" }),
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
        storage: options.storage,
      }),
    );
  }

  async function startWorldSplit(): Promise<void> {
    const run = navigationRun;
    const loading = createLoadingScreen("Loading Worldsplit...");
    mount(loading);

    try {
      const [worldCountryFeatures, screenModule] = await Promise.all([
        loadWorldCountryFeatures(),
        import("../ui/screens/WorldSplitScreen"),
      ]);
      if (run !== navigationRun) return;

      mount(
        screenModule.createWorldSplitScreen({ shell,
          worldCountryFeatures,
          storage: options.storage,
          onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
          onHome: () => navigate({ type: "landing" }),
          onMultiplayer: () => navigate({ type: "multiplayer" }),
          onDailyChallenge: () => navigate({ type: "daily-challenge" }),
        }),
      );
    } catch (error) {
      if (run !== navigationRun) return;
      showLoadError(error);
    }
  }

  async function startMultiplayer(joinCode?: string): Promise<void> {
    const run = navigationRun;
    const loading = createLoadingScreen("Loading multiplayer...");
    mount(loading);

    let worldCountryFeatures: readonly WorldCountryFeature[];
    try {
      worldCountryFeatures = await loadWorldCountryFeatures();
    } catch (error) {
      if (run !== navigationRun) return;
      showLoadError(error);
      return;
    }

    if (run !== navigationRun) return;

    const { createMultiplayerLobbyScreen } = await import("../ui/screens/MultiplayerLobbyScreen");
    if (run !== navigationRun) return;
    mount(
      createMultiplayerLobbyScreen({ shell,
        countryIndex: options.countryIndex,
        worldCountryFeatures,
        createOnlineTransport: createDefaultOnlineTransport,
        onBackToSolo: () => goBack(),
        onHome: () => navigate({ type: "landing" }),
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
        authControls,
        ...(joinCode ? { initialJoinCode: joinCode } : {}),
      }),
    );
  }

  // Academy screens (hub, lesson, placement, country profile) all need the world map and are
  // lazy-loaded, so they share one loader.
  async function startAcademyScreen(route: Extract<AppRoute, { type: "academy" | "academy-lesson" | "academy-placement" | "country-profile" }>): Promise<void> {
    const run = navigationRun;
    mount(createLoadingScreen(route.type === "country-profile" ? "Opening the atlas…" : "Opening the Academy…"));
    const worldCountryFeatures = await loadWorldCountryFeatures();
    if (run !== navigationRun) return;
    const shared = { shell, countryIndex: options.countryIndex, worldCountryFeatures, progressStore: academyProgress };
    const openAcademy = (groupId?: string) => navigate({ type: "academy", ...(groupId ? { groupId } : {}) });
    // Leaving a lesson or placement pops back to the hub entry it was opened from (so browser Back
    // doesn't re-enter the finished lesson); the hub restores its own open group from that entry.
    const exitToAcademy = (groupId?: string) => returnTo({ type: "academy", ...(groupId ? { groupId } : {}) });
    const startLesson = (lessonId: string) => navigate({ type: "academy-lesson", lessonId });
    const openCountry = (code: string) => navigate({ type: "country-profile", code: code.toUpperCase() });

    if (route.type === "academy") {
      const { createAcademyScreen } = await import("../ui/screens/AcademyScreen");
      if (run !== navigationRun) return;
      mount(createAcademyScreen({
        ...shared,
        ...(route.groupId ? { initialGroupId: route.groupId } : {}),
        onHome: () => navigate({ type: "landing" }),
        onBack: () => goBack(),
        onStartLesson: startLesson,
        onStartPlacement: () => navigate({ type: "academy-placement" }),
        onOpenCountry: openCountry,
        onOpenAtlas: () => navigate({ type: "atlas" }),
        onGroupChange: (groupId) => {
          const next: AppRoute = { type: "academy", ...(groupId ? { groupId } : {}) };
          const current = historyState();
          window.history.replaceState({ route: next, idx: current?.idx ?? 0, ...(current?.prev ? { prev: current.prev } : {}) } satisfies HistoryState, "", buildRouteUrl(next, window.location));
        },
      }));
      return;
    }
    if (route.type === "academy-lesson") {
      const { createLessonScreen } = await import("../ui/screens/LessonScreen");
      if (run !== navigationRun) return;
      mount(createLessonScreen({ ...shared, lessonId: route.lessonId, onExit: exitToAcademy, onStartLesson: startLesson, onOpenCountry: openCountry }));
      return;
    }
    if (route.type === "academy-placement") {
      const { createPlacementScreen } = await import("../ui/screens/PlacementScreen");
      if (run !== navigationRun) return;
      mount(createPlacementScreen({ ...shared, onDone: exitToAcademy, onStartLesson: startLesson }));
      return;
    }
    const { createCountryProfileScreen } = await import("../ui/screens/CountryProfileScreen");
    if (run !== navigationRun) return;
    mount(createCountryProfileScreen({
      ...shared,
      code: route.code,
      onBack: () => goBack(),
      onHome: () => navigate({ type: "landing" }),
      onOpenCountry: openCountry,
      onFlipCountry: (code) => navigate({ type: "country-profile", code: code.toUpperCase() }, { replace: true }),
      onStartLesson: startLesson,
      onOpenAcademy: openAcademy,
      onOpenAtlas: () => returnTo({ type: "atlas" }),
    }));
  }

  /** Learn → Atlas: the index of every country (lazy: it carries the profile data). */
  async function startAtlas(): Promise<void> {
    const run = navigationRun;
    mount(createLoadingScreen("Opening the atlas…"));
    const { createAtlasScreen } = await import("../ui/screens/AtlasScreen");
    if (run !== navigationRun) return;
    mount(createAtlasScreen({ shell, countryIndex: options.countryIndex, progressStore: academyProgress, onOpenAcademy: () => navigate({ type: "academy" }) }));
  }

  /** Compete (also the legacy `leaderboard` route). Picking a board replaces the URL, it doesn't push. */
  function startCompete(mode?: GameModeId, variant?: string): void {
    mount(
      createCompeteScreen({
        shell,
        storage: options.storage,
        ...(mode ? { mode } : {}),
        ...(variant ? { variant } : {}),
        onSelect: (nextMode, nextVariant) => replaceRoute({ type: "compete", mode: nextMode, ...(nextVariant ? { variant: nextVariant } : {}) }),
        onMultiplayer: () => navigate({ type: "multiplayer" }),
      }),
    );
  }

  function navigate(route: AppRoute, navigateOptions?: NavigateOptions): void {
    // Already playing the daily: re-selecting it resumes in place rather than restarting it.
    if (route.type === "daily-challenge" && navigateOptions?.push !== false && activeDailyScreen !== null && activeScreen === activeDailyScreen) return;
    navigationRun += 1;
    if (navigateOptions?.replace) replaceRoute(route);
    else if (navigateOptions?.push !== false) pushRoute(route);
    if (route.type === "landing") {
      mount(createLandingScreen({ shell, storage: options.storage }));
      return;
    }
    if (route.type === "solo-game") {
      runNavigation(startSolo(route.categoryIds, route.continueSaved ?? false, route.flagPool, route.run === "timed" ? "timed" : "practice"));
      return;
    }
    const leavingSolo = recordSoloSession(lastSoloState);
    lastSoloState = null;
    if (route.type === "compete" || route.type === "leaderboard") {
      startCompete(route.mode, route.variant);
      return;
    }
    // `flag-gallery` is the legacy name for the Atlas (`?view=flags`).
    if (route.type === "atlas" || route.type === "flag-gallery") {
      runNavigation(startAtlas());
      return;
    }
    if (route.type === "daily-challenge") {
      runNavigation(startDailyChallenge());
      return;
    }

    if (route.type === "country-guessing") {
      runNavigation(startCountryGuessing(route.mode ?? "name-all", route.run === "timed" ? "timed" : "practice", route.continent));
      return;
    }
    if (route.type === "streetview-country") {
      runNavigation(startStreetViewCountry());
      return;
    }
    if (route.type === "geoguessr") {
      runNavigation(startGeoGuessr());
      return;
    }
    if (route.type === "map-tap") {
      runNavigation(startMapTap());
      return;
    }
    if (route.type === "worldsplit") {
      runNavigation(startWorldSplit());
      return;
    }
    if (route.type === "multiplayer") {
      runNavigation(startMultiplayer(route.joinCode));
      return;
    }
    if (route.type === "stats") {
      // Await the record so the just-finished run appears in the freshly fetched stats.
      const run = navigationRun;
      mount(createLoadingScreen("Gathering your discoveries…"));
      runNavigation(leavingSolo.then(() => {
        if (run !== navigationRun) return;
        const initialTab = pendingStatsTab;
        pendingStatsTab = "stats";
        mount(createStatsScreen({ shell, storage: options.storage, initialTab, onFriends: () => navigate({ type: "friends" }) }));
      }));
      return;
    }

    if (route.type === "friends") {
      const currentUser = authControls.getUser();
      mount(createFriendsScreen({ shell,
        onOpenTab: (tab) => {
          pendingStatsTab = tab;
          navigate({ type: "stats" });
        },
        ...(route.username ? { initialUsername: route.username } : {}),
        currentUsername: currentUser?.displayName ?? null,
        appOrigin: window.location.origin,
        subscribe: (listener) => social.subscribe((message: SocialServerMessage) => {
          if (message.type !== "GAME_INVITE") listener();
        }),
      }));
      return;
    }

    if (route.type === "academy" || route.type === "academy-lesson" || route.type === "academy-placement" || route.type === "country-profile") {
      runNavigation(startAcademyScreen(route));
    }
  }

  // Surface incoming game invites as a dismissible toast anywhere in the app.
  function showGameInvite(fromUsername: string, roomCode: string): void {
    const join = el("button", { className: "primary-action", text: "Join", attrs: { type: "button" } });
    const dismiss = el("button", { className: "ghost-action", text: "Dismiss", attrs: { type: "button" } });
    const toast = el("div", {
      className: "game-invite-toast",
      children: [el("span", { className: "invite-toast-text", text: `${fromUsername} invited you to a game` }), join, dismiss],
    });
    const close = () => { clearTimeout(timer); toast.remove(); };
    const timer = setTimeout(close, 30000);
    join.addEventListener("click", () => {
      close();
      // Joining leaves any room you're in (or a lesson in progress); ask first.
      void confirmLeaveActiveScreen().then((leave) => { if (leave) navigate({ type: "multiplayer", joinCode: roomCode }); });
    });
    dismiss.addEventListener("click", close);
    options.root.append(toast);
  }

  social.subscribe((message) => {
    if (message.type === "GAME_INVITE") showGameInvite(message.from.username, message.roomCode);
  });

  return {
    start: () => {
      const initialRoute = routeFromLocation(window.location) ?? { type: "landing" };
      const initialHash = initialRoute.type === "landing" && ["#games", "#landing-title"].includes(window.location.hash) ? window.location.hash : "";
      window.history.replaceState({ route: initialRoute, idx: 0 } satisfies HistoryState, "", `${buildRouteUrl(initialRoute, window.location)}${initialHash}`);
      window.addEventListener("popstate", (event) => {
        const state = event.state as Partial<HistoryState> | null;
        // Native in-page anchors keep the landing page mounted and preserve scrolling.
        if (!state?.route && !window.location.search && activeScreen?.element.classList.contains("landing-screen-shell")) return;
        navigate(state?.route ?? routeFromLocation(window.location) ?? { type: "landing" }, { push: false });
      });
      navigate(initialRoute, { push: false });
    },
    navigate,
  };
}
