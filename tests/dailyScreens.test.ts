// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDailyChallenge, type DailyRoundResult } from "../src/core/dailyChallenge";
import { indexCountries, rawCountries } from "../src/core/countries";
import { createDailyIntroScreen } from "../src/ui/screens/DailyIntroScreen";
import { createDailyResultScreen } from "../src/ui/screens/DailyResultScreen";
import { createDailyResultSave } from "../src/storage/dailySave";
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
