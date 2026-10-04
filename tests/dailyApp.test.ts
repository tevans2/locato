// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/App";
import { indexCountries, rawCountries } from "../src/core/countries";
import { createDailyChallenge, createMixedThemeDailyChallenge, getLocalDailyDate, scoreDailyRound, type DailyRoundResult } from "../src/core/dailyChallenge";
import { createDailyResultSave, readDailyProgress, readDailyResult, saveDailyProgress, saveDailyResult } from "../src/storage/dailySave";
import { createGameEngine } from "../src/core/game";
import { createSoloSave } from "../src/storage/localSave";
import type { SoloGameScreenOptions } from "../src/ui/screens/SoloGameScreen";
import type { MapTapScreenOptions } from "../src/ui/screens/MapTapScreen";
import type { StreetViewCountryScreenOptions } from "../src/ui/screens/StreetViewCountryScreen";

const captured = vi.hoisted(() => ({ solo: [] as SoloGameScreenOptions[], map: [] as MapTapScreenOptions[], street: [] as StreetViewCountryScreenOptions[] }));
vi.mock("../src/ui/components/AuthPanel", () => ({ createAuthControls: (options: { onAuthChange: (state: { user: null; stats: null }) => void }) => {
  queueMicrotask(() => options.onAuthChange({ user: null, stats: null }));
  return { trigger: document.createElement("button"), panel: document.createElement("div"), getUser: () => null, refreshStats: vi.fn(), openPanel: vi.fn() };
} }));
vi.mock("../src/core/map", () => ({ loadWorldCountryFeatures: async () => [] }));
vi.mock("../src/ui/screens/LandingScreen", () => ({ createLandingScreen: () => ({ element: document.createElement("section"), destroy: vi.fn() }) }));
vi.mock("../src/ui/screens/SoloGameScreen", () => ({ createSoloGameScreen: (options: SoloGameScreenOptions) => { captured.solo.push(options); return { element: document.createElement("section"), destroy: vi.fn() }; } }));
vi.mock("../src/ui/screens/MapTapScreen", () => ({ createMapTapScreen: (options: MapTapScreenOptions) => { captured.map.push(options); return { element: document.createElement("section"), destroy: vi.fn() }; } }));
vi.mock("../src/ui/screens/StreetViewCountryScreen", () => ({ createStreetViewCountryScreen: (options: StreetViewCountryScreenOptions) => { captured.street.push(options); return { element: document.createElement("section"), destroy: vi.fn() }; } }));

const index = indexCountries(rawCountries);
beforeEach(() => {
  captured.solo.length = captured.map.length = captured.street.length = 0;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ entries: [], summary: null }), { status: 200 })));
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

function setup() {
  const root = document.createElement("div"); root.id = "app"; document.body.append(root);
  return { root, app: createApp({ root, countryIndex: index, storage: window.localStorage }) };
}

describe("daily app orchestration", () => {
  it("shows the intro, saves all ten review entries, and restores categories on resume", async () => {
    const { root, app } = setup();
    const challenge = createDailyChallenge(index);
    app.navigate({ type: "daily-challenge" });
    await vi.waitFor(() => expect(root.querySelector("#daily-intro")).not.toBeNull());
    expect(captured.solo).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('[data-action="start-daily"]')!.click();
    await vi.waitFor(() => expect(captured.solo).toHaveLength(1));
    const first = captured.solo[0]!;
    const rounds: DailyRoundResult[] = [];
    const marks: ("correct" | "hint")[] = [];
    challenge.promptSlots!.slice(0, 2).forEach((slot, i) => {
      const country = index.byId[slot.countryId]!;
      first.engine.dispatch({ type: "SUBMIT_GUESS", value: country.name, now: Date.now() });
      rounds.push({ categoryId: slot.categoryId, countryCode: country.code, points: i === 0 ? 7 : 10, hintsUsed: i === 0 ? 1 : 0, wrongGuesses: 0, missed: false });
      marks.push(i === 0 ? "hint" : "correct");
    });
    first.dailyChallenge!.onProgress!({ score: 17, hintsUsed: 1, marks, rounds, roundHintsUsed: 0, roundWrongGuesses: 0 });
    expect(readDailyProgress(window.localStorage, challenge.date, challenge.seed)?.rounds).toEqual(rounds);
    expect(readDailyProgress(window.localStorage, challenge.date, challenge.seed)?.themeScoped).toBe(true);
    app.navigate({ type: "landing" });
    app.navigate({ type: "daily-challenge" });
    await vi.waitFor(() => expect(root.querySelector("#daily-intro")).not.toBeNull());
    root.querySelector<HTMLButtonElement>('[data-action="start-daily"]')!.click();
    await vi.waitFor(() => expect(captured.solo).toHaveLength(2));
    const resumed = captured.solo[1]!;
    expect(resumed.engine.getState().currentCategoryId).toBe("capitals");
    expect(resumed.dailyChallenge!.initialProgress!.rounds).toEqual(rounds);
    for (const slot of challenge.promptSlots!.slice(2)) rounds.push({ categoryId: slot.categoryId, countryCode: index.byId[slot.countryId]!.code, points: 10, hintsUsed: 0, wrongGuesses: 0, missed: false });
    resumed.dailyChallenge!.onComplete({ score: 77, timeMs: 50_000, hintsUsed: 1, marks: ["hint", ...Array(7).fill("correct")], rounds });
    await vi.waitFor(() => expect(captured.map).toHaveLength(1));
    const pin = { target: (await import("../src/core/maptap/locations")).findMapTapLocation(challenge.mapTapTargetId)!, guess: { lat: 0, lng: 0 }, distanceKm: 1000, score: 2500, maxScore: 5000, decayKm: 1000, toleranceKm: 0 };
    captured.map[0]!.dailyChallenge!.onResult!(pin);
    expect(readDailyProgress(window.localStorage, challenge.date, challenge.seed)).toMatchObject({ stage: "street-view", roundIndex: 9, score: 82 });
    captured.map[0]!.dailyChallenge!.onComplete(pin);
    expect(captured.street).toHaveLength(1);
    captured.street[0]!.dailyChallenge!.onResult!({ missed: false, wrongGuesses: 1 });
    expect(readDailyProgress(window.localStorage, challenge.date, challenge.seed)).toMatchObject({ roundIndex: 10, score: 90 });
    // Refreshing after the answer was shown goes to results, without replaying the finale.
    app.navigate({ type: "landing" });
    app.navigate({ type: "daily-challenge" });
    await vi.waitFor(() => expect(root.querySelector("#daily-result")).not.toBeNull());
    expect(captured.street).toHaveLength(1);
    const result = readDailyResult(window.localStorage, challenge.date)!;
    expect(result.score).toBe(90);
    expect(result.rounds).toHaveLength(10);
    expect(result.rounds!.map((round) => round.points)).toEqual([7, 10, 10, 10, 10, 10, 10, 10, 5, 8]);
    expect(root.querySelectorAll(".daily-recap-row")).toHaveLength(10);
    expect(readDailyProgress(window.localStorage, challenge.date, challenge.seed)).toBeNull();
  });

  it("resumes an earlier mixed-theme attempt with its original assignments", async () => {
    const challenge = createMixedThemeDailyChallenge(index, getLocalDailyDate());
    const engine = createGameEngine({ countryIndex: index, categoryIds: challenge.categoryIds, seed: challenge.seed,
      promptSlots: challenge.promptSlots!, poolOrdering: "fixed" });
    const slot = challenge.promptSlots![0]!;
    const country = index.byId[slot.countryId]!;
    engine.dispatch({ type: "SUBMIT_GUESS", value: country.name, now: Date.now() });
    saveDailyProgress(window.localStorage, { version: 1, date: challenge.date, seed: challenge.seed,
      stage: "prompt", roundIndex: 1, score: 10, marks: ["correct"], hintsUsed: 0, elapsedMs: 1000,
      engine: createSoloSave(index, engine.getState(), Date.now()), roundHintsUsed: 0, roundWrongGuesses: 0,
      updatedAt: Date.now(), challengeVersion: 2,
      rounds: [{ categoryId: slot.categoryId, countryCode: country.code, points: 10, hintsUsed: 0, wrongGuesses: 0, missed: false }] });
    const { root, app } = setup();
    app.navigate({ type: "daily-challenge" });
    await vi.waitFor(() => expect(root.querySelector("#daily-intro")).not.toBeNull());
    expect(root.textContent).toContain("original questions and order");
    root.querySelector<HTMLButtonElement>('[data-action="start-daily"]')!.click();
    await vi.waitFor(() => expect(captured.solo).toHaveLength(1));
    expect(captured.solo[0]!.dailyChallenge!.promptSlots).toEqual(challenge.promptSlots);
    expect(captured.solo[0]!.engine.getState().currentCountryId).toBe(challenge.countryIds[1]);
    expect(readDailyProgress(window.localStorage, challenge.date, challenge.seed)?.themeScoped).toBeUndefined();
  });

  it("replays only losses across all modes without changing the daily result or other practice saves", async () => {
    const { root, app } = setup();
    const date = getLocalDailyDate();
    const challenge = createDailyChallenge(index, date);
    const rounds: DailyRoundResult[] = challenge.promptSlots!.map((slot) => ({ categoryId: slot.categoryId, countryCode: index.byId[slot.countryId]!.code, points: 10, hintsUsed: 0, wrongGuesses: 0, missed: false }));
    rounds[2] = { ...rounds[2]!, points: 0, missed: true };
    rounds.push({ categoryId: "map-tap", targetId: challenge.mapTapTargetId, points: 5, hintsUsed: 0, wrongGuesses: 0, missed: false, distanceKm: 1000 },
      { categoryId: "streetview-country", countryCode: challenge.streetViewCountryCode, points: scoreDailyRound(0, false, 1), hintsUsed: 0, wrongGuesses: 1, missed: false });
    const result = createDailyResultSave({ date, seed: challenge.seed, score: 83, timeMs: 100_000, hintsUsed: 0,
      marks: ["correct", "correct", "miss", "correct", "correct", "correct", "correct", "correct", "hint", "hint"], rounds, challengeVersion: 2 });
    saveDailyResult(window.localStorage, result);
    window.localStorage.setItem("locato:solo:v3:flags@countries", "existing practice");
    app.navigate({ type: "daily-practice", date });
    await vi.waitFor(() => expect(captured.solo).toHaveLength(1));
    const prompt = captured.solo[0]!;
    expect(prompt.engine.getState()).toMatchObject({ currentCountryId: challenge.countryIds[2], currentCategoryId: "capitals" });
    expect(prompt.dailyChallenge).toMatchObject({ practice: true, totalRounds: 3, roundOffset: 0 });
    prompt.dailyChallenge!.onComplete({ score: 10, hintsUsed: 0, timeMs: 1000, marks: ["correct"], rounds: [] });
    expect(captured.map[0]!.dailyChallenge!.target.id).toBe(challenge.mapTapTargetId);
    captured.map[0]!.dailyChallenge!.onComplete({ target: (await import("../src/core/maptap/locations")).findMapTapLocation(challenge.mapTapTargetId)!, guess: { lat: 0, lng: 0 }, distanceKm: 0, score: 5000, maxScore: 5000, decayKm: 1000, toleranceKm: 0 });
    expect(captured.street[0]!.dailyChallenge!.round.countryCode).toBe(challenge.streetViewCountryCode);
    captured.street[0]!.dailyChallenge!.onComplete({ missed: false, wrongGuesses: 0 });
    expect(root.querySelector("#daily-practice-result")).not.toBeNull();
    expect(readDailyResult(window.localStorage, date)).toEqual(result);
    expect(window.localStorage.getItem("locato:solo:v3:flags@countries")).toBe("existing practice");
  });
});
