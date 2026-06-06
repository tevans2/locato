import { type Continent, type CountryIndex } from "../core/countries";
import { createGameEngine, createRandomSeed, type GameEngine, type GameState } from "../core/game";
import { getGameMode, type GameMode, type GameModeId } from "../core/modes";
import { clearSoloSave, hydrateGameState, readSoloSave, saveSoloGame } from "../storage/localSave";
import { createHomeScreen } from "../ui/screens/HomeScreen";
import { createModeSelectScreen } from "../ui/screens/ModeSelectScreen";
import { createMultiplayerLobbyScreen } from "../ui/screens/MultiplayerLobbyScreen";
import { createSoloGameScreen } from "../ui/screens/SoloGameScreen";
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

function createEngine(countryIndex: CountryIndex, mode: GameMode, continent: Continent | undefined, initialState: GameState | null): GameEngine {
  return createGameEngine({
    countryIndex,
    mode,
    seed: initialState?.seed ?? createRandomSeed(),
    ...(continent ? { modeOptions: { continent } } : {}),
    ...(initialState ? { initialState } : {}),
  });
}

export function createApp(options: AppOptions): App {
  let activeScreen: Screen | null = null;

  function mount(screen: Screen): void {
    activeScreen?.destroy();
    activeScreen = screen;
    options.root.replaceChildren(screen.element);
  }

  function startSolo(modeId: GameModeId, continent?: Continent, continueSaved = false): void {
    const mode = getGameMode(modeId);
    const save = continueSaved ? readSoloSave(options.storage) : null;
    const initialState = save && save.modeId === mode.id ? hydrateGameState(options.countryIndex, mode, save) : null;
    const engine = createEngine(options.countryIndex, mode, continent, initialState);

    mount(
      createSoloGameScreen({
        countryIndex: options.countryIndex,
        engine,
        mode,
        onHome: () => navigate({ type: "home" }),
        onReset: () => clearSoloSave(options.storage),
        onStateChange: (state) => saveSoloGame(options.storage, options.countryIndex, state),
      }),
    );
  }

  function navigate(route: AppRoute): void {
    if (route.type === "home") {
      mount(
        createHomeScreen({
          hasSave: readSoloSave(options.storage) !== null,
          onContinue: () => {
            const save = readSoloSave(options.storage);
            const modeId = (save?.modeId ?? "classic") as GameModeId;
            startSolo(modeId, undefined, true);
          },
          onSolo: () => navigate({ type: "mode-select" }),
          onMultiplayer: () => navigate({ type: "multiplayer-lobby" }),
        }),
      );
      return;
    }

    if (route.type === "mode-select") {
      mount(createModeSelectScreen({ onBack: () => navigate({ type: "home" }), onSelect: (modeId, continent) => startSolo(modeId, continent, false) }));
      return;
    }

    if (route.type === "solo-game") {
      startSolo(route.modeId, route.continent, route.continueSaved ?? false);
      return;
    }

    if (route.type === "multiplayer-lobby") {
      mount(createMultiplayerLobbyScreen({ onBack: () => navigate({ type: "home" }) }));
      return;
    }

    mount(createHomeScreen({ hasSave: false, onContinue: () => undefined, onSolo: () => navigate({ type: "mode-select" }), onMultiplayer: () => navigate({ type: "multiplayer-lobby" }) }));
  }

  return {
    start: () => navigate({ type: "home" }),
    navigate,
  };
}
