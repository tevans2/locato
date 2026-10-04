// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLeaderboardRank, submitBestTime } from "../src/core/auth";
import { GAME_MODE_GROUPS } from "../src/core/gameModes";
import { LEADERBOARD_MODES, leaderboardConfig } from "../src/core/leaderboards";
import { timerKeysForMode } from "../src/core/timer/keys";
import { LEADERBOARD_PAGE_SIZE, createLeaderboardsScreen, type LeaderboardsScreenOptions } from "../src/ui/screens/LeaderboardsScreen";
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
    openLeaderboards: (mode) => calls.push(`leaderboards:${mode ?? ""}`),
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

function mount(options: Partial<LeaderboardsScreenOptions> & { shell: ShellContext }) {
  const storage = options.storage ?? window.localStorage;
  const screen = createLeaderboardsScreen({ storage, ...options });
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

describe("Leaderboards screen", () => {
  it("offers all 15 modes grouped Clues, Map and Street View", async () => {
    mockFetch();
    mount({ shell: makeShell() });
    await flush();
    const groups = [...document.querySelectorAll<HTMLElement>(".lb-modes-group")];
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Clues", "Map", "Street View"]);
    const modes = [...document.querySelectorAll<HTMLElement>(".lb-mode")].map((item) => item.dataset.mode);
    expect(modes).toEqual(LEADERBOARD_MODES.map((config) => config.mode).sort((a, b) => GAME_ORDER.indexOf(a) - GAME_ORDER.indexOf(b)));
    expect(modes).toHaveLength(15);
    expect(q(".lb-mode[data-mode='flags']")?.getAttribute("aria-pressed")).toBe("true");
    expect(q(".lb-title")?.textContent).toBe("Flags");
    expect(q(".lb-attempt")?.textContent).toBe(leaderboardConfig("flags")!.attempt);
  });

  it("selecting a mode reports it for a URL replace and reloads the board", async () => {
    const { requests } = mockFetch();
    const onSelect = vi.fn();
    mount({ shell: makeShell(), onSelect });
    await flush();
    q<HTMLButtonElement>(".lb-mode[data-mode='puzzle']")!.click();
    expect(onSelect).toHaveBeenLastCalledWith("puzzle", "Africa");
    expect(q(".lb-title")?.textContent).toBe("Puzzle");
    q<HTMLButtonElement>(".lb-segment[data-variant='Europe']")!.click();
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
    expect([...document.querySelectorAll<HTMLElement>(".lb-segment")].map((pill) => pill.textContent)).toEqual(["Countries", "Territories", "Both"]);
    for (const mode of ["shapes", "map-tap", "geoguessr", "worldsplit"]) {
      q<HTMLButtonElement>(`.lb-mode[data-mode='${mode}']`)!.click();
      expect(q<HTMLElement>(".lb-variants")!.hidden).toBe(true);
      expect(document.querySelectorAll(".lb-segment")).toHaveLength(0);
    }
    q<HTMLButtonElement>(".lb-mode[data-mode='puzzle']")!.click();
    expect(q<HTMLElement>(".lb-variants")!.hidden).toBe(false);
    expect(document.querySelectorAll(".lb-segment")).toHaveLength(6);
  });

  it("labels the call to action per metric and starts a ranked attempt with the variant", async () => {
    mockFetch();
    const shell = makeShell();
    mount({ shell, mode: "flags", variant: "territories" });
    await flush();
    const play = q<HTMLButtonElement>(".lb-play")!;
    expect(play.textContent).toBe("Start a timed run");
    expect(q(".lb-segment[data-variant='territories']")?.getAttribute("aria-checked")).toBe("true");
    play.click();
    q<HTMLButtonElement>(".lb-segment[data-variant='']")!.click();
    play.click();
    q<HTMLButtonElement>(".lb-mode[data-mode='map-tap']")!.click();
    expect(play.textContent).toBe("Play a ranked attempt");
    expect(q(".lb-eyebrow")?.textContent).toBe("Map · Highest score wins");
    expect(q(".lb-practise")?.textContent).toBe("or play with custom settings");
    play.click();
    q<HTMLButtonElement>(".lb-practise")!.click();
    // A single-run mode has one way to play: "Play Street View country", and no practice link.
    q<HTMLButtonElement>(".lb-mode[data-mode='streetview-country']")!.click();
    expect(play.textContent).toBe("Play Street View country");
    expect(q(".lb-practise")?.hidden).toBe(true);
    play.click();
    expect(shell.calls).toEqual(["game:flags:timed:territories", "game:flags:timed:", "game:map-tap:timed:", "game:map-tap:practice:", "game:streetview-country:timed:"]);
  });

  it("renders a time board as times, with a podium for the top three", async () => {
    mockFetch({ board: () => ({ metric: "time", entries: timeEntries(6), currentUser: null }) });
    mount({ shell: makeShell(), mode: "capitals" });
    await flush();
    const podium = [...document.querySelectorAll<HTMLElement>(".lb-podium-step")];
    expect(podium.map((step) => step.dataset.rank)).toEqual(["1", "2", "3"]);
    expect(podium[0]!.querySelector(".lb-podium-value")?.textContent).toBe("1:01.0");
    const rows = [...document.querySelectorAll<HTMLElement>(".lb-row")];
    expect(rows.map((item) => item.dataset.rank)).toEqual(["4", "5", "6"]);
    expect(rows[0]!.querySelector(".lb-row-value")?.textContent).toBe("1:04.0");
    expect(q(".lb-board-columns")?.textContent).toContain("Time");
  });

  it("renders a score board as points out of the maximum", async () => {
    const { requests } = mockFetch({ board: () => ({ metric: "score", entries: scoreEntries(5), currentUser: null }) });
    mount({ shell: makeShell(), mode: "geoguessr" });
    await flush();
    expect(requests.find((url) => url.pathname === "/api/leaderboard")?.searchParams.get("mode")).toBe("geoguessr");
    expect(q(".lb-podium-step.is-rank-1 .lb-podium-value")?.textContent).toBe("24,000 / 25,000");
    expect(q(".lb-row[data-rank='4'] .lb-row-value")?.textContent).toBe("21,000 / 25,000");
    expect(q(".lb-board-columns")?.textContent).toContain("Score");
    expect(q(".lb-board")?.dataset.metric).toBe("score");
  });

  it("highlights your row, shows your standing in the header, and loads more on demand", async () => {
    const { requests } = mockFetch({
      signedIn: true,
      board: (url) => {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return offset === 0
          ? { metric: "time", entries: timeEntries(LEADERBOARD_PAGE_SIZE, 1, 7), currentUser: { rank: 7, timeMs: 67_000 } }
          : { metric: "time", entries: timeEntries(5, offset + 1), currentUser: { rank: 7, timeMs: 67_000 } };
      },
    });
    mount({ shell: makeShell(true), mode: "name-all" });
    await flush();
    expect(q(".lb-guest-note")).toBeNull();
    const you = q(".lb-row.is-you")!;
    expect(you.dataset.rank).toBe("7");
    expect(you.textContent).toContain("You");
    expect(q(".lb-standing")?.textContent).toBe("#7Your best 1:07.0");
    expect(document.querySelectorAll(".lb-podium-step")).toHaveLength(3);
    expect(document.querySelectorAll(".lb-row")).toHaveLength(LEADERBOARD_PAGE_SIZE - 3);

    const more = q<HTMLButtonElement>(".lb-more")!;
    expect(more.hidden).toBe(false);
    more.click();
    await flush();
    expect(document.querySelectorAll(".lb-row")).toHaveLength(LEADERBOARD_PAGE_SIZE + 2);
    expect(more.hidden).toBe(true);
    expect(requests.some((url) => url.searchParams.get("offset") === String(LEADERBOARD_PAGE_SIZE))).toBe(true);
  });

  it("pins your row under the board when you rank below the rows shown", async () => {
    mockFetch({ signedIn: true, board: () => ({ metric: "score", entries: scoreEntries(5), currentUser: { rank: 57, score: 9_100 } }) });
    mount({ shell: makeShell(true), mode: "map-tap" });
    await flush();
    const you = q(".lb-row.is-you")!;
    expect(you.dataset.rank).toBe("57");
    expect(you.classList.contains("is-pinned")).toBe(true);
    expect(you.querySelector(".lb-row-value")?.textContent).toBe("9,100 / 50,000");
    expect(q(".lb-row-gap")).not.toBeNull();
    expect(q(".lb-standing")?.textContent).toContain("9,100");
  });

  it("marks you on the podium when you're in the top three", async () => {
    mockFetch({ signedIn: true, board: () => ({ metric: "time", entries: timeEntries(4, 1, 2), currentUser: { rank: 2, timeMs: 62_000 } }) });
    mount({ shell: makeShell(true), mode: "shapes" });
    await flush();
    expect(q(".lb-podium-step.is-you")?.getAttribute("data-rank")).toBe("2");
    expect(q(".lb-row-gap")).toBeNull();
  });

  it("shows guests a slim sign-in note and their best on this device", async () => {
    mockFetch();
    const shell = makeShell(false);
    window.localStorage.setItem(timerKeysForMode("codes").best, "83400");
    mount({ shell, mode: "codes" });
    await flush();
    const note = q<HTMLButtonElement>(".lb-guest-note")!;
    expect(note.textContent).toBe("Sign in to post your scores");
    expect(q(".lb-standing")?.textContent).toContain("1:23.4");
    note.click();
    expect(shell.calls).toContain("account");
    expect(q(".lb-banner")).toBeNull();
    expect(q(".lb-best")).toBeNull();
  });

  it("shows empty and error states, and retries", async () => {
    let fail = true;
    mockFetch({ board: () => (fail ? null : { metric: "score", entries: [], currentUser: null }) });
    mount({ shell: makeShell(), mode: "worldsplit" });
    await flush();
    expect(q(".lb-board")?.dataset.state).toBe("error");
    expect(q(".lb-board-state")?.textContent).toContain("Couldn't load the leaderboard");
    fail = false;
    q<HTMLButtonElement>(".lb-retry")!.click();
    await flush();
    expect(q(".lb-board")?.dataset.state).toBe("empty");
    expect(q(".lb-board-state")?.textContent).toContain("No scores on this board yet");
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
