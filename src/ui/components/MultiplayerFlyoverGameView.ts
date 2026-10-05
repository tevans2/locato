import { FLYOVER_SKIP_HOLD_SECONDS, buildFlyoverCountries, type FlyoverCountry, type PlaneState } from "../../core/flyover";
import type { WorldCountryFeature } from "../../core/map";
import type { FlyoverFlightPrompt, FlyoverPlanePosition, PlayerId, PublicRoomState, PublicRoundState, ServerMessage } from "../../core/multiplayer";
import { el } from "../dom/createElement";
import { createFlyoverFlight, isTypingTarget, type FlyoverFlight } from "./FlyoverFlight";

/**
 * Flyover race: the solo flight with everyone else's planes on the map and live standings in the
 * corner. The original local flight loop handles steering, touches and skips immediately.
 * Position reports draw rivals; server progress updates the standings without moving your plane.
 */

const PLAYER_COLORS = ["#38bdf8", "#fb923c", "#a78bfa", "#34d399", "#f472b6", "#fbbf24", "#60a5fa", "#f87171"];
/** Report the plane this often: the server relays positions on its 250ms tick. */
const POSITION_INTERVAL_MS = 200;
const STANDINGS_SHOWN = 4;

type FlyoverProgressMessage = Extract<ServerMessage, { type: "FLYOVER_PROGRESS" }>;

export interface MultiplayerFlyoverGameViewState {
  readonly room: PublicRoomState;
  readonly localPlayerId: PlayerId | null;
  readonly round: PublicRoundState | null;
  readonly canSubmit: boolean;
  /** Joined mid-race: watch the standings instead of flying. */
  readonly spectating?: boolean;
}

export interface MultiplayerFlyoverGameViewOptions {
  readonly signal: AbortSignal;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly onPosition: (plane: PlaneState) => void;
  readonly onReach: (index: number, plane: PlaneState) => void;
  readonly onSkip: (index: number) => void;
  /** Epoch milliseconds, the server's clock (defaults to Date.now). */
  readonly now?: () => number;
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

export interface MultiplayerFlyoverGameView {
  readonly element: HTMLElement;
  readonly update: (state: MultiplayerFlyoverGameViewState) => void;
  readonly applyProgress: (message: FlyoverProgressMessage) => void;
  readonly setPlanes: (planes: readonly FlyoverPlanePosition[]) => void;
  readonly destroy: () => void;
}

interface ActiveFlight {
  readonly key: string;
  readonly route: readonly FlyoverCountry[];
  readonly start: PlaneState;
  readonly takeoffAt: number;
  readonly endsAt: number;
}

export function parseFlyoverPrompt(value: string): FlyoverFlightPrompt | null {
  try {
    const parsed = JSON.parse(value) as Partial<FlyoverFlightPrompt>;
    const start = parsed.start;
    if (!start || ![start.x, start.y, start.heading].every((item) => typeof item === "number" && Number.isFinite(item))) return null;
    if (parsed.target !== undefined && parsed.target !== null && typeof parsed.target !== "string") return null;
    if (parsed.target === undefined && (!Array.isArray(parsed.route) || !parsed.route.every((code) => typeof code === "string"))) return null;
    return { start, ...(parsed.target !== undefined ? { target: parsed.target } : {}), ...(parsed.route ? { route: parsed.route } : {}) };
  } catch {
    return null;
  }
}

export function createMultiplayerFlyoverGameView(options: MultiplayerFlyoverGameViewOptions): MultiplayerFlyoverGameView {
  const { signal } = options;
  const now = options.now ?? (() => Date.now());
  const requestFrame = options.requestFrame ?? ((callback: () => void) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  // The map is only needed once someone races: build the country shapes on first use.
  let countries: readonly FlyoverCountry[] | null = null;
  let byCode = new Map<string, FlyoverCountry>();

  let room: PublicRoomState | null = null;
  let localPlayerId: PlayerId | null = null;
  let flight: ActiveFlight | null = null;
  let routeIndex = 0;
  let score = 0;
  /** Route positions this player reached locally, so a server correction can undo them. */
  const reachedPositions = new Set<number>();
  const scores = new Map<PlayerId, number>();
  let lastPositionAt = 0;
  let countdownHandle: number | null = null;

  // --- DOM ---------------------------------------------------------------------------------
  const standings = el("ol", { className: "flyover-standings", attrs: { "aria-label": "Standings" } });
  const countdownValue = el("strong", { className: "flyover-countdown", text: "3" });
  const overlayTitle = el("h1", { text: "Same route, same clock." });
  const overlayText = el("p", { text: "" });
  const overlay = el("div", {
    className: "flyover-ready flyover-race-ready",
    children: [
      el("div", {
        className: "flyover-ready-card",
        children: [
          el("span", { className: "eyebrow", text: "Flyover race" }),
          overlayTitle,
          overlayText,
          countdownValue,
          el("ul", {
            className: "flyover-howto",
            children: [
              el("li", { children: [el("kbd", { text: "←" }), el("kbd", { text: "→" }), el("span", { text: "steer (or A / D)" })] }),
              el("li", { children: [el("kbd", { text: "↑" }), el("span", { text: "hold to boost (or W / Shift)" })] }),
              el("li", { children: [el("span", { className: "flyover-howto-touch", text: "Touch" }), el("span", { text: "hold the map where you want to fly" })] }),
              el("li", { children: [el("kbd", { text: "S" }), el("span", { text: `skip a country (${FLYOVER_SKIP_HOLD_SECONDS}s holding pattern)` })] }),
            ],
          }),
        ],
      }),
    ],
  });

  // Someone who joined mid-race watches the standings; they fly in the next race.
  const watchStandings = el("ol", { className: "flyover-standings flyover-watch-standings", attrs: { "aria-label": "Standings" } });
  const watchCard = el("div", {
    className: "flyover-watch",
    attrs: { hidden: "" },
    children: [
      el("span", { className: "eyebrow", text: "Flyover race" }),
      el("h2", { text: "Race in progress" }),
      el("p", { text: "You joined mid-flight, so you're watching this one. You'll fly in the next race." }),
      watchStandings,
    ],
  });

  let engine: FlyoverFlight | null = null;
  const element = el("section", { className: "multiplayer-flyover-view", attrs: { "aria-label": "Flyover race" }, children: [watchCard] });

  function ensureEngine(): FlyoverFlight {
    if (engine) return engine;
    countries = buildFlyoverCountries(options.worldCountryFeatures);
    byCode = new Map(countries.map((country) => [country.code, country]));
    engine = createFlyoverFlight({
      countries,
      hudRight: standings,
      overlay,
      skipLabel: `Skip · ${FLYOVER_SKIP_HOLD_SECONDS}s hold`,
      flightSeconds: (room?.settings.roundDurationMs ?? 90_000) / 1000,
      now,
      animationNow: options.now ?? (() => performance.now()),
      requestFrame,
      cancelFrame,
      signal,
      onReach: reach,
      onSkip: skip,
      onTimeUp: () => {
        engine?.land();
        engine?.setTarget(null, "Landing…");
      },
      onMove: (plane) => {
        const clockNow = now();
        if (clockNow - lastPositionAt < POSITION_INTERVAL_MS) return;
        lastPositionAt = clockNow;
        options.onPosition(plane);
      },
    });
    element.append(engine.element);
    return engine;
  }

  // --- Race --------------------------------------------------------------------------------
  function targetAt(index: number): FlyoverCountry | null {
    return flight?.route[index] ?? null;
  }

  function aimAtCurrent(): void {
    engine?.setTarget(targetAt(routeIndex), "Route complete!");
  }

  function reach(country: FlyoverCountry): void {
    if (!engine || !flight) return;
    const index = routeIndex;
    routeIndex += 1;
    score += 1;
    reachedPositions.add(index);
    if (localPlayerId) scores.set(localPlayerId, score);
    engine.markVisited(country.code);
    engine.showToast(`+1 ${country.name}`);
    options.onReach(index, engine.plane());
    aimAtCurrent();
    renderStandings();
  }

  function skip(): void {
    const target = engine?.target();
    if (!engine || !flight || !target) return;
    options.onSkip(routeIndex);
    routeIndex += 1;
    engine.holdUntil(now() + FLYOVER_SKIP_HOLD_SECONDS * 1000);
    engine.showToast(`Skipped ${target.name} · holding ${FLYOVER_SKIP_HOLD_SECONDS}s`);
    aimAtCurrent();
  }

  function applyProgress(message: FlyoverProgressMessage): void {
    scores.set(message.playerId, message.score);
    if (message.playerId === localPlayerId && message.event === "sync" && flight && engine) {
      // The server turned a claim down: go back to where it says this plane is.
      for (const position of [...reachedPositions]) {
        if (position < message.index) continue;
        reachedPositions.delete(position);
        const country = targetAt(position);
        if (country) engine.unmarkVisited(country.code);
      }
      const changed = routeIndex !== message.index;
      routeIndex = message.index;
      score = message.score;
      if (changed) {
        engine.showToast("That one didn't count");
        aimAtCurrent();
      }
    }
    renderStandings();
  }

  function setPlanes(planes: readonly FlyoverPlanePosition[]): void {
    if (!engine || !room) return;
    const order = room.players.map((player) => player.id);
    engine.setGhosts(planes
      .filter((plane) => plane.playerId !== localPlayerId)
      .map((plane) => ({
        id: plane.playerId,
        name: room?.players.find((player) => player.id === plane.playerId)?.name ?? "",
        x: plane.x,
        y: plane.y,
        heading: plane.heading,
        colour: PLAYER_COLORS[Math.max(0, order.indexOf(plane.playerId)) % PLAYER_COLORS.length]!,
      })));
  }

  function renderStandings(): void {
    if (!room) return;
    const order = room.players.map((player) => player.id);
    const rows = room.players
      .map((player) => ({ player, score: scores.get(player.id) ?? player.score }))
      .sort((left, right) => right.score - left.score || left.player.name.localeCompare(right.player.name));
    const localRank = rows.findIndex((row) => row.player.id === localPlayerId);
    // The top few, plus you if you're further down.
    const shown = rows.filter((_, index) => index < STANDINGS_SHOWN || index === localRank);
    const target = watchCard.hidden ? standings : watchStandings;
    target.replaceChildren(...shown.map((row) => {
      const rank = rows.indexOf(row) + 1;
      const colour = PLAYER_COLORS[Math.max(0, order.indexOf(row.player.id)) % PLAYER_COLORS.length]!;
      return el("li", {
        className: row.player.id === localPlayerId ? "flyover-standing is-local" : "flyover-standing",
        children: [
          el("span", { className: "flyover-standing-rank", text: String(rank) }),
          el("span", { className: "flyover-standing-dot", attrs: { style: `background:${colour}`, "aria-hidden": "true" } }),
          el("span", { className: "flyover-standing-name", text: row.player.id === localPlayerId ? "You" : row.player.name }),
          el("strong", { className: "flyover-standing-score", text: String(row.score) }),
        ],
      });
    }));
  }

  function stopCountdown(): void {
    if (countdownHandle !== null) cancelFrame(countdownHandle);
    countdownHandle = null;
  }

  function countdown(): void {
    countdownHandle = null;
    if (!flight || !engine || signal.aborted) return;
    const left = flight.takeoffAt - now();
    if (left <= 0) {
      takeOff();
      return;
    }
    countdownValue.textContent = String(Math.ceil(left / 1000));
    countdownHandle = requestFrame(countdown);
  }

  function takeOff(): void {
    if (!flight || !engine) return;
    stopCountdown();
    overlay.hidden = true;
    aimAtCurrent();
    engine.fly(flight.endsAt);
    // Let go of whatever has focus (the lobby's Start button, say) so Space boosts instead of
    // pressing it. Someone typing in the room chat keeps their place.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body && !isTypingTarget(focused)) focused.blur();
  }

  function startFlight(round: PublicRoundState, prompt: FlyoverFlightPrompt, key: string): void {
    const view = ensureEngine();
    const route = (prompt.route ?? []).map((code) => byCode.get(code)).filter((country): country is FlyoverCountry => country !== undefined);
    flight = { key, route, start: prompt.start, takeoffAt: round.startedAt, endsAt: round.endsAt ?? round.startedAt };
    const own = room?.players.find((player) => player.id === localPlayerId);
    // Rejoining mid-flight picks up where the server has this plane on the route.
    routeIndex = own?.routeIndex ?? 0;
    score = own?.score ?? 0;
    reachedPositions.clear();
    scores.clear();
    lastPositionAt = 0;
    const resumeFrom = routeIndex > 0 ? targetAt(routeIndex - 1) : null;
    const seconds = Math.round((flight.endsAt - flight.takeoffAt) / 1000);
    view.reset(resumeFrom ? { x: resumeFrom.centre[0], y: resumeFrom.centre[1], heading: prompt.start.heading } : prompt.start, seconds);
    // The view has just been shown: colours and size come from CSS once it lays out.
    requestFrame(() => engine?.mount());
    overlayTitle.textContent = "Same route, same clock.";
    overlayText.textContent = `Fly over each country as it's named. Most countries in ${seconds} seconds wins.`;
    overlay.hidden = false;
    countdown();
  }

  function update(state: MultiplayerFlyoverGameViewState): void {
    room = state.room;
    localPlayerId = state.localPlayerId;
    const round = state.round;
    const prompt = round?.prompt.kind === "flyover-flight" ? parseFlyoverPrompt(round.prompt.value) : null;
    const watching = Boolean(state.spectating) && state.room.status === "playing";
    watchCard.hidden = !watching;
    if (engine) engine.element.hidden = watching;
    if (watching) {
      renderStandings();
      return;
    }
    if (state.room.status === "playing" && round && prompt) {
      const key = `${round.startedAt}:${round.endsAt}`;
      if (flight?.key !== key) startFlight(round, prompt, key);
    } else if (flight) {
      stopCountdown();
      engine?.land();
      flight = null;
    }
    renderStandings();
  }

  signal.addEventListener("abort", () => {
    stopCountdown();
    engine?.destroy();
  });

  return {
    element,
    update,
    applyProgress,
    setPlanes,
    destroy: () => {
      stopCountdown();
      engine?.destroy();
    },
  };
}
