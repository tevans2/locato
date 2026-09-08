import { type CountryId, type CountryIndex } from "../core/countries";
import { createGameEngine, createRandomSeed, type GameEngine, type GameState } from "../core/game";
import { createDailyChallenge, createDailyShareText, DAILY_COUNTRY_COUNT, DAILY_MAX_SCORE, DAILY_POINTS_PER_ROUND, scoreDailyMapTapRound, scoreDailyRound, type DailyRoundMark } from "../core/dailyChallenge";
import { DEFAULT_CATEGORY_IDS, resolveCategoryIds } from "../core/categories";
import { isMapTapGameModeId, isPromptGameModeId, isStreetViewGameModeId, isWorldMapGameModeId, isWorldSplitGameModeId, promptGameModeFromCategoryIds, type GameModeId, type WorldMapGameModeId } from "../core/gameModes";
import { clearSoloSave, hydrateGameState, readSoloSave, saveSoloGame } from "../storage/localSave";
import { createDailyResultSave, readDailyResult, saveDailyResult, type DailyResultSave } from "../storage/dailySave";
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
import { createLeaderboardScreen } from "../ui/screens/LeaderboardScreen";
import { createLandingScreen } from "../ui/screens/LandingScreen";
import { el } from "../ui/dom/createElement";
import { createThemeToggle } from "../ui/theme";
import { createSoundToggle } from "../ui/dom/sfx";
import { buildRouteUrl, routeFromLocation, type AppRoute, type Screen } from "./router";

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
}

interface HistoryState {
  readonly route: AppRoute;
  readonly idx: number;
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
  const authControls = createAuthControls({
    onAuthChange: (state) => {
      if (state.user) social.connect();
      else social.disconnect();
    },
    onViewStats: () => navigate({ type: "stats" }),
    onViewFriends: () => navigate({ type: "friends" }),
  });
  const landingButton = el("button", {
    className: "landing-return-action",
    text: "Home",
    attrs: { type: "button", "aria-label": "Go to the home page" },
    on: { click: () => navigate({ type: "landing" }) },
  });
  const themeToggle = createThemeToggle(options.storage);
  const soundToggle = createSoundToggle();

  const globalControls = el("div", { className: "global-controls", attrs: { "aria-label": "Account and preferences" }, children: [soundToggle, themeToggle, authControls.trigger] });

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
    window.history.pushState({ route, idx: (current?.idx ?? 0) + 1 } satisfies HistoryState, "", buildRouteUrl(route, window.location));
  }

  function goBack(): void {
    // If this is the first in-app entry (e.g. the tab opened on this screen),
    // going back would leave the site — fall back to home instead.
    if ((historyState()?.idx ?? 0) > 0) window.history.back();
    else navigate({ type: "landing" });
  }

  function attachGlobalControls(): void {
    const gamePreferences = activeScreen?.element.querySelector("[data-game-preferences]");
    // The immersive game has fixed contrast; the site theme remains available on other screens.
    globalControls.replaceChildren(soundToggle, ...(gamePreferences ? [] : [themeToggle]), authControls.trigger);
    (gamePreferences ?? options.root).append(globalControls);
    options.root.append(landingButton, authControls.panel);
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

  function dailyAccountResultToLocal(result: DailyChallengeResult): DailyResultSave {
    return { version: 2, ...result, shareText: createDailyShareText(result.date, result.score, result.timeMs, result.marks) };
  }

  function dailyLocalResultToAccount(result: DailyResultSave): DailyChallengeResult {
    const { version: _version, ...payload } = result;
    return payload;
  }

  function mountDailyResult(result: DailyResultSave): void {
    mount(
      createDailyResultScreen({
        result,
        storage: options.storage,
        onHome: () => navigate({ type: "landing" }),
        onBackToSolo: () => {
          const save = readSoloSave(options.storage);
          navigate({ type: "solo-game", categoryIds: save?.categoryIds ?? DEFAULT_CATEGORY_IDS, continueSaved: save !== null });
        },
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
        onMultiplayer: () => navigate({ type: "multiplayer" }),
      }),
    );
  }

  async function startSolo(categoryIds: readonly string[] | undefined, continueSaved = false): Promise<void> {
    const run = navigationRun;
    mount(createLoadingScreen("Preparing your game…"));
    const { createSoloGameScreen } = await import("../ui/screens/SoloGameScreen");
    if (run !== navigationRun) return;
    const resolved = resolveCategoryIds(categoryIds ?? DEFAULT_CATEGORY_IDS);
    const candidate = continueSaved ? readSoloSave(options.storage) : null;
    const matchesMode = !categoryIds || (candidate?.categoryIds.length === resolved.length && resolved.every((id) => candidate.categoryIds.includes(id)));
    const save = candidate && matchesMode && (candidate.status ?? (candidate.currentCountryCode === null ? "complete" : "playing")) !== "complete" ? candidate : null;
    const initialState = save ? hydrateGameState(options.countryIndex, save) : null;
    const activeCategories = initialState ? initialState.categoryIds : resolved;
    if (initialState) {
      const current = historyState();
      const resumedRoute: AppRoute = { type: "solo-game", categoryIds: activeCategories, continueSaved: true };
      window.history.replaceState({ route: resumedRoute, idx: current?.idx ?? 0 } satisfies HistoryState, "", buildRouteUrl(resumedRoute, window.location));
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

    const engine = createEngine(options.countryIndex, activeCategories, initialState);

    mount(
      createSoloGameScreen({
        countryIndex: options.countryIndex,
        engine,
        selectedGameMode: promptGameModeFromCategoryIds(activeCategories),
        onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
        onHome: () => navigate({ type: "landing" }),
        onReset: () => {
          // Record the finished run before starting a fresh one.
          void recordSoloSession(lastSoloState);
          lastSoloState = null;
          clearSoloSave(options.storage);
        },
        onStateChange: (state) => {
          saveSoloGame(options.storage, options.countryIndex, state);
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
        onLeaderboard: () => navigate({ type: "leaderboard", mode: promptGameModeFromCategoryIds(activeCategories) }),
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

    const dailyStartedAt = Date.now();
    let dailyScore = 0;
    let dailyHintsUsed = 0;
    const dailyMarks: DailyRoundMark[] = [];

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

    function startDailyStreetViewRound(): void {
      const round = streetViewCountryRounds.find((item) => item.countryCode === challenge.streetViewCountryCode && options.countryIndex.byCode.has(item.countryCode));
      if (!round) {
        addDailyMark("miss");
        finishDailyChallenge();
        return;
      }

      mount(
        createStreetViewCountryScreen({
          countryIndex: options.countryIndex,
          onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
          onHome: () => navigate({ type: "landing" }),
          onMultiplayer: () => navigate({ type: "multiplayer" }),
          onDailyChallenge: () => navigate({ type: "daily-challenge" }),
          dailyChallenge: {
            date: challenge.date,
            round,
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
      const location = findMapTapLocation(challenge.mapTapTargetId);
      if (!location) {
        addDailyMark("miss");
        startDailyStreetViewRound();
        return;
      }

      const { createMapTapScreen } = await import("../ui/screens/MapTapScreen");
      if (run !== navigationRun) return;

      mount(
        createMapTapScreen({
          onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
          onHome: () => navigate({ type: "landing" }),
          onMultiplayer: () => navigate({ type: "multiplayer" }),
          onDailyChallenge: () => navigate({ type: "daily-challenge" }),
          dailyChallenge: {
            date: challenge.date,
            target: location,
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

    const engine = createGameEngine({
      countryIndex: options.countryIndex,
      categoryIds: challenge.categoryIds,
      seed: challenge.seed,
      poolCountryIds: challenge.countryIds,
      // Same deterministic ramp as solo: famous countries first, widening out. Keeps the
      // daily winnable for casual players while staying identical for everyone that day.
      poolOrdering: "fame-ramp",
      now: dailyStartedAt,
    });

    mount(
      createSoloGameScreen({
        countryIndex: options.countryIndex,
        engine,
        selectedGameMode: "flags",
        storage: options.storage,
        worldCountryFeatures,
        onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
        onHome: () => navigate({ type: "landing" }),
        onReset: () => undefined,
        onStateChange: () => undefined,
        onMultiplayer: () => navigate({ type: "multiplayer" }),
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
        onExitDailyChallenge: () => navigate({ type: "solo-game", continueSaved: true }),
        onLeaderboard: () => navigate({ type: "leaderboard", mode: "flags" }),
        getAuthUser: () => authControls.getUser(),
        authControls,
        dailyChallenge: {
          date: challenge.date,
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

  function handleGameModeChange(gameMode: GameModeId): void {
    navigationRun += 1;
    clearSoloSave(options.storage);

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
      el("h1", { text: "A little adventure awaits." }),
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
    screen.element.querySelector("h1")!.textContent = "We couldn’t open that adventure.";
    screen.element.querySelector("p")!.setAttribute("role", "alert");
    screen.element.append(el("button", { className: "primary-action", text: "Try again", attrs: { type: "button" }, on: { click: () => navigate(route, { push: false }) } }));
    mount(screen);
  }

  function runNavigation(task: Promise<unknown>): void {
    const run = navigationRun;
    void task.catch((error: unknown) => { if (run === navigationRun) showLoadError(error); });
  }

  async function startCountryGuessing(initialMode: WorldMapGameModeId = "name-all"): Promise<void> {
    const run = navigationRun;
    const loading = createLoadingScreen("Loading world map...");
    mount(loading);

    try {
      const [worldCountryFeatures, { createCountryGuessingScreen }] = await Promise.all([loadWorldCountryFeatures(), import("../ui/screens/CountryGuessingScreen")]);

      if (run !== navigationRun) {
        return;
      }

      mount(
        createCountryGuessingScreen({
          countryIndex: options.countryIndex,
          worldCountryFeatures,
          storage: options.storage,
          initialMode,
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
      createStreetViewCountryScreen({
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
      createGeoGuessrScreen({
        countryIndex: options.countryIndex,
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
      createMapTapScreen({
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
        screenModule.createWorldSplitScreen({
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
      createMultiplayerLobbyScreen({
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

  function startLeaderboard(mode?: GameModeId, variant?: string): void {
    mount(
      createLeaderboardScreen({
        storage: options.storage,
        ...(mode ? { initialMode: mode } : {}),
        ...(variant ? { initialVariant: variant } : {}),
        onHome: () => navigate({ type: "landing" }),
        onBack: () => goBack(),
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
        onSignIn: () => authControls.openPanel(),
      }),
    );
  }

  function navigate(route: AppRoute, navigateOptions?: NavigateOptions): void {
    navigationRun += 1;
    if (navigateOptions?.push !== false) pushRoute(route);
    if (route.type === "landing") {
      mount(
        createLandingScreen({
          accountControl: authControls.trigger,
          onHome: () => navigate({ type: "landing" }),
          onPlay: () => navigate({ type: "solo-game", continueSaved: true }),
          onDailyChallenge: () => navigate({ type: "daily-challenge" }),
          onGameMode: (gameMode) => handleGameModeChange(gameMode),
          onLeaderboard: () => navigate({ type: "leaderboard" }),
          onMultiplayer: () => navigate({ type: "multiplayer" }),
          storage: options.storage,
          getAuthUser: () => authControls.getUser(),
        }),
        false,
      );
      return;
    }
    if (route.type === "solo-game") {
      runNavigation(startSolo(route.categoryIds, route.continueSaved ?? false));
      return;
    }
    const leavingSolo = recordSoloSession(lastSoloState);
    lastSoloState = null;
    if (route.type === "daily-challenge") {
      runNavigation(startDailyChallenge());
      return;
    }

    if (route.type === "country-guessing") {
      runNavigation(startCountryGuessing(route.mode ?? "name-all"));
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
        if (run === navigationRun) mount(createStatsScreen({ onHome: () => navigate({ type: "landing" }), onBack: () => goBack(), onDailyChallenge: () => navigate({ type: "daily-challenge" }) }));
      }));
      return;
    }

    if (route.type === "friends") {
      const currentUser = authControls.getUser();
      mount(createFriendsScreen({
        onBack: () => goBack(),
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
        ...(route.username ? { initialUsername: route.username } : {}),
        currentUsername: currentUser?.displayName ?? null,
        appOrigin: window.location.origin,
        subscribe: (listener) => social.subscribe((message: SocialServerMessage) => {
          if (message.type !== "GAME_INVITE") listener();
        }),
      }));
      return;
    }

    if (route.type === "leaderboard") {
      startLeaderboard(route.mode, route.variant);
      return;
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
    join.addEventListener("click", () => { close(); navigate({ type: "multiplayer", joinCode: roomCode }); });
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
