// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLessonScreen, type LessonScreenOptions } from "../src/ui/screens/LessonScreen";
import { indexCountries, rawCountries } from "../src/core/countries";
import { cardKey, emptyProgress, findGroup, getCard, type AcademyProgress, type CardProgress } from "../src/core/academy";
import { createSeededRandom } from "../src/core/game/random";
import type { AcademyProgressStore } from "../src/app/academyProgress";
import type { WorldCountryFeature } from "../src/core/map";

const countryIndex = indexCountries(rawCountries);

/** One small square per country, laid out on a grid, so every country has a clickable path. */
const features: WorldCountryFeature[] = rawCountries.map((country, index) => {
  const lng = -170 + (index % 30) * 11;
  const lat = -50 + Math.floor(index / 30) * 18;
  return {
    name: country.name,
    code: country.code,
    continent: country.continent,
    geometry: { type: "Polygon", coordinates: [[[lng, lat], [lng + 6, lat], [lng + 6, lat + 6], [lng, lat + 6], [lng, lat]]] },
  };
});

function memoryStore(initial: AcademyProgress = emptyProgress()): AcademyProgressStore {
  let progress = initial;
  return {
    get: () => progress,
    update: (change) => {
      progress = change(progress);
    },
    subscribe: () => () => undefined,
    syncWithAccount: async () => undefined,
    detachAccount: () => undefined,
  };
}

const screens: { destroy: () => void }[] = [];
afterEach(() => {
  for (const screen of screens.splice(0)) screen.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup(overrides: Partial<LessonScreenOptions> = {}) {
  const store = overrides.progressStore ?? memoryStore();
  const onExit = vi.fn();
  const onStartLesson = vi.fn();
  const onOpenCountry = vi.fn();
  const screen = createLessonScreen({
    countryIndex,
    worldCountryFeatures: features,
    progressStore: store,
    lessonId: "europe-big-names",
    onExit,
    onStartLesson,
    onOpenCountry,
    random: createSeededRandom("lesson-test"),
    now: () => Date.UTC(2026, 8, 26, 12),
    ...overrides,
  });
  screens.push(screen);
  document.body.append(screen.element);
  const root = screen.element;
  const info = () => {
    const step = root.querySelector<HTMLElement>(".lx-step");
    return {
      phase: root.dataset.phase,
      kind: step?.dataset.stepKind,
      code: step?.dataset.code ?? "",
      skill: step?.dataset.skill ?? "",
      retry: root.dataset.retry === "true",
    };
  };
  const answerTyped = (value: string) => {
    const input = root.querySelector<HTMLInputElement>(".lx-type-input")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>(".lx-check")!.click();
  };
  /** Answers the current step; returns false once the lesson is over. */
  const answer = (correct: boolean): boolean => {
    const { phase, kind, code, skill } = info();
    if (phase !== "step") return false;
    if (kind === "meet") {
      root.querySelector<HTMLButtonElement>(".lx-got-it")!.click();
      return true;
    }
    if (kind === "choice") {
      const options = [...root.querySelectorAll<HTMLButtonElement>(".lx-option")];
      (correct ? options.find((b) => b.dataset.code === code) : options.find((b) => b.dataset.code !== code))!.click();
    } else if (kind === "type") {
      const country = countryIndex.byCode.get(code)!;
      answerTyped(correct ? (skill === "capital" ? country.capital : country.name) : "Atlantis");
    } else if (kind === "place") {
      const target = correct ? code : countryIndex.countries.find((c) => c.code !== code)!.code;
      const click = () => root.querySelector(`.lx-map-svg path[data-code="${target}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      click();
      if (!correct) click(); // first miss only shows a hint
    }
    return true;
  };
  const cont = () => root.querySelector<HTMLButtonElement>(".lx-continue")!.click();
  return { root, store, onExit, onStartLesson, onOpenCountry, info, answer, answerTyped, cont };
}

describe("Lesson player", () => {
  it("plays a whole lesson: records every answer at once, re-asks a miss and ends on a summary", () => {
    const ui = setup();
    expect(ui.info()).toMatchObject({ phase: "step", kind: "meet" });
    expect(ui.root.querySelector(".lx-meet-name")?.textContent).toBeTruthy();

    // Meet steps first, then the first question.
    while (ui.info().kind === "meet") ui.answer(true);
    const missed = ui.info();
    expect(missed.kind).toBe("choice");

    ui.answer(false);
    expect(ui.info().phase).toBe("feedback");
    const tray = ui.root.querySelector<HTMLElement>(".lx-tray")!;
    expect(tray.hidden).toBe(false);
    expect(tray.dataset.tone).toBe("warm");
    expect(tray.querySelectorAll(".lx-compare-card")).toHaveLength(2);
    // Saved immediately, before Continue — leaving now keeps the answer.
    const card = getCard(ui.store.get(), missed.code, missed.skill as never);
    expect(card).toMatchObject({ box: 1, wrong: 1 });
    ui.cont();

    let sawRetry = false;
    let promoted = 0;
    let guard = 0;
    while (ui.info().phase === "step" && guard++ < 60) {
      const current = ui.info();
      if (current.retry && current.code === missed.code) sawRetry = true;
      if (current.kind === "type") {
        // A brand-new country graduates from choices to typing with letter-count slots.
        promoted += 1;
        expect(ui.root.querySelector(".lx-type")?.getAttribute("data-scaffold")).toBe("length");
        expect(ui.root.querySelectorAll(".lx-slot").length).toBeGreaterThan(2);
        expect(ui.root.querySelector(".lx-kicker-levelup")).not.toBeNull();
      }
      ui.answer(true);
      if (ui.info().phase === "feedback") {
        expect(ui.root.querySelector<HTMLElement>(".lx-tray")!.dataset.tone).toBe("good");
        ui.cont();
      }
    }
    expect(sawRetry).toBe(true);
    expect(promoted).toBeGreaterThan(0);
    expect(ui.info().phase).toBe("complete");
    const accuracy = ui.root.querySelector(".lx-stat-note")?.textContent ?? "";
    expect(accuracy).toMatch(/^(\d+) of (\d+) first tries$/);
    const [, correct, total] = accuracy.match(/^(\d+) of (\d+)/)!.map(Number);
    expect(total! - correct!).toBe(1);

    // Every first attempt reached spaced repetition; retries and promoted recall steps did not double-count.
    const cards = Object.values(ui.store.get().cards) as CardProgress[];
    expect(cards.reduce((sum, c) => sum + c.correct + c.wrong, 0)).toBe(total! - promoted);
    expect(getCard(ui.store.get(), missed.code, missed.skill as never).wrong).toBe(1);

    // Group completion moved, and the next-lesson button re-runs the unfinished group.
    expect(ui.root.querySelector(".lx-done-delta")?.textContent).toMatch(/0% → \d+%/);
    ui.root.querySelector<HTMLButtonElement>(".lx-done-next")!.click();
    expect(ui.onStartLesson).toHaveBeenCalledWith("europe-big-names");

    // The missed card can be practised straight away, as a fresh choice that counts for real.
    expect(ui.root.querySelector(".lx-done-review")?.textContent).toBe("Review mistakes (1)");
    ui.root.querySelector<HTMLButtonElement>(".lx-done-review")!.click();
    expect(ui.info()).toMatchObject({ phase: "step", kind: "choice", code: missed.code, skill: missed.skill, retry: false });
    expect(ui.root.querySelectorAll(".lx-option")).toHaveLength(3);
    ui.answer(true);
    expect(getCard(ui.store.get(), missed.code, missed.skill as never)).toMatchObject({ box: 2, correct: 1, wrong: 1 });
    ui.cont();
    if (missed.skill === "map") expect(ui.info()).toMatchObject({ kind: "place", code: missed.code });
    else expect(ui.info()).toMatchObject({ kind: "type", code: missed.code });
    ui.answer(true);
    ui.cont();
    expect(ui.info().phase).toBe("complete");
    expect(ui.root.querySelector(".lx-done-review")).toBeNull();
    expect(getCard(ui.store.get(), missed.code, missed.skill as never).box).toBe(2);

    ui.root.querySelector<HTMLButtonElement>(".lx-exit")!.click();
    expect(ui.onExit).toHaveBeenCalledWith("europe-big-names");
  });

  it("supports keyboard: number keys pick an option and Enter continues", () => {
    const ui = setup();
    while (ui.info().kind === "meet") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const { code } = ui.info();
    const options = [...ui.root.querySelectorAll<HTMLButtonElement>(".lx-option")].map((b) => b.dataset.code);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: String(options.indexOf(code) + 1), bubbles: true }));
    expect(ui.info().phase).toBe("feedback");
    expect(ui.root.querySelector(".lx-option.is-answer.is-picked")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(ui.info().phase).toBe("step");
  });

  it("accepts near-miss spelling in typed answers and shows the right spelling", () => {
    const group = findGroup("europe-big-names")!;
    const past = Date.UTC(2026, 8, 1);
    const cards: Record<string, CardProgress> = {};
    for (const code of group.countryCodes) {
      cards[cardKey(code, "flag")] = { box: 3, correct: 3, wrong: 0, lastSeenAt: past, dueAt: past };
    }
    const ui = setup({ progressStore: memoryStore({ ...emptyProgress(), cards }) });
    let guard = 0;
    while (ui.info().kind !== "type" && guard++ < 40) {
      ui.answer(true);
      if (ui.info().phase === "feedback") ui.cont();
    }
    const step = ui.info();
    expect(step).toMatchObject({ kind: "type", skill: "flag" });
    expect(ui.root.querySelector<HTMLInputElement>(".lx-type-input")!.placeholder).toMatch(/^\p{Lu}…$/u);
    const name = countryIndex.byCode.get(step.code)!.name;
    const typo = `${name.slice(0, -2)}x${name.slice(-1)}`; // one wrong letter: "Spain" → "Spaxn"
    ui.answerTyped(typo.toLowerCase());
    const tray = ui.root.querySelector<HTMLElement>(".lx-tray")!;
    expect(tray.dataset.tone).toBe("good");
    expect(tray.querySelector(".lx-tray-headline")?.textContent).toBe("Correct!");
    expect(tray.querySelector(".lx-tray-detail")?.textContent).toContain(`spelled “${name}”`);
    expect(getCard(ui.store.get(), step.code, "flag").box).toBe(4);
  });

  it("gives place steps one hint before counting a miss", () => {
    const group = findGroup("europe-big-names")!;
    const past = Date.UTC(2026, 8, 1);
    const cards: Record<string, CardProgress> = {};
    for (const code of group.countryCodes) cards[cardKey(code, "map")] = { box: 2, correct: 2, wrong: 0, lastSeenAt: past, dueAt: past };
    const ui = setup({ progressStore: memoryStore({ ...emptyProgress(), cards }) });
    let guard = 0;
    while (ui.info().kind !== "place" && guard++ < 40) {
      ui.answer(true);
      if (ui.info().phase === "feedback") ui.cont();
    }
    const { code } = ui.info();
    const other = group.countryCodes.find((c) => c !== code)!;
    const click = (c: string) => ui.root.querySelector(`.lx-map-svg path[data-code="${c}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    click(other);
    expect(ui.info().phase).toBe("step");
    expect(ui.root.querySelector(".lx-map-hint")).not.toBeNull();
    expect(ui.root.querySelector(".lx-map-label")?.textContent).toContain("That's");
    click(code);
    expect(ui.info().phase).toBe("feedback");
    expect(ui.root.querySelector<HTMLElement>(".lx-tray")!.dataset.tone).toBe("good");
  });

  it("shows a friendly not-found state for unknown lessons", () => {
    const ui = setup({ lessonId: "atlantis" });
    expect(ui.root.dataset.phase).toBe("not-found");
    expect(ui.root.textContent).toContain("couldn't find that lesson");
    ui.root.querySelector<HTMLButtonElement>(".lx-message .lx-btn")!.click();
    expect(ui.onExit).toHaveBeenCalledWith();
  });

  it("shows an all-caught-up state when nothing is due for review", () => {
    const ui = setup({ lessonId: "review" });
    expect(ui.root.dataset.phase).toBe("empty");
    expect(ui.root.textContent).toContain("All caught up");
    ui.root.querySelector<HTMLButtonElement>(".lx-message .lx-btn-primary")!.click();
    expect(ui.onStartLesson).toHaveBeenCalledWith("europe-big-names");
  });

  it("drills lookalikes for a country", () => {
    const ui = setup({ lessonId: "lookalikes:TD" });
    expect(ui.info()).toMatchObject({ phase: "step", kind: "choice" });
    expect(["TD", "RO"]).toContain(ui.info().code);
    ui.answer(false);
    expect(ui.root.querySelector(".lx-tip")?.textContent).toContain("Chad");
    ui.root.querySelector<HTMLButtonElement>(".lx-exit")!.click();
    expect(ui.onExit).toHaveBeenCalledTimes(1);
  });
});
