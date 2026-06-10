import { type CountryIndex } from "../core/countries";
import { createGameEngine, createRandomSeed, type GameEngine, type GameState } from "../core/game";
import { DEFAULT_CATEGORY_IDS, resolveCategoryIds } from "../core/categories";
import { isPromptGameModeId, isWorldMapGameModeId, promptGameModeFromCategoryIds, type GameModeId, type WorldMapGameModeId } from "../core/gameModes";
import { clearSoloSave, hydrateGameState, readSoloSave, saveSoloGame } from "../storage/localSave";
import { createWebSocketMultiplayerTransport, resolveDefaultWebSocketUrl, type MultiplayerTransport } from "../core/multiplayer";
import { loadWorldCountryFeatures, type WorldCountryFeature } from "../core/map";
import { recordGame } from "../core/auth";
import { createCountryGuessingScreen, type WorldMapRunResult } from "../ui/screens/CountryGuessingScreen";
import { createAuthControls } from "../ui/components/AuthPanel";
import { createSoloGameScreen } from "../ui/screens/SoloGameScreen";
import { createStatsScreen } from "../ui/screens/StatsScreen";
import { createLeaderboardScreen } from "../ui/screens/LeaderboardScreen";
import { createMultiplayerLobbyScreen } from "../ui/screens/MultiplayerLobbyScreen";
import type { AppRoute, Screen } from "./router";

export interface AppOptions {
  readonly root: HTMLElement;
  readonly countryIndex: CountryIndex;
  readonly storage: Storage;
}

export interface App {
  readonly start: () => void;
  readonly navigate: (route: AppRoute) => void;
}

function createEngine(countryIndex: CountryIndex, categoryIds: readonly string[], initialState: GameState | null): GameEngine {
  return createGameEngine({
    countryIndex,
    categoryIds,
    seed: initialState?.seed ?? createRandomSeed(),
    ...(initialState ? { initialState } : {}),
  });
}

function createDefaultOnlineTransport(): MultiplayerTransport {
  return createWebSocketMultiplayerTransport(resolveDefaultWebSocketUrl(window.location));
}

export function createApp(options: AppOptions): App {
  let activeScreen: Screen | null = null;
  let navigationRun = 0;
  let returnRoute: AppRoute = { type: "solo-game", continueSaved: true };

  // Tracks the in-flight solo session so it can be recorded when it ends (completion, reset,
  // category change, or navigating away) — not only on full 196-country completion.
  let lastSoloState: GameState | null = null;

  // Account controls persist across navigation and are fixed to the top-right of the viewport.
  const authControls = createAuthControls({ onAuthChange: () => undefined, onViewStats: () => navigate({ type: "stats" }) });

  function attachGlobalControls(): void {
    options.root.append(authControls.trigger, authControls.panel);
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

  function mount(screen: Screen): void {
    activeScreen?.destroy();
    activeScreen = screen;
    options.root.replaceChildren(screen.element);
    attachGlobalControls();
  }

  function startSolo(categoryIds: readonly string[], continueSaved = false): void {
    const resolved = resolveCategoryIds(categoryIds);
    const save = continueSaved ? readSoloSave(options.storage) : null;
    const initialState = save ? hydrateGameState(options.countryIndex, save) : null;
    const activeCategories = initialState ? initialState.categoryIds : resolved;
    const engine = createEngine(options.countryIndex, activeCategories, initialState);

    mount(
      createSoloGameScreen({
        countryIndex: options.countryIndex,
        engine,
        selectedGameMode: promptGameModeFromCategoryIds(activeCategories),
        onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
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
        onViewStats: () => navigate({ type: "stats" }),
        onLeaderboard: () => navigate({ type: "leaderboard", mode: promptGameModeFromCategoryIds(activeCategories) }),
        getAuthUser: () => authControls.getUser(),
        authControls,
        storage: options.storage,
      }),
    );
  }

  function handleGameModeChange(gameMode: GameModeId): void {
    clearSoloSave(options.storage);

    if (isPromptGameModeId(gameMode)) {
      startSolo([gameMode], false);
      return;
    }

    if (isWorldMapGameModeId(gameMode)) {
      navigate({ type: "country-guessing", mode: gameMode });
    }
  }

  function createLoadingScreen(message: string): Screen {
    const element = document.createElement("section");
    element.className = "game-screen loading-screen";
    element.textContent = message;

    return {
      element,
      destroy: () => undefined,
    };
  }

  async function startCountryGuessing(initialMode: WorldMapGameModeId = "name-all"): Promise<void> {
    const run = navigationRun;
    const loading = createLoadingScreen("Loading world map...");
    mount(loading);

    try {
      const worldCountryFeatures = await loadWorldCountryFeatures();

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
          onMultiplayer: () => navigate({ type: "multiplayer" }),
          onRecordGame: (r) => void recordWorldMapGame(r),
          onLeaderboard: () => navigate({ type: "leaderboard", mode: initialMode }),
          getAuthUser: () => authControls.getUser(),
        }),
      );
    } catch (error) {
      if (run !== navigationRun) {
        return;
      }

      loading.element.textContent = error instanceof Error ? error.message : "Unable to load world map data.";
    }
  }

  async function startMultiplayer(): Promise<void> {
    const run = navigationRun;
    const loading = createLoadingScreen("Loading multiplayer...");
    mount(loading);

    let worldCountryFeatures: readonly WorldCountryFeature[];
    try {
      worldCountryFeatures = await loadWorldCountryFeatures();
    } catch (error) {
      if (run !== navigationRun) return;
      loading.element.textContent = error instanceof Error ? error.message : "Unable to load multiplayer map data.";
      return;
    }

    if (run !== navigationRun) return;

    mount(
      createMultiplayerLobbyScreen({
        countryIndex: options.countryIndex,
        worldCountryFeatures,
        createOnlineTransport: createDefaultOnlineTransport,
        onBackToSolo: () => {
          const save = readSoloSave(options.storage);
          startSolo(save?.categoryIds ?? DEFAULT_CATEGORY_IDS, save !== null);
        },
        authControls,
      }),
    );
  }

  function startLeaderboard(mode?: GameModeId, variant?: string): void {
    mount(
      createLeaderboardScreen({
        storage: options.storage,
        ...(mode ? { initialMode: mode } : {}),
        ...(variant ? { initialVariant: variant } : {}),
        onBack: () => navigate(returnRoute),
        onSignIn: () => authControls.openPanel(),
      }),
    );
  }

  function navigate(route: AppRoute): void {
    navigationRun += 1;

    if (route.type !== "leaderboard") {
      returnRoute = route;
    }
    if (route.type === "solo-game") {
      startSolo(route.categoryIds ?? DEFAULT_CATEGORY_IDS, route.continueSaved ?? false);
      return;
    }
    // Leaving solo for any other screen ends the current run — record it first.
    const leavingSolo = recordSoloSession(lastSoloState);
    lastSoloState = null;
    if (route.type === "country-guessing") {
      void startCountryGuessing(route.mode ?? "name-all");
      return;
    }
    if (route.type === "multiplayer") {
      void startMultiplayer();
      return;
    }
    if (route.type === "stats") {
      // Await the record so the just-finished run appears in the freshly fetched stats.
      void leavingSolo.then(() => mount(createStatsScreen({ onBack: () => navigate({ type: "solo-game", continueSaved: true }) })));
      return;
    }

    if (route.type === "leaderboard") {
      startLeaderboard(route.mode, route.variant);
      return;
    }
  }

  return {
    start: () => navigate({ type: "solo-game", continueSaved: true }),
    navigate,
  };
}
