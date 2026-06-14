import { type CountryId, type CountryIndex } from "../core/countries";
import { createGameEngine, createRandomSeed, type GameEngine, type GameState } from "../core/game";
import { createDailyChallenge } from "../core/dailyChallenge";
import { DEFAULT_CATEGORY_IDS, resolveCategoryIds } from "../core/categories";
import { isPromptGameModeId, isWorldMapGameModeId, promptGameModeFromCategoryIds, type GameModeId, type WorldMapGameModeId } from "../core/gameModes";
import { clearSoloSave, hydrateGameState, readSoloSave, saveSoloGame } from "../storage/localSave";
import { createDailyResultSave, readDailyResult, saveDailyResult, type DailyResultSave } from "../storage/dailySave";
import { createWebSocketMultiplayerTransport, resolveDefaultWebSocketUrl, type MultiplayerTransport } from "../core/multiplayer";
import { loadWorldCountryFeatures, type WorldCountryFeature } from "../core/map";
import { fetchDailyChallengeResult, recordGame, saveDailyChallengeResult, type DailyChallengeResult } from "../core/auth";
import { createCountryGuessingScreen, type WorldMapRunResult } from "../ui/screens/CountryGuessingScreen";
import { createDailyResultScreen } from "../ui/screens/DailyResultScreen";
import { createAuthControls } from "../ui/components/AuthPanel";
import { createSoloGameScreen } from "../ui/screens/SoloGameScreen";
import { createStatsScreen } from "../ui/screens/StatsScreen";
import { createFriendsScreen } from "../ui/screens/FriendsScreen";
import { createSocialClient, resolveSocialUrl } from "../core/social/SocialClient";
import type { SocialServerMessage } from "../core/social/socialProtocol";
import { createLeaderboardScreen } from "../ui/screens/LeaderboardScreen";
import { el } from "../ui/dom/createElement";
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

function createEngine(countryIndex: CountryIndex, categoryIds: readonly string[], initialState: GameState | null, poolCountryIds?: readonly CountryId[]): GameEngine {
  return createGameEngine({
    countryIndex,
    categoryIds,
    seed: initialState?.seed ?? createRandomSeed(),
    ...(poolCountryIds ? { poolCountryIds } : {}),
    ...(initialState ? { initialState } : {}),
  });
}

function createDefaultOnlineTransport(): MultiplayerTransport {
  return createWebSocketMultiplayerTransport(resolveDefaultWebSocketUrl(window.location));
}

function routeFromLocation(location: Pick<Location, "search">): AppRoute | null {
  const params = new URLSearchParams(location.search);
  const room = params.get("room")?.trim();
  if (room) return { type: "multiplayer", joinCode: room };
  const friend = params.get("friend")?.trim();
  if (friend) return { type: "friends", username: friend };
  return null;
}

export function createApp(options: AppOptions): App {
  let activeScreen: Screen | null = null;
  let navigationRun = 0;
  let returnRoute: AppRoute = { type: "solo-game", continueSaved: true };

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

  function dailyAccountResultToLocal(result: DailyChallengeResult): DailyResultSave {
    return { version: 1, ...result };
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
        onBackToSolo: () => {
          const save = readSoloSave(options.storage);
          startSolo(save?.categoryIds ?? DEFAULT_CATEGORY_IDS, save !== null);
        },
        onMultiplayer: () => navigate({ type: "multiplayer" }),
      }),
    );
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
        onDailyChallenge: () => navigate({ type: "daily-challenge" }),
        onViewStats: () => navigate({ type: "stats" }),
        onLeaderboard: () => navigate({ type: "leaderboard", mode: promptGameModeFromCategoryIds(activeCategories) }),
        getAuthUser: () => authControls.getUser(),
        authControls,
        storage: options.storage,
      }),
    );
  }

  async function startDailyChallenge(): Promise<void> {
    const run = navigationRun;
    const challenge = createDailyChallenge(options.countryIndex);
    const localResult = readDailyResult(options.storage, challenge.date);

    if (authControls.getUser()) {
      mount(createLoadingScreen("Loading Daily Challenge..."));
      const accountResult = await fetchDailyChallengeResult(challenge.date);
      if (run !== navigationRun) return;

      if (accountResult) {
        const result = dailyAccountResultToLocal(accountResult);
        saveDailyResult(options.storage, result);
        mountDailyResult(result);
        return;
      }

      if (localResult) {
        mountDailyResult(localResult);
        void saveDailyChallengeResult(dailyLocalResultToAccount(localResult)).then((synced) => {
          if (!synced || run !== navigationRun) return;
          const result = dailyAccountResultToLocal(synced);
          saveDailyResult(options.storage, result);
          mountDailyResult(result);
        });
        return;
      }
    } else if (localResult) {
      mountDailyResult(localResult);
      return;
    }

    const engine = createGameEngine({
      countryIndex: options.countryIndex,
      categoryIds: challenge.categoryIds,
      seed: challenge.seed,
      poolCountryIds: challenge.countryIds,
      now: Date.now(),
    });

    mount(
      createSoloGameScreen({
        countryIndex: options.countryIndex,
        engine,
        selectedGameMode: "flags",
        storage: options.storage,
        onGameModeChange: (gameMode) => handleGameModeChange(gameMode),
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
            const result = createDailyResultSave({
              date: challenge.date,
              seed: challenge.seed,
              score: dailyResult.score,
              timeMs: dailyResult.timeMs,
              hintsUsed: dailyResult.hintsUsed,
              marks: dailyResult.marks,
            });
            saveDailyResult(options.storage, result);
            mountDailyResult(result);
            if (authControls.getUser()) {
              const completionRun = navigationRun;
              void saveDailyChallengeResult(dailyLocalResultToAccount(result)).then((synced) => {
                if (!synced || completionRun !== navigationRun) return;
                const accountResult = dailyAccountResultToLocal(synced);
                saveDailyResult(options.storage, accountResult);
                mountDailyResult(accountResult);
              });
            }
          },
        },
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

  async function startMultiplayer(joinCode?: string): Promise<void> {
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
    if (route.type === "daily-challenge") {
      void startDailyChallenge();
      return;
    }

    if (route.type === "country-guessing") {
      void startCountryGuessing(route.mode ?? "name-all");
      return;
    }
    if (route.type === "multiplayer") {
      void startMultiplayer(route.joinCode);
      return;
    }
    if (route.type === "stats") {
      // Await the record so the just-finished run appears in the freshly fetched stats.
      void leavingSolo.then(() => mount(createStatsScreen({ onBack: () => navigate({ type: "solo-game", continueSaved: true }) })));
      return;
    }

    if (route.type === "friends") {
      const currentUser = authControls.getUser();
      mount(createFriendsScreen({
        onBack: () => navigate({ type: "solo-game", continueSaved: true }),
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
    start: () => navigate(routeFromLocation(window.location) ?? { type: "solo-game", continueSaved: true }),
    navigate,
  };
}
