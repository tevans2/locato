// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLeaderboardRank, submitBestTime } from "../src/core/auth";
import { GAME_MODE_GROUPS } from "../src/core/gameModes";
import { LEADERBOARD_MODES, leaderboardConfig } from "../src/core/leaderboards";
import { timerKeysForMode } from "../src/core/timer/keys";
import { COMPETE_PAGE_SIZE, createCompeteScreen, type CompeteScreenOptions } from "../src/ui/screens/CompeteScreen";
import type { ShellContext } from "../src/ui/shell/types";

const ME = { id: "u-me", email: "me@x.com", displayName: "Tate", avatarUrl: null, avatarEmoji: "🦊", createdAt: 1 };

function makeShell(signedIn = false): ShellContext & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openSection: (section) => calls.push(`section:${section}`),
    goHome: () => calls.push("home"),
    goBack: () => calls.push("back"),
    openGame: (mode, run, variant) => calls.push(`game:${mode}:${run ?? "practice"}:${variant ?? ""}`),
    openGamePicker: () => calls.push("picker"),
    openCountry: (code) => calls.push(`country:${code}`),
    openCompete: (mode) => calls.push(`compete:${mode ?? ""}`),
    openAccount: () => calls.push("account"),
    controls: document.createElement("div"),
    confirmLeave: vi.fn(async () => true),
    signedIn: () => signedIn,
  };
}

function timeEntries(count: number, start = 1, you?: number) {
  return Array.from({ length: count }, (_, index) => {
    const rank = start + index;
    return { rank, userId: rank === you ? ME.id : `u${rank}`, displayName: rank === you ? ME.displayName : `Player ${rank}`, avatarEmoji: null, timeMs: 60_000 + rank * 1000, achievedAt: rank };
  });
}

function scoreEntries(count: number, start = 1) {
  return Array.from({ length: count }, (_, index) => {
    const rank = start + index;
    return { rank, userId: `u${rank}`, displayName: `Player ${rank}`, avatarEmoji: "🐼", score: 25_000 - rank * 1000, achievedAt: rank };
  });
}

/** Mode order in the shell's catalogue (Clues, Map, Street View). */
const GAME_ORDER: string[] = GAME_MODE_GROUPS.flatMap((group) => group.modes.map((mode) => mode.id));

interface FetchSetup {
  readonly signedIn?: boolean;
  readonly board?: (url: URL) => unknown | null;
  readonly friends?: unknown;
}

function mockFetch(setup: FetchSetup = {}) {
  const requests: URL[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    requests.push(url);
    if (url.pathname === "/auth/me") {
      return setup.signedIn ? new Response(JSON.stringify({ user: ME, stats: {} })) : new Response("{}", { status: 401 });
    }
    if (url.pathname === "/api/leaderboard" && (init?.method ?? "GET") === "GET") {
      const body = setup.board ? setup.board(url) : { entries: [], currentUser: null };
      return body === null ? new Response("{}", { status: 500 }) : new Response(JSON.stringify(body));
    }
    if (url.pathname === "/api/leaderboard" && init?.method === "POST") {
      return new Response(JSON.stringify({ accepted: true, isPersonalBest: true, rank: 3, bestTimeMs: 61_000 }));
    }
    if (url.pathname === "/api/leaderboard/rank") return new Response(JSON.stringify({ rank: 4, total: 9 }));
    if (url.pathname === "/api/friends") return new Response(JSON.stringify(setup.friends ?? { friends: [], incoming: [], outgoing: [] }));
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function mount(options: Partial<CompeteScreenOptions> & { shell: ShellContext }) {
  const storage = options.storage ?? window.localStorage;
  const screen = createCompeteScreen({ storage, ...options });
  document.body.append(screen.element);
  return screen;
}

const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Compete screen: Leaderboards tab", () => {
  it("offers all 14 modes grouped Clues, Map and Street View", async () => {
    mockFetch();
    mount({ shell: makeShell(), tab: "leaderboards" });
    await flush();
    const groups = [...document.querySelectorAll<HTMLElement>(".compete-modes-group")];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Clues", "Map", "Street View"]);
    const modes = [...document.querySelectorAll<HTMLElement>(".compete-mode")].map((item) => item.dataset.mode);
    expect(modes).toEqual(LEADERBOARD_MODES.map((config) => config.mode).sort((a, b) => GAME_ORDER.indexOf(a) - GAME_ORDER.indexOf(b)));
    expect(modes).toHaveLength(14);
    expect(q(".compete-mode[data-mode='flags']")?.getAttribute("aria-pressed")).toBe("true");
    expect(q(".compete-title")?.textContent).toBe("Flags");
    expect(q(".compete-attempt")?.textContent).toBe(leaderboardConfig("flags")!.attempt);
  });

  it("selecting a mode reports it for a URL replace and reloads the board", async () => {
    const { requests } = mockFetch();
    const onSelect = vi.fn();
    mount({ shell: makeShell(), tab: "leaderboards", onSelect });
    await flush();
    q<HTMLButtonElement>(".compete-mode[data-mode='puzzle']")!.click();
    expect(onSelect).toHaveBeenLastCalledWith("puzzle", "Africa");
    expect(q(".compete-title")?.textContent).toBe("Puzzle");
    q<HTMLButtonElement>(".compete-segment[data-variant='Europe']")!.click();
    expect(onSelect).toHaveBeenLastCalledWith("puzzle", "Europe");
    await flush();
    const last = requests.filter((url) => url.pathname === "/api/leaderboard").at(-1)!;
    expect(last.searchParams.get("mode")).toBe("puzzle");
    expect(last.searchParams.get("variant")).toBe("Europe");
  });

  it("shows variant pills only for modes with variants", async () => {
    mockFetch();
    mount({ shell: makeShell(), mode: "flags" });
    await flush();
    expect([...document.querySelectorAll<HTMLElement>(".compete-segment")].map((pill) => pill.textContent)).toEqual(["Countries", "Territories", "Both"]);
    for (const mode of ["shapes", "map-tap", "geoguessr", "worldsplit"]) {
      q<HTMLButtonElement>(`.compete-mode[data-mode='${mode}']`)!.click();
      expect(q<HTMLElement>(".compete-variants")!.hidden).toBe(true);
      expect(document.querySelectorAll(".compete-segment")).toHaveLength(0);
    }
    q<HTMLButtonElement>(".compete-mode[data-mode='puzzle']")!.click();
    expect(q<HTMLElement>(".compete-variants")!.hidden).toBe(false);
    expect(document.querySelectorAll(".compete-segment")).toHaveLength(6);
  });

  it("labels the call to action per metric and starts a ranked attempt with the variant", async () => {
    mockFetch();
    const shell = makeShell();
    mount({ shell, mode: "flags", variant: "territories" });
    await flush();
    const play = q<HTMLButtonElement>(".compete-play")!;
    expect(play.textContent).toBe("Start a timed run");
    expect(q(".compete-segment[data-variant='territories']")?.getAttribute("aria-checked")).toBe("true");
    play.click();
    q<HTMLButtonElement>(".compete-segment[data-variant='']")!.click();
    play.click();
    q<HTMLButtonElement>(".compete-mode[data-mode='map-tap']")!.click();
    expect(play.textContent).toBe("Play a ranked attempt");
    expect(q(".compete-eyebrow")?.textContent).toBe("Map · Highest score wins");
    play.click();
    q<HTMLButtonElement>(".compete-mode[data-mode='streetview-country']")!.click();
    expect(play.textContent).toBe("Play a ranked attempt");
    play.click();
    q<HTMLButtonElement>(".compete-practise")!.click();
    expect(shell.calls).toEqual(["game:flags:timed:territories", "game:flags:timed:", "game:map-tap:timed:", "game:streetview-country:timed:", "game:streetview-country:practice:"]);
  });

  it("renders a time board as times, with a podium for the top three", async () => {
    mockFetch({ board: () => ({ metric: "time", entries: timeEntries(6), currentUser: null }) });
    mount({ shell: makeShell(), mode: "capitals" });
    await flush();
    const podium = [...document.querySelectorAll<HTMLElement>(".compete-podium-step")];
    expect(podium.map((step) => step.dataset.rank)).toEqual(["1", "2", "3"]);
    expect(podium[0]!.querySelector(".compete-podium-value")?.textContent).toBe("1:01.0");
    const rows = [...document.querySelectorAll<HTMLElement>(".compete-row")];
    expect(rows.map((item) => item.dataset.rank)).toEqual(["4", "5", "6"]);
    expect(rows[0]!.querySelector(".compete-row-value")?.textContent).toBe("1:04.0");
    expect(q(".compete-board-columns")?.textContent).toContain("Time");
  });

  it("renders a score board as points out of the maximum", async () => {
    const { requests } = mockFetch({ board: () => ({ metric: "score", entries: scoreEntries(5), currentUser: null }) });
    mount({ shell: makeShell(), mode: "geoguessr" });
    await flush();
    expect(requests.find((url) => url.pathname === "/api/leaderboard")?.searchParams.get("mode")).toBe("geoguessr");
    expect(q(".compete-podium-step.is-rank-1 .compete-podium-value")?.textContent).toBe("24,000 / 25,000");
    expect(q(".compete-row[data-rank='4'] .compete-row-value")?.textContent).toBe("21,000 / 25,000");
    expect(q(".compete-board-columns")?.textContent).toContain("Score");
    expect(q(".compete-board")?.dataset.metric).toBe("score");
  });

  it("highlights your row, shows your standing in the header, and loads more on demand", async () => {
    const { requests } = mockFetch({
      signedIn: true,
      board: (url) => {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return offset === 0
          ? { metric: "time", entries: timeEntries(COMPETE_PAGE_SIZE, 1, 7), currentUser: { rank: 7, timeMs: 67_000 } }
          : { metric: "time", entries: timeEntries(5, offset + 1), currentUser: { rank: 7, timeMs: 67_000 } };
      },
    });
    mount({ shell: makeShell(true), mode: "name-all" });
    await flush();
    expect(q(".compete-guest-note")).toBeNull();
    const you = q(".compete-row.is-you")!;
    expect(you.dataset.rank).toBe("7");
    expect(you.textContent).toContain("You");
    expect(q(".compete-standing")?.textContent).toBe("#7Your best 1:07.0");
    expect(document.querySelectorAll(".compete-podium-step")).toHaveLength(3);
    expect(document.querySelectorAll(".compete-row")).toHaveLength(COMPETE_PAGE_SIZE - 3);

    const more = q<HTMLButtonElement>(".compete-more")!;
    expect(more.hidden).toBe(false);
    more.click();
    await flush();
    expect(document.querySelectorAll(".compete-row")).toHaveLength(COMPETE_PAGE_SIZE + 2);
    expect(more.hidden).toBe(true);
    expect(requests.some((url) => url.searchParams.get("offset") === String(COMPETE_PAGE_SIZE))).toBe(true);
  });

  it("pins your row under the board when you rank below the rows shown", async () => {
    mockFetch({ signedIn: true, board: () => ({ metric: "score", entries: scoreEntries(5), currentUser: { rank: 57, score: 9_100 } }) });
    mount({ shell: makeShell(true), mode: "map-tap" });
    await flush();
    const you = q(".compete-row.is-you")!;
    expect(you.dataset.rank).toBe("57");
    expect(you.classList.contains("is-pinned")).toBe(true);
    expect(you.querySelector(".compete-row-value")?.textContent).toBe("9,100 / 50,000");
    expect(q(".compete-row-gap")).not.toBeNull();
    expect(q(".compete-standing")?.textContent).toContain("9,100");
  });

  it("marks you on the podium when you're in the top three", async () => {
    mockFetch({ signedIn: true, board: () => ({ metric: "time", entries: timeEntries(4, 1, 2), currentUser: { rank: 2, timeMs: 62_000 } }) });
    mount({ shell: makeShell(true), mode: "shapes" });
    await flush();
    expect(q(".compete-podium-step.is-you")?.getAttribute("data-rank")).toBe("2");
    expect(q(".compete-row-gap")).toBeNull();
  });

  it("shows guests a slim sign-in note and their best on this device", async () => {
    mockFetch();
    const shell = makeShell(false);
    window.localStorage.setItem(timerKeysForMode("codes").best, "83400");
    mount({ shell, mode: "codes" });
    await flush();
    const note = q<HTMLButtonElement>(".compete-guest-note")!;
    expect(note.textContent).toBe("Sign in to post your scores");
    expect(q(".compete-standing")?.textContent).toContain("1:23.4");
    note.click();
    expect(shell.calls).toContain("account");
    expect(q(".compete-banner")).toBeNull();
    expect(q(".compete-best")).toBeNull();
  });

  it("shows empty and error states, and retries", async () => {
    let fail = true;
    mockFetch({ board: () => (fail ? null : { metric: "score", entries: [], currentUser: null }) });
    mount({ shell: makeShell(), mode: "worldsplit" });
    await flush();
    expect(q(".compete-board")?.dataset.state).toBe("error");
    expect(q(".compete-board-state")?.textContent).toContain("Couldn't load the leaderboard");
    fail = false;
    q<HTMLButtonElement>(".compete-retry")!.click();
    await flush();
    expect(q(".compete-board")?.dataset.state).toBe("empty");
    expect(q(".compete-board-state")?.textContent).toContain("No scores on this board yet");
  });
});

const friend = (id: string, username: string, online: boolean) => ({ user: { id, username, avatarEmoji: online ? "🐼" : null }, online });

describe("Compete screen: tabs", () => {
  it("opens on Multiplayer and only fetches boards once Leaderboards is shown", async () => {
    const { requests } = mockFetch();
    const onTab = vi.fn();
    mount({ shell: makeShell(), onTab, onCreateRoom: vi.fn() });
    await flush();
    const tabs = [...document.querySelectorAll<HTMLElement>("[role='tab']")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["MultiplayerLive match with friendsLive", "LeaderboardsSolo ranked attempts"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(q<HTMLElement>("#compete-panel-multiplayer")!.hidden).toBe(false);
    expect(q<HTMLElement>("#compete-panel-leaderboards")!.hidden).toBe(true);
    expect(requests.some((url) => url.pathname === "/api/leaderboard")).toBe(false);

    tabs[1]!.click();
    await flush();
    expect(onTab).toHaveBeenLastCalledWith("leaderboards", "flags", "");
    expect(q<HTMLElement>("#compete-panel-leaderboards")!.hidden).toBe(false);
    expect(q("#compete")?.getAttribute("data-tab")).toBe("leaderboards");
    expect(requests.some((url) => url.pathname === "/api/leaderboard")).toBe(true);
  });

  it("treats a board link (a mode) as the Leaderboards tab", async () => {
    mockFetch();
    mount({ shell: makeShell(), mode: "puzzle", variant: "Asia" });
    await flush();
    expect(q("#compete-tab-leaderboards")?.getAttribute("aria-selected")).toBe("true");
    expect(q<HTMLElement>("#compete-panel-multiplayer")!.hidden).toBe(true);
  });

  it("moves between tabs with the arrow keys", async () => {
    mockFetch();
    mount({ shell: makeShell() });
    const list = q(".compete-tabs")!;
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(q("#compete-tab-leaderboards")?.getAttribute("aria-selected")).toBe("true");
    expect(q<HTMLElement>("#compete-tab-leaderboards")!.tabIndex).toBe(0);
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(q("#compete-tab-multiplayer")?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("Compete screen: Multiplayer tab", () => {
  it("asks a guest for a name before creating a room, then remembers it", async () => {
    mockFetch();
    const onCreateRoom = vi.fn();
    mount({ shell: makeShell(), onCreateRoom });
    await flush();
    const create = q<HTMLButtonElement>(".compete-create")!;
    expect(create.textContent).toBe("Create a room");
    create.click();
    expect(onCreateRoom).not.toHaveBeenCalled();
    expect(q<HTMLElement>(".compete-field-error")!.hidden).toBe(false);
    const name = q<HTMLInputElement>(".compete-name-input")!;
    expect(name.getAttribute("aria-invalid")).toBe("true");
    name.value = "  Sam  ";
    name.dispatchEvent(new Event("input"));
    create.click();
    expect(onCreateRoom).toHaveBeenCalledWith(undefined);
    expect(window.localStorage.getItem("locato.mp.name")).toBe("Sam");
  });

  it("prefills the remembered name and joins by code or pasted invite link", async () => {
    mockFetch();
    window.localStorage.setItem("locato.mp.name", "Ana");
    const onJoinRoom = vi.fn();
    mount({ shell: makeShell(), onJoinRoom, onCreateRoom: vi.fn() });
    await flush();
    expect(q<HTMLInputElement>(".compete-name-input")!.value).toBe("Ana");
    const input = q<HTMLInputElement>(".compete-join-input")!;
    const form = q<HTMLFormElement>(".compete-join")!;
    input.value = "ab";
    form.requestSubmit();
    expect(onJoinRoom).not.toHaveBeenCalled();
    expect(q(".compete-join .compete-field-hint")?.classList.contains("is-error")).toBe(true);
    input.value = "https://locato.app/?room=k7qmr";
    form.requestSubmit();
    expect(onJoinRoom).toHaveBeenLastCalledWith("K7QMR");
    input.value = " x2 d4q ";
    form.requestSubmit();
    expect(onJoinRoom).toHaveBeenLastCalledWith("X2D4Q");
  });

  it("shows a signed-in player's friends online, each with a create-and-invite button", async () => {
    mockFetch({ signedIn: true, friends: { friends: [friend("u1", "ben", true), friend("u2", "kofi", false), friend("u3", "ana", true)], incoming: [], outgoing: [] } });
    const onCreateRoom = vi.fn();
    mount({ shell: makeShell(true), onCreateRoom });
    await flush();
    expect(q<HTMLElement>(".compete-name-field")!.hidden).toBe(true);
    expect(q(".compete-playing-as")?.textContent).toContain("Tate");
    const rows = [...document.querySelectorAll<HTMLElement>(".compete-online-row")];
    expect(rows.map((row) => row.dataset.user)).toEqual(["u1", "u3"]);
    expect(q(".compete-online-count")?.textContent).toBe("2");
    rows[1]!.querySelector<HTMLButtonElement>(".compete-invite")!.click();
    expect(onCreateRoom).toHaveBeenCalledWith({ inviteUserId: "u3" });
    // Signed in: no name is needed (the server uses the account name).
    q<HTMLButtonElement>(".compete-create")!.click();
    expect(onCreateRoom).toHaveBeenLastCalledWith(undefined);
  });

  it("refetches friends on presence changes and unsubscribes on destroy", async () => {
    let online = false;
    mockFetch({ signedIn: true, friends: undefined });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/auth/me") return new Response(JSON.stringify({ user: ME, stats: {} }));
      if (url.pathname === "/api/friends") return new Response(JSON.stringify({ friends: [friend("u1", "ben", online)], incoming: [], outgoing: [] }));
      return new Response("{}", { status: 404 });
    }));
    let listener: (() => void) | null = null;
    const unsubscribe = vi.fn();
    const screen = mount({ shell: makeShell(true), onCreateRoom: vi.fn(), onFriends: vi.fn(), subscribeFriends: (next) => { listener = next; return unsubscribe; } });
    await flush();
    expect(q(".compete-online")?.textContent).toContain("Your friend isn't online right now");
    online = true;
    listener!();
    await flush();
    expect(document.querySelectorAll(".compete-online-row")).toHaveLength(1);
    screen.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("nudges guests to sign in for friends, and offers the way back into a room in progress", async () => {
    mockFetch();
    window.sessionStorage.setItem("locato.mp.session", JSON.stringify({ roomCode: "K7QMR", playerId: "p1", sessionToken: "t" }));
    const shell = makeShell();
    const onRejoinRoom = vi.fn();
    mount({ shell, onRejoinRoom, onCreateRoom: vi.fn() });
    await flush();
    q<HTMLButtonElement>(".compete-online-signin")!.click();
    expect(shell.calls).toContain("account");
    expect(q(".compete-rejoin")?.textContent).toContain("room K7QMR");
    q<HTMLButtonElement>(".compete-rejoin-action")!.click();
    expect(onRejoinRoom).toHaveBeenCalledOnce();
  });

  it("links to the full room setup and across to the solo leaderboards", async () => {
    mockFetch();
    const onMultiplayer = vi.fn();
    const onTab = vi.fn();
    mount({ shell: makeShell(), onMultiplayer, onTab, onCreateRoom: vi.fn() });
    await flush();
    q<HTMLButtonElement>(".compete-custom")!.click();
    expect(onMultiplayer).toHaveBeenCalledOnce();
    q<HTMLButtonElement>(".compete-cross-band")!.click();
    expect(onTab).toHaveBeenLastCalledWith("leaderboards", "flags", "");
    expect(q<HTMLElement>("#compete-panel-leaderboards")!.hidden).toBe(false);
  });
});

describe("leaderboard rank helpers", () => {
  it("fetchLeaderboardRank asks where a time would place", async () => {
    const { requests } = mockFetch();
    expect(await fetchLeaderboardRank("puzzle", "Europe", 51_234.6)).toEqual({ rank: 4, total: 9 });
    const url = requests.at(-1)!;
    expect(url.pathname).toBe("/api/leaderboard/rank");
    expect(Object.fromEntries(url.searchParams)).toEqual({ mode: "puzzle", variant: "Europe", timeMs: "51235" });
  });

  it("fetchLeaderboardRank resolves null offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await fetchLeaderboardRank("flags", "", 60_000)).toBeNull();
  });

  it("submitBestTime passes the rank through", async () => {
    mockFetch();
    expect(await submitBestTime({ gameMode: "flags", variant: "", timeMs: 61_000 })).toEqual({ accepted: true, isPersonalBest: true, rank: 3, bestTimeMs: 61_000 });
  });
});
