import { afterEach, describe, expect, it, vi } from "vitest";
import { postTimedRun } from "../src/core/timer/leaderboardSync";
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
});
