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
    expect([...root.querySelectorAll(".daily-format strong")].map((el) => el.textContent)).toEqual(["Flags", "Capitals", "Country shapes", "Country locations", "Map Tap", "Street View"]);
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
    rounds.push({ categoryId: "map-tap", targetId: challenge.mapTapTargetId, points: 5, hintsUsed: 0, wrongGuesses: 0, missed: false, distanceKm: 1_234 },
      { categoryId: "streetview-country", countryCode: challenge.streetViewCountryCode, points: 8, hintsUsed: 0, wrongGuesses: 1, missed: false });
    const result = createDailyResultSave({ date: challenge.date, seed: challenge.seed, score: 78, timeMs: 100_000, hintsUsed: 1,
      marks: ["hint", "correct", "miss", "correct", "correct", "correct", "correct", "correct", "hint", "hint"], rounds, challengeVersion: 2 });
    const onPractice = vi.fn();
    const root = mount(createDailyResultScreen({ shell: shellOrFallback(undefined, vi.fn()), storage: window.localStorage, result, countryIndex: index, onPractice }));
    expect(root.querySelectorAll(".daily-recap-row")).toHaveLength(10);
    expect(root.textContent).toContain("1 hint · 1 wrong guess · 5 points lost");
    expect(root.textContent).toContain("Passed or revealed · 0 points");
    expect(root.textContent).toContain("1,234 km from target · 5 points lost");
    expect(root.textContent).toContain(index.byCode.get(rounds[2]!.countryCode!)!.capital);
    expect(root.textContent).toContain("Revisit 4 questions");
    root.querySelector<HTMLButtonElement>('[data-action="practice-daily"]')!.click();
    expect(onPractice).toHaveBeenCalledOnce();
    expect(result.score).toBe(78);
  });
});
