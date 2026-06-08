import { type CountryIndex } from "../core/countries";
import { createGameEngine, createRandomSeed, type GameEngine, type GameState } from "../core/game";
import { DEFAULT_CATEGORY_IDS, resolveCategoryIds } from "../core/categories";
import { clearSoloSave, hydrateGameState, readSoloSave, saveSoloGame } from "../storage/localSave";
import { createWebSocketMultiplayerTransport, resolveDefaultWebSocketUrl, type MultiplayerTransport } from "../core/multiplayer";
import { loadWorldCountryFeatures } from "../core/map";
import { createCountryGuessingScreen } from "../ui/screens/CountryGuessingScreen";
import { createSoloGameScreen } from "../ui/screens/SoloGameScreen";
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

  function mount(screen: Screen): void {
    activeScreen?.destroy();
    activeScreen = screen;
    options.root.replaceChildren(screen.element);
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
        categoryIds: activeCategories,
        onCategoryChange: (nextCategoryIds) => {
          clearSoloSave(options.storage);
          startSolo(nextCategoryIds, false);
        },
        onReset: () => clearSoloSave(options.storage),
        onStateChange: (state) => saveSoloGame(options.storage, options.countryIndex, state),
        onCountryGuessing: () => navigate({ type: "country-guessing" }),
        onMultiplayer: () => navigate({ type: "multiplayer" }),
      }),
    );
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

  async function startCountryGuessing(): Promise<void> {
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
          onBackToSolo: () => {
            const save = readSoloSave(options.storage);
            startSolo(save?.categoryIds ?? DEFAULT_CATEGORY_IDS, save !== null);
          },
          onMultiplayer: () => navigate({ type: "multiplayer" }),
        }),
      );
    } catch (error) {
      if (run !== navigationRun) {
        return;
      }

      loading.element.textContent = error instanceof Error ? error.message : "Unable to load world map data.";
    }
  }

  function startMultiplayer(): void {
    mount(
      createMultiplayerLobbyScreen({
        createOnlineTransport: createDefaultOnlineTransport,
        onBackToSolo: () => {
          const save = readSoloSave(options.storage);
          startSolo(save?.categoryIds ?? DEFAULT_CATEGORY_IDS, save !== null);
        },
      }),
    );
  }

  function navigate(route: AppRoute): void {
    navigationRun += 1;

    if (route.type === "solo-game") {
      startSolo(route.categoryIds ?? DEFAULT_CATEGORY_IDS, route.continueSaved ?? false);
      return;
    }

    if (route.type === "country-guessing") {
      startCountryGuessing();
      return;
    }

    if (route.type === "multiplayer") {
      startMultiplayer();
      return;
    }
  }

  return {
    start: () => navigate({ type: "solo-game", continueSaved: true }),
    navigate,
  };
}