// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLeaderboardRank, submitBestTime } from "../src/core/auth";
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

function entries(count: number, start = 1, you?: number) {
  return Array.from({ length: count }, (_, index) => {
    const rank = start + index;
    return { rank, userId: rank === you ? ME.id : `u${rank}`, displayName: rank === you ? ME.displayName : `Player ${rank}`, avatarEmoji: null, timeMs: 60_000 + rank * 1000, achievedAt: rank };
  });
}

interface FetchSetup {
  readonly signedIn?: boolean;
  readonly board?: (url: URL) => unknown | null;
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
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Compete screen", () => {
  it("lists the nine leaderboard modes grouped as Clues and Map", async () => {
    mockFetch();
    mount({ shell: makeShell() });
    await flush();
    const groups = [...document.querySelectorAll(".compete-rail-group")];
    expect(groups.map((group) => group.querySelector("h2")?.textContent)).toEqual(["Clues", "Map"]);
    const modes = [...document.querySelectorAll<HTMLElement>(".compete-rail-item")].map((item) => item.dataset.mode);
    expect(modes).toEqual(["flags", "shapes", "codes", "capitals", "capital-recall", "name-all", "click-country", "spot-country", "puzzle"]);
    expect(q(".compete-rail-item[data-mode='flags']")?.getAttribute("aria-pressed")).toBe("true");
    expect(q(".compete-title")?.textContent).toBe("Flags");
  });

  it("selecting a mode reports it for a URL replace and reloads the board", async () => {
    const { requests } = mockFetch();
    const onSelect = vi.fn();
    mount({ shell: makeShell(), onSelect });
    await flush();
    q<HTMLButtonElement>(".compete-rail-item[data-mode='puzzle']")!.click();
    expect(onSelect).toHaveBeenLastCalledWith("puzzle", "Africa");
    expect(q(".compete-title")?.textContent).toBe("Puzzle");
    q<HTMLButtonElement>(".compete-segment[data-variant='Europe']")!.click();
    expect(onSelect).toHaveBeenLastCalledWith("puzzle", "Europe");
    await flush();
    const last = requests.filter((url) => url.pathname === "/api/leaderboard").at(-1)!;
    expect(last.searchParams.get("mode")).toBe("puzzle");
    expect(last.searchParams.get("variant")).toBe("Europe");
  });

  it("starts a timed run with the selected variant, and practice without one", async () => {
    mockFetch();
    const shell = makeShell();
    mount({ shell, mode: "flags", variant: "territories" });
    await flush();
    expect(q(".compete-segment[data-variant='territories']")?.getAttribute("aria-checked")).toBe("true");
    q<HTMLButtonElement>(".compete-start")!.click();
    q<HTMLButtonElement>(".compete-segment[data-variant='']")!.click();
    q<HTMLButtonElement>(".compete-start")!.click();
    q<HTMLButtonElement>(".compete-practise")!.click();
    expect(shell.calls).toEqual(["game:flags:timed:territories", "game:flags:timed:", "game:flags:practice:"]);
  });

  it("shows guests a sign-in banner that opens the account panel", async () => {
    mockFetch();
    const shell = makeShell(false);
    window.localStorage.setItem(timerKeysForMode("codes").best, "83400");
    mount({ shell, mode: "codes" });
    await flush();
    const banner = q(".compete-banner")!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("Sign in to post your times");
    banner.querySelector<HTMLButtonElement>("button")!.click();
    expect(shell.calls).toContain("account");
    // The local best is shown and can be posted after signing in.
    expect(q(".compete-best")?.textContent).toContain("1:23.4");
    expect(q(".compete-rail-item[data-mode='codes'] .compete-rail-time")?.textContent).toBe("1:23.4");
    expect(q(".compete-post")?.textContent).toBe("Sign in to post it");
  });

  it("renders the board with your row highlighted and loads more on demand", async () => {
    const { requests } = mockFetch({
      signedIn: true,
      board: (url) => {
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit"));
        if (limit === 1) return { entries: entries(1), currentUser: null };
        return offset === 0
          ? { entries: entries(COMPETE_PAGE_SIZE, 1, 3), currentUser: { rank: 3, timeMs: 63_000 } }
          : { entries: entries(5, offset + 1), currentUser: { rank: 3, timeMs: 63_000 } };
      },
    });
    mount({ shell: makeShell(true), mode: "name-all" });
    await flush();
    expect(q<HTMLElement>(".compete-banner")!.hidden).toBe(true);
    const rows = document.querySelectorAll(".compete-row");
    expect(rows).toHaveLength(COMPETE_PAGE_SIZE);
    const you = q(".compete-row.is-you")!;
    expect(you.dataset.rank).toBe("3");
    expect(you.textContent).toContain("You");
    expect(q(".compete-row.is-rank-1")).not.toBeNull();
    expect(q(".compete-best")?.textContent).toContain("Rank #3");
    expect(q(".compete-rail-item[data-mode='name-all'] .compete-rail-rank")?.textContent).toBe("#3");

    const more = q<HTMLButtonElement>(".compete-more")!;
    expect(more.hidden).toBe(false);
    more.click();
    await flush();
    expect(document.querySelectorAll(".compete-row")).toHaveLength(COMPETE_PAGE_SIZE + 5);
    expect(more.hidden).toBe(true);
    expect(requests.some((url) => url.searchParams.get("offset") === String(COMPETE_PAGE_SIZE))).toBe(true);
  });

  it("pins your row under the board when you rank below the rows shown", async () => {
    mockFetch({ signedIn: true, board: () => ({ entries: entries(3), currentUser: { rank: 57, timeMs: 240_000 } }) });
    mount({ shell: makeShell(true), mode: "capitals" });
    await flush();
    const you = q(".compete-row.is-you")!;
    expect(you.dataset.rank).toBe("57");
    expect(q(".compete-row-gap")).not.toBeNull();
  });

  it("offers to post a faster saved best and reloads the board", async () => {
    const { fetchMock } = mockFetch({ signedIn: true, board: () => ({ entries: entries(2), currentUser: null }) });
    window.localStorage.setItem(timerKeysForMode("shapes").best, "61000");
    mount({ shell: makeShell(true), mode: "shapes" });
    await flush();
    const post = q<HTMLButtonElement>(".compete-post")!;
    expect(post.textContent).toBe("Post saved best (1:01.0)");
    post.click();
    await flush();
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(postCall[1]!.body))).toEqual({ gameMode: "shapes", variant: "", timeMs: 61000 });
    expect(q(".compete-best")?.textContent).toContain("Posted to the leaderboard.");
  });

  it("shows empty and error states, and retries", async () => {
    let fail = true;
    mockFetch({ board: () => (fail ? null : { entries: [], currentUser: null }) });
    mount({ shell: makeShell() });
    await flush();
    expect(q(".compete-board")?.dataset.state).toBe("error");
    expect(q(".compete-board-state")?.textContent).toContain("Couldn't load the leaderboard");
    fail = false;
    q<HTMLButtonElement>(".compete-retry")!.click();
    await flush();
    expect(q(".compete-board")?.dataset.state).toBe("empty");
    expect(q(".compete-board-state")?.textContent).toContain("No times on this board yet");
  });

  it("shows the Race friends card only when multiplayer is wired", async () => {
    mockFetch();
    const onMultiplayer = vi.fn();
    mount({ shell: makeShell(), onMultiplayer });
    await flush();
    q<HTMLButtonElement>(".compete-friends-action")!.click();
    expect(onMultiplayer).toHaveBeenCalledOnce();
    document.body.replaceChildren();
    mount({ shell: makeShell() });
    expect(q(".compete-friends")).toBeNull();
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
