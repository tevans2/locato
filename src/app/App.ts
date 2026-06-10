import { type CountryIndex } from "../core/countries";
import { createGameEngine, createRandomSeed, type GameEngine, type GameState } from "../core/game";
import { DEFAULT_CATEGORY_IDS, resolveCategoryIds } from "../core/categories";
import { isPromptGameModeId, isWorldMapGameModeId, promptGameModeFromCategoryIds, type GameModeId, type WorldMapGameModeId } from "../core/gameModes";
import { clearSoloSave, hydrateGameState, readSoloSave, saveSoloGame } from "../storage/localSave";
import { createWebSocketMultiplayerTransport, resolveDefaultWebSocketUrl, type MultiplayerTransport } from "../core/multiplayer";
import { loadWorldCountryFeatures, type WorldCountryFeature } from "../core/map";
import { createCountryGuessingScreen } from "../ui/screens/CountryGuessingScreen";
import { createAuthControls } from "../ui/components/AuthPanel";
import { createSoloGameScreen } from "../ui/screens/SoloGameScreen";
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

  // Account controls persist across navigation and are fixed to the top-right of the viewport.
  const authControls = createAuthControls({ onAuthChange: () => undefined });

  function attachGlobalControls(): void {
    options.root.append(authControls.trigger, authControls.panel);
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
        onReset: () => clearSoloSave(options.storage),
        onStateChange: (state) => saveSoloGame(options.storage, options.countryIndex, state),
        onMultiplayer: () => navigate({ type: "multiplayer" }),
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

    if (route.type === "country-guessing") {
      void startCountryGuessing(route.mode ?? "name-all");
      return;
    }

    if (route.type === "multiplayer") {
      void startMultiplayer();
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
