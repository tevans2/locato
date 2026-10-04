// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientMessage, MultiplayerTransport, PublicPlayerState, PublicRoomState, ServerMessage, TransportStatus } from "../src/core/multiplayer";
import { createRoomSession } from "../src/ui/screens/multiplayer/roomSession";
import { createMultiplayerHome } from "../src/ui/screens/multiplayer/MultiplayerHome";
import { createMultiplayerScreen } from "../src/ui/screens/multiplayer/MultiplayerScreen";
import { indexCountries, rawCountries } from "../src/core/countries";
import type { ShellContext } from "../src/ui/shell/types";

// The round views draw WebGL globes and Street View; the screen tests only need them to exist.
vi.mock("../src/ui/components/MultiplayerMapTapGameView", () => ({
  createMultiplayerMapTapGameView: () => ({ element: document.createElement("div"), update: () => undefined, destroy: () => undefined }),
}));
vi.mock("../src/ui/components/MultiplayerGeoGuessrGameView", () => ({
  createMultiplayerGeoGuessrGameView: () => ({ element: document.createElement("div"), update: () => undefined, destroy: () => undefined }),
}));

/** A transport the test drives: it records what the client sends and plays the server. */
function fakeTransport(options: { readonly fail?: boolean } = {}) {
  const sent: ClientMessage[] = [];
  const messageHandlers = new Set<(message: ServerMessage) => void>();
  const statusHandlers = new Set<(status: TransportStatus) => void>();
  let status: TransportStatus = "idle";
  const setStatus = (next: TransportStatus) => {
    status = next;
    for (const handler of statusHandlers) handler(next);
  };
  const transport: MultiplayerTransport = {
    connect: () => {
      setStatus("connecting");
      if (options.fail) {
        setStatus("error");
        return Promise.reject(new Error("down"));
      }
      setStatus("connected");
      return Promise.resolve();
    },
    disconnect: () => setStatus("disconnected"),
    send: (message) => void sent.push(message),
    onMessage: (handler) => {
      messageHandlers.add(handler);
      return () => void messageHandlers.delete(handler);
    },
    onStatusChange: (handler) => {
      statusHandlers.add(handler);
      handler(status);
      return () => void statusHandlers.delete(handler);
    },
  };
  return { transport, sent, emit: (message: ServerMessage) => { for (const handler of [...messageHandlers]) handler(message); }, setStatus };
}

const player = (id: string, name: string, extra: Partial<PublicPlayerState> = {}): PublicPlayerState => ({ id, name, connected: true, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0, ...extra });

function room(extra: Partial<PublicRoomState> = {}): PublicRoomState {
  return {
    roomCode: "K7QMR",
    kind: "quiz",
    hostPlayerId: "p1",
    categoryIds: ["flags"],
    settings: { roundLimit: 10, roundDurationMs: 30_000 },
    status: "lobby",
    players: [player("p1", "Ana"), player("p2", "Ben")],
    round: null,
    skipVotes: [],
    skipRequired: 0,
    phaseStartedAt: null,
    phaseEndsAt: null,
    chatMessages: [],
    ...extra,
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function makeShell(): ShellContext & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openSection: (section) => calls.push(`section:${section}`),
    goHome: () => calls.push("home"),
    goBack: () => calls.push("back"),
    openGame: () => calls.push("game"),
    openGamePicker: () => calls.push("picker"),
    openCountry: () => calls.push("country"),
    openLeaderboards: () => calls.push("leaderboards"),
    openAccount: () => calls.push("account"),
    controls: document.createElement("div"),
    confirmLeave: vi.fn(async () => true),
    signedIn: () => false,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("room session", () => {
  it("creates a room, remembers the seat for a reload, and leaves for good", async () => {
    const server = fakeTransport();
    const changes: string[] = [];
    const session = createRoomSession({ createTransport: () => server.transport, storage: window.sessionStorage, onChange: () => undefined, onRoomCodeChange: (code) => changes.push(String(code)) });
    session.create({ playerName: "Ana", avatarEmoji: "🦊", categoryIds: ["map-tap"] });
    expect(session.state().pending).toBe("create");
    await flush();
    expect(server.sent[0]).toEqual({ type: "CREATE_ROOM", playerName: "Ana", avatarEmoji: "🦊", categoryIds: ["map-tap"] });

    server.emit({ type: "SESSION_ASSIGNED", playerId: "p1", roomCode: "K7QMR", sessionToken: "t1" });
    server.emit({ type: "ROOM_SNAPSHOT", room: room({ kind: "map-tap", categoryIds: ["map-tap"] }) });
    expect(session.state()).toMatchObject({ pending: null, localPlayerId: "p1", room: { roomCode: "K7QMR" } });
    expect(JSON.parse(window.sessionStorage.getItem("locato.mp.session")!)).toEqual({ roomCode: "K7QMR", playerId: "p1", sessionToken: "t1" });

    session.leave();
    expect(server.sent.at(-1)).toEqual({ type: "LEAVE_ROOM" });
    expect(session.state().room).toBeNull();
    expect(window.sessionStorage.getItem("locato.mp.session")).toBeNull();
    expect(changes).toEqual(["K7QMR", "null"]);
  });

  it("shows a failed join instead of swallowing it", async () => {
    const server = fakeTransport();
    const session = createRoomSession({ createTransport: () => server.transport, onChange: () => undefined });
    session.join("ZZZZZ", "Ana", "🦊");
    await flush();
    server.emit({ type: "ERROR", code: "room-not-found", message: "No room exists with that code." });
    expect(session.state()).toMatchObject({ room: null, pending: null, notice: { tone: "error", text: "No room exists with that code." } });
  });

  it("says when the server can't be reached", async () => {
    const server = fakeTransport({ fail: true });
    const session = createRoomSession({ createTransport: () => server.transport, onChange: () => undefined });
    session.join("K7QMR", "Ana", "🦊");
    await flush();
    expect(session.state()).toMatchObject({ pending: null, notice: { tone: "error" } });
    expect(session.state().notice?.text).toMatch(/couldn't reach/i);
  });

  it("reclaims a stored seat on connect and announces a new host", async () => {
    const server = fakeTransport();
    const session = createRoomSession({ createTransport: () => server.transport, onChange: () => undefined });
    session.resume({ roomCode: "K7QMR", playerId: "p2", sessionToken: "t2" });
    await flush();
    expect(server.sent[0]).toEqual({ type: "REJOIN_ROOM", roomCode: "K7QMR", playerId: "p2", sessionToken: "t2" });
    server.emit({ type: "SESSION_ASSIGNED", playerId: "p2", roomCode: "K7QMR", sessionToken: "t2" });
    server.emit({ type: "ROOM_SNAPSHOT", room: room() });
    server.emit({ type: "ROOM_SNAPSHOT", room: room({ hostPlayerId: "p2" }) });
    expect(session.state().notice).toEqual({ tone: "info", text: "You're the host now." });
  });
});

describe("multiplayer home", () => {
  function mountHome(overrides: Partial<Parameters<typeof createMultiplayerHome>[0]> = {}) {
    const controller = new AbortController();
    const onCreate = vi.fn();
    const onJoin = vi.fn();
    const home = createMultiplayerHome({ shell: makeShell(), storage: window.localStorage, signal: controller.signal, getUser: () => null, onCreate, onJoin, ...overrides });
    document.body.append(home.element);
    return { home, onCreate, onJoin };
  }

  it("opens a room straight from a game tile, once a guest has a name", () => {
    const { onCreate } = mountHome();
    const flyover = document.querySelector<HTMLButtonElement>(".mp-kind[data-kind='flyover']")!;
    flyover.click();
    expect(onCreate).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>(".mp-field-error")!.hidden).toBe(false);
    const name = document.querySelector<HTMLInputElement>("#mp-name")!;
    name.value = "  Sam ";
    name.dispatchEvent(new Event("input"));
    flyover.click();
    expect(onCreate).toHaveBeenCalledWith("flyover", "Sam");
    expect(window.localStorage.getItem("locato.mp.name")).toBe("Sam");
  });

  it("joins by code or pasted link, and says when a code is too short", () => {
    window.localStorage.setItem("locato.mp.name", "Ana");
    const { onJoin } = mountHome();
    const input = document.querySelector<HTMLInputElement>(".mp-join-input")!;
    const form = document.querySelector<HTMLFormElement>(".mp-join")!;
    input.value = "ab";
    form.requestSubmit();
    expect(onJoin).not.toHaveBeenCalled();
    expect(document.querySelector(".mp-join .mp-field-hint")?.classList.contains("is-error")).toBe(true);
    input.value = "https://locato.app/?room=k7qmr";
    form.requestSubmit();
    expect(onJoin).toHaveBeenLastCalledWith("K7QMR", "Ana");
  });

  it("uses the account name when signed in, and shows progress while a room opens", () => {
    const { home, onCreate } = mountHome({ getUser: () => ({ displayName: "Tate", avatarEmoji: "🦊" }) });
    expect(document.querySelector<HTMLElement>(".mp-name-field")!.hidden).toBe(true);
    expect(document.querySelector(".mp-playing-as")?.textContent).toContain("Tate");
    document.querySelector<HTMLButtonElement>(".mp-kind[data-kind='quiz']")!.click();
    expect(onCreate).toHaveBeenCalledWith("quiz", "Tate");
    home.update({ pending: "create" });
    expect(document.querySelector(".mp-kind[data-kind='quiz'] .mp-kind-status")?.textContent).toBe("Opening room…");
    expect(document.querySelector<HTMLButtonElement>(".mp-kind[data-kind='map-tap']")!.disabled).toBe(true);
  });

  it("asks a guest from an invite link for a name before joining", () => {
    const { home } = mountHome();
    home.prepareJoin("K7QMR");
    expect(document.querySelector<HTMLInputElement>(".mp-join-input")!.value).toBe("K7QMR");
    expect(document.querySelector(".mp-field-error")?.textContent).toBe("Pick a name to join room K7QMR.");
  });
});

describe("multiplayer screen", () => {
  function mountScreen(options: { readonly initialJoinCode?: string; readonly server?: ReturnType<typeof fakeTransport> } = {}) {
    const server = options.server ?? fakeTransport();
    const screen = createMultiplayerScreen({
      shell: makeShell(),
      countryIndex: indexCountries(rawCountries),
      worldCountryFeatures: [],
      createOnlineTransport: () => server.transport,
      storage: window.localStorage,
      sessionStorage: window.sessionStorage,
      ...(options.initialJoinCode ? { initialJoinCode: options.initialJoinCode } : {}),
    });
    document.body.append(screen.element);
    return { screen, server };
  }

  it("lets an invite link win over a seat this tab held in another room", async () => {
    window.localStorage.setItem("locato.mp.name", "Ana");
    window.sessionStorage.setItem("locato.mp.session", JSON.stringify({ roomCode: "OLDRM", playerId: "p9", sessionToken: "t9" }));
    const { server } = mountScreen({ initialJoinCode: "K7QMR" });
    await flush();
    expect(server.sent[0]).toMatchObject({ type: "JOIN_ROOM", roomCode: "K7QMR", playerName: "Ana" });
    expect(server.sent.some((message) => message.type === "REJOIN_ROOM")).toBe(false);
  });

  it("reclaims the seat after a reload of the same room's link", async () => {
    window.sessionStorage.setItem("locato.mp.session", JSON.stringify({ roomCode: "K7QMR", playerId: "p2", sessionToken: "t2" }));
    const { server } = mountScreen({ initialJoinCode: "K7QMR" });
    await flush();
    expect(server.sent[0]).toEqual({ type: "REJOIN_ROOM", roomCode: "K7QMR", playerId: "p2", sessionToken: "t2" });
  });

  it("shows errors before you're in a room", async () => {
    window.localStorage.setItem("locato.mp.name", "Ana");
    const { server, screen } = mountScreen({ initialJoinCode: "ZZZZZ" });
    await flush();
    server.emit({ type: "ERROR", code: "room-not-found", message: "No room exists with that code." });
    const notice = screen.element.querySelector<HTMLElement>(".mp-notice")!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("No room exists with that code.");
    expect(screen.element.dataset.view).toBe("home");
  });

  it("gives the host one Start button and guests a waiting line, with no ready check", async () => {
    window.localStorage.setItem("locato.mp.name", "Ben");
    const { server, screen } = mountScreen({ initialJoinCode: "K7QMR" });
    await flush();
    server.emit({ type: "SESSION_ASSIGNED", playerId: "p2", roomCode: "K7QMR", sessionToken: "t2" });
    server.emit({ type: "ROOM_SNAPSHOT", room: room() });
    expect(screen.element.dataset.view).toBe("lobby");
    expect(screen.element.querySelector<HTMLElement>(".mp-start-game")!.hidden).toBe(true);
    expect(screen.element.querySelector(".mp-waiting")?.textContent).toContain("Waiting for Ana");
    expect(screen.element.querySelector(".mp-settings-summary")?.textContent).toContain("Quiz race");

    server.emit({ type: "ROOM_SNAPSHOT", room: room({ hostPlayerId: "p2" }) });
    const start = screen.element.querySelector<HTMLButtonElement>(".mp-start-game")!;
    expect(start.hidden).toBe(false);
    start.click();
    expect(server.sent.at(-1)).toEqual({ type: "START_GAME" });
  });

  it("switches the game type from the lobby", async () => {
    window.localStorage.setItem("locato.mp.name", "Ana");
    const { server, screen } = mountScreen({ initialJoinCode: "K7QMR" });
    await flush();
    server.emit({ type: "SESSION_ASSIGNED", playerId: "p1", roomCode: "K7QMR", sessionToken: "t1" });
    server.emit({ type: "ROOM_SNAPSHOT", room: room() });
    screen.element.querySelector<HTMLButtonElement>(".mp-kind-pill.is-geoguessr")!.click();
    expect(server.sent.at(-1)).toEqual({ type: "SET_ROOM_OPTIONS", categoryIds: ["geoguessr"] });
  });

  it("shows results with Play again for the host and leaves the room when the page goes", async () => {
    window.localStorage.setItem("locato.mp.name", "Ana");
    const { server, screen } = mountScreen({ initialJoinCode: "K7QMR" });
    await flush();
    server.emit({ type: "SESSION_ASSIGNED", playerId: "p1", roomCode: "K7QMR", sessionToken: "t1" });
    server.emit({ type: "ROOM_SNAPSHOT", room: room({ status: "complete" }) });
    server.emit({ type: "GAME_COMPLETED", results: [{ playerId: "p1", name: "Ana", rank: 1, score: 900, correctAnswers: 6, wrongAnswers: 1 }, { playerId: "p2", name: "Ben", rank: 2, score: 400, correctAnswers: 3, wrongAnswers: 2 }] });
    expect(screen.element.dataset.view).toBe("results");
    expect(screen.element.querySelector(".mp-results-title")?.textContent).toBe("You won!");
    screen.element.querySelector<HTMLButtonElement>(".mp-results .mp-start-game")!.click();
    expect(server.sent.at(-1)).toEqual({ type: "PLAY_AGAIN" });

    screen.destroy();
    expect(server.sent.at(-1)).toEqual({ type: "LEAVE_ROOM" });
  });
});
