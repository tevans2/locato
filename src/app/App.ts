import { type CountryIndex } from "../core/countries";
import { createGameEngine, createRandomSeed, type GameEngine, type GameState } from "../core/game";
import { DEFAULT_CATEGORY_IDS, resolveCategoryIds } from "../core/categories";
import { clearSoloSave, hydrateGameState, readSoloSave, saveSoloGame } from "../storage/localSave";
import { createWebSocketMultiplayerTransport, resolveDefaultWebSocketUrl, type MultiplayerTransport } from "../core/multiplayer";
import { loadWorldCountryFeatures, type WorldCountryFeature } from "../core/map";
import { createCountryGuessingScreen } from "../ui/screens/CountryGuessingScreen";
import { createAuthControls } from "../ui/components/AuthPanel";
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

  // Auth controls persist across navigation (sign-in state shouldn't reset when switching screens).
  // The trigger lives in each screen's header; the panel is a fixed overlay attached to the root.
  const authControls = createAuthControls({ onAuthChange: () => undefined });
  options.root.appendChild(authControls.panel);

  function mount(screen: Screen): void {
    activeScreen?.destroy();
    activeScreen = screen;
    options.root.replaceChildren(screen.element);
    // Keep the auth panel attached (it was appended to root, not inside the screen element).
    options.root.appendChild(authControls.panel);
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
        authControls,
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
      void startMultiplayer();
      return;
    }
  }

  return {
    start: () => navigate({ type: "solo-game", continueSaved: true }),
    navigate,
  };
}
