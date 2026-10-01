import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLeaderboard, fetchLeaderboardRank, submitBestTime, submitLeaderboardAttempt } from "../src/core/auth";
import { postRankedAttempt, postTimedRun } from "../src/core/timer/leaderboardSync";
import { timedPostingLine } from "../src/ui/screens/gameResults";

afterEach(() => vi.unstubAllGlobals());

describe("timed run posting", () => {
  it("reports the rank after posting for signed-in players", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ accepted: true, isPersonalBest: true, rank: 4, bestTimeMs: 90_000 }), { status: 200 })));
    const posting = await postTimedRun({ gameMode: "flags", variant: "", timeMs: 90_000, isLoggedIn: true });
    expect(posting).toEqual({ serverAccepted: true, rank: 4 });
    expect(timedPostingLine({ isNewLocalBest: true, ...posting })).toBe("New personal best. Posted to the leaderboard — you're #4.");
  });

  it("tells guests where their time would place without posting it", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ rank: 12, total: 40 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const posting = await postTimedRun({ gameMode: "capitals", variant: "", timeMs: 120_000, isLoggedIn: false });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/leaderboard/rank?");
    expect(timedPostingLine({ isNewLocalBest: false, ...posting })).toMatch(/^That would place #12 on the board\. Sign in to post/);
  });

  it("stays quiet about rank when offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const posting = await postTimedRun({ gameMode: "flags", variant: "", timeMs: 90_000, isLoggedIn: true });
    expect(posting).toEqual({ serverAccepted: false, rank: null, failed: true });
    expect(timedPostingLine({ isNewLocalBest: true, ...posting })).toMatch(/^New personal best\. Couldn't post this time/);
  });

  it("posts a score (not a time) for score boards and reads the best score back", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ accepted: true, isPersonalBest: true, rank: 2, bestScore: 21_000 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const posting = await postRankedAttempt({ gameMode: "geoguessr", variant: "", value: 21_000, isLoggedIn: true });
    expect(posting).toEqual({ serverAccepted: true, rank: 2 });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ gameMode: "geoguessr", variant: "", score: 21_000 });

    await postRankedAttempt({ gameMode: "flag-colors", variant: "", value: 95_000.4, isLoggedIn: true });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ gameMode: "flag-colors", variant: "", timeMs: 95_000 });
  });

  it("asks guests' would-place rank with the board's metric", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ rank: 7, total: 30 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await postRankedAttempt({ gameMode: "map-tap", variant: "", value: 31_000, isLoggedIn: false })).toEqual({ serverAccepted: null, rank: 7 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/leaderboard/rank?mode=map-tap&variant=&score=31000");
    expect(await fetchLeaderboardRank("flags", "both", 61_000)).toEqual({ rank: 7, total: 30 });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("/api/leaderboard/rank?mode=flags&variant=both&timeMs=61000");
  });

  it("keeps submitBestTime working and fills in metric for older servers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).startsWith("/api/leaderboard?")
        ? new Response(JSON.stringify({ entries: [], currentUser: null }), { status: 200 })
        : new Response(JSON.stringify({ accepted: true, isPersonalBest: true, rank: 1, bestTimeMs: 61_000 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await submitBestTime({ gameMode: "flags", variant: "", timeMs: 61_000 })).toEqual({ accepted: true, isPersonalBest: true, rank: 1, bestTimeMs: 61_000 });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ gameMode: "flags", variant: "", timeMs: 61_000 });
    await submitLeaderboardAttempt({ gameMode: "worldsplit", score: 420 });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ gameMode: "worldsplit", variant: "", score: 420 });
    expect((await fetchLeaderboard("worldsplit"))?.metric).toBe("score");
    expect((await fetchLeaderboard("capitals"))?.metric).toBe("time");
  });

  it("reports a failed post when the server rejects the attempt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Invalid score." }), { status: 400 })));
    expect(await postRankedAttempt({ gameMode: "streetview-country", variant: "", value: 99, isLoggedIn: true })).toEqual({ serverAccepted: false, rank: null, failed: true });
  });
});
