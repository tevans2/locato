// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDailyChallenge, type DailyRoundResult } from "../src/core/dailyChallenge";
import { indexCountries, rawCountries } from "../src/core/countries";
import { createDailyIntroScreen } from "../src/ui/screens/DailyIntroScreen";
import { createDailyResultScreen, dailyPlacement, keepPlayingGames, withGuestEntry } from "../src/ui/screens/DailyResultScreen";
import { createDailyResultSave, readDailyResult, readGuestBoardName } from "../src/storage/dailySave";
import { shellOrFallback } from "../src/ui/screens/practiceRun";
import type { Screen } from "../src/app/router";

const screens: Screen[] = [];
afterEach(() => {
  screens.splice(0).forEach((screen) => screen.destroy());
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const index = indexCountries(rawCountries);
const challenge = createDailyChallenge(index, "2026-10-01");
function mount(screen: Screen) { screens.push(screen); document.body.append(screen.element); return screen.element; }

describe("daily introduction and review", () => {
  it("introduces the theme, ordered stages and penalties without revealing answers", () => {
    const onStart = vi.fn();
    const root = mount(createDailyIntroScreen({ shell: shellOrFallback(undefined, vi.fn()), challenge, roundsPlayed: 0, onStart }));
    expect(root.querySelector("h1")!.textContent).toBe(challenge.theme!.title);
    expect([...root.querySelectorAll(".daily-format strong")].map((el) => el.textContent)).toEqual(["Flags", "Capitals", "Country shapes", "Country location", "Overland", "Map Tap", "Street View"]);
    expect(root.textContent).toContain("In Overland, every guess beyond the shortest route's length counts as a wrong guess.");
    expect(root.textContent).toContain("A hint costs 3 points and a wrong guess costs 2 points");
    for (const id of challenge.countryIds) expect(root.textContent).not.toContain(index.byId[id]!.name);
    root.querySelector<HTMLButtonElement>('[data-action="start-daily"]')!.click();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("offers resume with the saved round count", () => {
    const root = mount(createDailyIntroScreen({ shell: shellOrFallback(undefined, vi.fn()), challenge, roundsPlayed: 5, onStart: vi.fn() }));
    expect(root.textContent).toContain("5 of 10 rounds completed");
    expect(root.querySelector('[data-action="start-daily"]')!.textContent).toContain("Resume today's challenge");
  });

  it("explains hint, wrong guess, pass and map-distance losses and offers targeted practice", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ entries: [], summary: null }), { status: 200 })));
    const rounds: DailyRoundResult[] = challenge.promptSlots!.map((slot) => ({ categoryId: slot.categoryId, countryCode: index.byId[slot.countryId]!.code, points: 10, hintsUsed: 0, wrongGuesses: 0, missed: false }));
    rounds[0] = { ...rounds[0]!, points: 5, hintsUsed: 1, wrongGuesses: 1 };
    rounds[2] = { ...rounds[2]!, points: 0, missed: true };
    const route = challenge.overlandRoute!;
    rounds.push({ categoryId: "overland", targetId: `${route.start}-${route.end}`, points: 8, hintsUsed: 0, wrongGuesses: 1, missed: false },
      { categoryId: "map-tap", targetId: challenge.mapTapTargetId, points: 5, hintsUsed: 0, wrongGuesses: 0, missed: false, distanceKm: 1_234 },
      { categoryId: "streetview-country", countryCode: challenge.streetViewCountryCode, points: 8, hintsUsed: 0, wrongGuesses: 1, missed: false });
    const result = createDailyResultSave({ date: challenge.date, seed: challenge.seed, score: 76, timeMs: 100_000, hintsUsed: 1,
      marks: ["hint", "correct", "miss", "correct", "correct", "correct", "correct", "correct", "hint", "hint"], rounds, challengeVersion: 2 });
    const onPractice = vi.fn();
    const root = mount(createDailyResultScreen({ shell: shellOrFallback(undefined, vi.fn()), storage: window.localStorage, result, countryIndex: index, onPractice }));
    expect(root.querySelectorAll(".daily-recap-row")).toHaveLength(10);
    expect(root.textContent).toContain("1 hint · 1 wrong guess · 5 points lost");
    expect(root.textContent).toContain("Passed or revealed · 0 points");
    expect(root.textContent).toContain("1,234 km from target · 5 points lost");
    expect(root.textContent).toContain(index.byCode.get(rounds[2]!.countryCode!)!.capital);
    expect(root.textContent).toContain(`${index.byCode.get(route.start)!.name} → ${index.byCode.get(route.end)!.name}`);
    expect(root.textContent).toContain("1 extra guess · 2 points lost");
    expect(root.textContent).toContain("Revisit 5 questions");
    root.querySelector<HTMLButtonElement>('[data-action="practice-daily"]')!.click();
    expect(onPractice).toHaveBeenCalledOnce();
    expect(result.score).toBe(76);
  });

  it("shows the player's rank, pins their row under the top ten and uses the account streak", async () => {
    const entries = Array.from({ length: 12 }, (_, n) => ({ rank: n + 1, user: { id: `u${n + 1}`, username: `player${n + 1}`, avatarEmoji: null },
      result: { date: challenge.date, score: 100 - n, timeMs: 60_000 } }));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => new Response(JSON.stringify(String(input).includes("/leaderboard")
      ? { entries }
      : { summary: { history: [], streak: 9, best: null, friendsToday: [] } }), { status: 200 })));
    const result = createDailyResultSave({ date: challenge.date, seed: challenge.seed, score: 89, timeMs: 60_000, hintsUsed: 0, marks: Array(10).fill("correct") });
    const root = mount(createDailyResultScreen({ shell: shellOrFallback(undefined, vi.fn()), storage: window.localStorage, result, countryIndex: index, onPractice: vi.fn(), currentUserId: "u12" }));
    await vi.waitFor(() => expect(root.querySelector(".daily-result-rank")?.textContent).toBe("#12 of 12 today"));
    const rows = root.querySelectorAll(".daily-board-row");
    expect(rows).toHaveLength(11);
    expect(rows[10]!.classList.contains("is-you")).toBe(true);
    await vi.waitFor(() => expect(root.querySelector(".daily-result-stats")?.textContent).toContain("Daily streak9"));
  });
});

describe("daily results lead on to the full games", () => {
  const round = (categoryId: string, points: number): DailyRoundResult => ({ categoryId, points, hintsUsed: 0, wrongGuesses: 0, missed: points === 0, ...(categoryId === "map-tap" || categoryId === "overland" ? { targetId: "x" } : { countryCode: "JP" }) });

  it("suggests the games behind today's rounds, the costliest first", () => {
    const rounds = [round("flags", 10), round("flags", 10), round("capitals", 8), round("capitals", 2), round("shapes", 10), round("shapes", 7),
      round("pick-country", 10), round("overland", 4), round("map-tap", 9), round("streetview-country", 10)];
    expect(keepPlayingGames({ rounds })).toEqual([{ game: "capitals", lost: 10 }, { game: "overland", lost: 6 }, { game: "shapes", lost: 3 }]);
    // A perfect daily still points somewhere: its first games, in the daily's order.
    expect(keepPlayingGames({ rounds: rounds.map((r) => ({ ...r, points: 10, missed: false })) }).map((g) => g.game)).toEqual(["flags", "capitals", "shapes"]);
    expect(keepPlayingGames({}).map((g) => g.lost)).toEqual([null, null, null]);
  });

  it("puts a Keep playing section right under the score that opens those games", () => {
    const openGame = vi.fn();
    const openGamePicker = vi.fn();
    const openDailyPuzzle = vi.fn();
    const shell = { ...shellOrFallback(undefined, vi.fn()), openGame, openGamePicker, openDailyPuzzle };
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const rounds = [round("flags", 10), round("flags", 10), round("capitals", 4), round("capitals", 10), round("shapes", 10), round("shapes", 10), round("pick-country", 10), round("overland", 10), round("map-tap", 6), round("streetview-country", 10)];
    const result = createDailyResultSave({ date, seed: `daily:${date}`, score: 90, timeMs: 120_000, hintsUsed: 0, marks: rounds.map((r) => (r.points === 10 ? "correct" : "hint")), challengeVersion: 2, rounds });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const root = mount(createDailyResultScreen({ shell, storage: window.localStorage, result, countryIndex: index, onPractice: vi.fn() }));
    const section = root.querySelector(".daily-keep-playing")!;
    expect(section.compareDocumentPosition(root.querySelector(".daily-recap")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cards = [...section.querySelectorAll<HTMLButtonElement>(".daily-keep-card")];
    expect(cards.map((card) => card.dataset.game)).toEqual(["capitals", "map-tap", "flags"]);
    expect(cards[0]!.textContent).toContain("You dropped 6 points here today");
    cards[1]!.click();
    expect(openGame).toHaveBeenCalledWith("map-tap", "practice");
    root.querySelector<HTMLButtonElement>('[data-action="all-games"]')!.click();
    expect(openGamePicker).toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('[data-action="daily-mystery"]')!.click();
    expect(openDailyPuzzle).toHaveBeenCalledWith("mystery");
    expect(root.querySelector('[data-action="more-games"]')!.textContent).toBe("Play more games");
  });
});

describe("guests on the daily board", () => {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const board = [90, 85, 70].map((score, n) => ({ rank: n + 1, user: { id: `u${n}`, username: `player${n}`, avatarEmoji: null }, result: { date, seed: `daily:${date}`, score, timeMs: 100_000, hintsUsed: 0, marks: [], shareText: "", completedAt: 0 } }));
  const guestResult = (extra: { startTicket?: string } = {}) => createDailyResultSave({ date, seed: `daily:${date}`, score: 82, timeMs: 120_000, hintsUsed: 1, marks: Array(10).fill("correct"), ...extra });

  it("places a result by score, then time, then hints", () => {
    expect(dailyPlacement(board, { score: 82, timeMs: 1, hintsUsed: 0 })).toBe(3);
    expect(dailyPlacement(board, { score: 85, timeMs: 99_000, hintsUsed: 0 })).toBe(2);
    expect(dailyPlacement(board, { score: 85, timeMs: 100_000, hintsUsed: 0 })).toBe(2);
    expect(dailyPlacement(board, { score: 85, timeMs: 101_000, hintsUsed: 0 })).toBe(3);
    expect(dailyPlacement([], { score: 0, timeMs: 1, hintsUsed: 0 })).toBe(1);
  });

  it("puts a guest's own entry in place when the board doesn't include it", () => {
    const placed = withGuestEntry(board, guestResult(), { id: "g1", name: "Sam" });
    expect(placed.map((entry) => [entry.rank, entry.user.username])).toEqual([[1, "player0"], [2, "player1"], [3, "Sam"], [4, "player2"]]);
    expect(withGuestEntry(placed, guestResult(), { id: "g1", name: "Sam" })).toBe(placed);
  });

  it("tells a guest where they'd place and leads with signing in", async () => {
    const openAccount = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: string) => String(input).includes("/leaderboard") ? new Response(JSON.stringify({ entries: board })) : new Response("{}", { status: 401 })));
    const root = mount(createDailyResultScreen({ shell: { ...shellOrFallback(undefined, vi.fn()), openAccount }, storage: window.localStorage, result: guestResult(), countryIndex: index, onPractice: vi.fn() }));
    const claim = root.querySelector<HTMLElement>('[data-testid="daily-claim"]')!;
    await vi.waitFor(() => expect(claim.hidden).toBe(false));
    expect(claim.textContent).toContain("Your 82 would place #3 of 4 today.");
    root.querySelector<HTMLButtonElement>('[data-action="claim-sign-in"]')!.click();
    expect(openAccount).toHaveBeenCalledOnce();
    // Without a start ticket there's nothing to check a guest post against: accounts only.
    expect(root.querySelector('[data-action="post-as-guest"]')).toBeNull();
  });

  it("posts with just a name, then shows the guest on the board", async () => {
    let posted: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (String(input) === "/api/daily/guest") {
        posted = JSON.parse(String(init!.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ entry: { id: "g1", name: "Sam" } }));
      }
      return String(input).includes("/leaderboard") ? new Response(JSON.stringify({ entries: board })) : new Response("{}", { status: 401 });
    }));
    const result = guestResult({ startTicket: "d1.ticket" });
    const root = mount(createDailyResultScreen({ shell: shellOrFallback(undefined, vi.fn()), storage: window.localStorage, result, countryIndex: index, onPractice: vi.fn() }));
    const reveal = await vi.waitFor(() => { const button = root.querySelector<HTMLButtonElement>('[data-action="post-as-guest"]'); if (!button) throw new Error("not yet"); return button; });
    const form = root.querySelector<HTMLFormElement>('[data-testid="daily-guest-form"]')!;
    expect(form.hidden).toBe(true);
    reveal.click();
    expect(form.hidden).toBe(false);
    form.querySelector("input")!.value = "Sam";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector(".daily-result-rank")?.textContent).toBe("#3 of 4 today"));
    expect(posted).toMatchObject({ name: "Sam", score: 82, startTicket: "d1.ticket" });
    expect(posted).not.toHaveProperty("version");
    const mine = root.querySelector(".daily-board-row.is-you")!;
    expect(mine.textContent).toContain("Sam");
    expect(mine.textContent).toContain("guest");
    expect(root.querySelector('[data-testid="daily-claim"]')!.textContent).toContain("You're on today's board as Sam.");
    expect(readDailyResult(window.localStorage, date, null)?.guestEntry).toEqual({ id: "g1", name: "Sam" });
    expect(readGuestBoardName(window.localStorage)).toBe("Sam");
  });

  it("shows the server's reason when a name is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => String(input) === "/api/daily/guest"
      ? new Response(JSON.stringify({ error: "That name belongs to an account. Pick another, or sign in." }), { status: 409 })
      : String(input).includes("/leaderboard") ? new Response(JSON.stringify({ entries: board })) : new Response("{}", { status: 401 })));
    const root = mount(createDailyResultScreen({ shell: shellOrFallback(undefined, vi.fn()), storage: window.localStorage, result: guestResult({ startTicket: "d1.ticket" }), countryIndex: index, onPractice: vi.fn() }));
    (await vi.waitFor(() => { const button = root.querySelector<HTMLButtonElement>('[data-action="post-as-guest"]'); if (!button) throw new Error("not yet"); return button; })).click();
    const form = root.querySelector<HTMLFormElement>('[data-testid="daily-guest-form"]')!;
    form.querySelector("input")!.value = "player0";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(form.querySelector<HTMLElement>(".daily-claim-error")!.hidden).toBe(false));
    expect(form.textContent).toContain("That name belongs to an account");
  });

  it("isn't offered to accounts or on an older day's results", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => new Response(JSON.stringify(String(input).includes("/leaderboard") ? { entries: board } : { summary: { history: [], streak: 1, best: null, friendsToday: [] } }))));
    const account = mount(createDailyResultScreen({ shell: shellOrFallback(undefined, vi.fn()), storage: window.localStorage, result: guestResult({ startTicket: "t" }), countryIndex: index, onPractice: vi.fn(), currentUserId: "u0" }));
    const older = mount(createDailyResultScreen({ shell: shellOrFallback(undefined, vi.fn()), storage: window.localStorage, result: createDailyResultSave({ date: "2026-10-01", seed: "daily:2026-10-01", score: 50, timeMs: 1, hintsUsed: 0, marks: Array(10).fill("correct") }), countryIndex: index, onPractice: vi.fn() }));
    await vi.waitFor(() => expect(account.querySelectorAll(".daily-board-row").length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(older.querySelectorAll(".daily-board-row").length).toBeGreaterThan(0));
    expect(account.querySelector<HTMLElement>('[data-testid="daily-claim"]')!.hidden).toBe(true);
    expect(older.querySelector<HTMLElement>('[data-testid="daily-claim"]')!.hidden).toBe(true);
  });
});
