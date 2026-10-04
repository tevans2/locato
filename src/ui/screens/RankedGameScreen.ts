import type { Screen } from "../../app/router";
import type { AuthUser } from "../../core/auth";
import { indexCountries, rawCountries, type CountryIndex } from "../../core/countries";
import { createPromptCountryIndex, type FlagPool } from "../../core/flagPools";
import { isPromptGameModeId, isWorldMapGameModeId, type GameModeId } from "../../core/gameModes";
import type { WorldCountryFeature } from "../../core/map";
import type { ShellContext } from "../shell/types";
import { RankedSession } from "./RankedSession";
import "../../styles/ranked-surfaces.css";

interface Options {
  readonly mode: GameModeId;
  readonly variant?: string;
  readonly shell: ShellContext;
  readonly world: readonly WorldCountryFeature[];
  readonly countryIndex?: CountryIndex;
  readonly storage: Storage;
  readonly getAuthUser: () => AuthUser | null;
}

/** Use the same screens as practice, with server-owned challenges and scoring behind them. */
export async function createRankedGameScreen(options: Options): Promise<Screen> {
  const { mode, shell, world, storage } = options;
  const variant = options.variant ?? (mode === "puzzle" ? "Europe" : "");
  const session = new RankedSession(mode, variant);
  const countryIndex = options.countryIndex ?? indexCountries(rawCountries);
  const common = { shell, storage, countryIndex, onHome: shell.goHome, onGameModeChange: (next: GameModeId) => shell.openGame(next), onDailyChallenge: () => shell.openSection("daily") };
  try {
    if (mode !== "flyover") await session.start();
    let screen: Screen;
    if (isPromptGameModeId(mode)) {
      const [{ createSoloGameScreen }, { createRankedSoloEngine }] = await Promise.all([import("./SoloGameScreen"), import("./rankedSoloEngine")]);
      const flagPool = (variant || "countries") as FlagPool;
      const adapter = createRankedSoloEngine(createPromptCountryIndex(countryIndex, [mode], flagPool), session);
      screen = createSoloGameScreen({ ...common, countryIndex: adapter.countryIndex, engine: adapter.engine, selectedGameMode: mode, run: "timed", flagPool,
        ranked: { session, prompt: adapter.prompt, subscribe: adapter.subscribe }, worldCountryFeatures: world, getAuthUser: options.getAuthUser,
        onStateChange() {}, onReset() {}, onOpenCountry: shell.openCountry, onLeaderboard: () => shell.openLeaderboards(mode, variant) });
    } else if (isWorldMapGameModeId(mode)) {
      const { createCountryGuessingScreen } = await import("./CountryGuessingScreen");
      screen = createCountryGuessingScreen({ ...common, worldCountryFeatures: world, initialMode: mode, run: "timed", ...(mode === "puzzle" ? { puzzleContinent: variant } : {}), ranked: session,
        getAuthUser: options.getAuthUser, onLeaderboard: () => shell.openLeaderboards(mode, variant) });
    } else if (mode === "flyover") {
      const { createFlyoverScreen } = await import("./FlyoverScreen");
      screen = createFlyoverScreen({ shell, storage, worldCountryFeatures: world, onHome: shell.goHome, ranked: session });
    } else if (mode === "map-tap") {
      const { createMapTapScreen } = await import("./MapTapScreen");
      screen = createMapTapScreen({ ...common, run: "timed" }, {
        fetchRound: async () => session.state.question?.mapTap ?? null,
        restartRun: () => session.start(),
        validateGuess: async (input) => (await session.move({ type: "pin", lat: input.guessLat, lng: input.guessLng })).result?.mapTap ?? null,
        postAttempt: session.post,
      });
    } else if (mode === "worldsplit") {
      const { createWorldSplitScreen } = await import("./WorldSplitScreen");
      screen = createWorldSplitScreen({ ...common, worldCountryFeatures: world, ranked: session });
    } else if (mode === "geoguessr") {
      const { createGeoGuessrScreen } = await import("./GeoGuessrScreen");
      screen = createGeoGuessrScreen({ ...common, ranked: session });
    } else {
      const { createStreetViewCountryScreen } = await import("./StreetViewCountryScreen");
      screen = createStreetViewCountryScreen({ ...common, ranked: session });
    }
    return { element: screen.element, destroy: () => { session.destroy(); screen.destroy(); } };
  } catch (error) { session.destroy(); throw error; }
}
