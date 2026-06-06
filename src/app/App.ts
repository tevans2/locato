import { type Continent, type CountryIndex } from "../core/countries";
import { createGameEngine, createRandomSeed, type GameEngine, type GameState } from "../core/game";
import { clearSoloSave, hydrateGameState, readSoloSave, saveSoloGame } from "../storage/localSave";
import { selectableModes, getGameMode, type GameMode, type GameModeId } from "../core/modes";
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
        modes: selectableModes,
        onModeChange: (nextModeId, nextContinent) => {
          clearSoloSave(options.storage);
          startSolo(nextModeId, nextContinent, false);
        },
        onReset: () => clearSoloSave(options.storage),
        onStateChange: (state) => saveSoloGame(options.storage, options.countryIndex, state),
      }),
    );
  }

  function navigate(route: AppRoute): void {
    if (route.type === "solo-game") {
      startSolo(route.modeId, route.continent, route.continueSaved ?? false);
      return;
    }

    const save = readSoloSave(options.storage);
    const savedModeId = save?.modeId ? (save.modeId as GameModeId) : "classic";
    startSolo(savedModeId, undefined, save !== null);
  }

  return {
    start: () => navigate({ type: "solo-game", modeId: "classic", continueSaved: true }),
    navigate,
  };
}
