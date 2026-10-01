// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlacementScreen, type PlacementScreenOptions } from "../src/ui/screens/PlacementScreen";
import { indexCountries, rawCountries } from "../src/core/countries";
import { emptyProgress, findGroup, type AcademyProgress } from "../src/core/academy";
import { createSeededRandom } from "../src/core/game/random";
import type { AcademyProgressStore } from "../src/app/academyProgress";

const countryIndex = indexCountries(rawCountries);
const NOW = Date.UTC(2026, 8, 26, 12);

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
  vi.useRealTimers();
});

function setup(overrides: Partial<PlacementScreenOptions> = {}) {
  const store = memoryStore();
  const onDone = vi.fn();
  const onStartLesson = vi.fn();
  const screen = createPlacementScreen({
    countryIndex,
    worldCountryFeatures: [],
    progressStore: store,
    onDone,
    onStartLesson,
    random: createSeededRandom("placement-test"),
    now: () => NOW,
    flashMs: { correct: 10, missed: 20 },
    ...overrides,
  });
  screens.push(screen);
  document.body.append(screen.element);
  return { root: screen.element, store, onDone, onStartLesson };
}

describe("Placement quiz", () => {
  it("can be skipped from the intro, marking placement done without seeding cards", () => {
    const ui = setup();
    expect(ui.root.dataset.phase).toBe("intro");
    expect(ui.root.textContent).toContain("20");
    ui.root.querySelector<HTMLButtonElement>(".lx-placement-skip")!.click();
    expect(ui.store.get().placementCompletedAt).toBe(NOW);
    expect(Object.keys(ui.store.get().cards)).toHaveLength(0);
    expect(ui.onDone).toHaveBeenCalledWith();
  });

  it("adapts through quick multiple-choice questions and saves the estimate", () => {
    vi.useFakeTimers();
    const ui = setup();
    ui.root.querySelector<HTMLButtonElement>(".lx-placement-start")!.click();
    expect(ui.root.dataset.phase).toBe("question");
    expect(ui.root.querySelectorAll(".lx-dot")).toHaveLength(20);

    let asked = 0;
    while (ui.root.dataset.phase === "question" && asked < 25) {
      const step = ui.root.querySelector<HTMLElement>(".lx-step")!;
      const code = step.dataset.code;
      const options = [...ui.root.querySelectorAll<HTMLButtonElement>(".lx-option")];
      expect(options.length).toBeGreaterThanOrEqual(3);
      // Miss every fifth question; answer the rest.
      const pick = asked % 5 === 4 ? options.find((b) => b.dataset.code !== code)! : options.find((b) => b.dataset.code === code)!;
      pick.click();
      pick.click(); // double taps are ignored
      expect(ui.root.querySelector(".lx-option.is-answer")).not.toBeNull();
      asked += 1;
      vi.advanceTimersByTime(25);
    }
    expect(asked).toBe(20);
    expect(ui.root.dataset.phase).toBe("result");
    expect(ui.root.querySelectorAll(".lx-dot.is-good")).toHaveLength(16);
    expect(ui.root.querySelectorAll(".lx-dot.is-warm")).toHaveLength(4);

    const progress = ui.store.get();
    expect(progress.placementCompletedAt).toBe(NOW);
    expect(Object.keys(progress.cards).length).toBeGreaterThan(0);
    expect(ui.root.querySelector(".lx-result-title")?.textContent).toBeTruthy();
    expect(ui.root.textContent).toContain("16/20");
    // Honest copy: untested countries are "likely familiar", never "countries you know".
    const stats = [...ui.root.querySelectorAll(".lx-stat")].map((stat) => stat.textContent ?? "");
    expect(stats.join(" ")).not.toMatch(/you know/i);
    const prefilled = stats.find((text) => text.includes("Likely familiar"));
    if (prefilled) expect(prefilled).toMatch(/^~\d+/);

    const start = ui.root.querySelector<HTMLButtonElement>(".lx-result-start");
    expect(start).not.toBeNull();
    const suggested = ui.onStartLesson.mock.calls.length;
    start!.click();
    expect(ui.onStartLesson).toHaveBeenCalledTimes(suggested + 1);
    const groupId = ui.onStartLesson.mock.calls.at(-1)![0] as string;
    expect(findGroup(groupId)).toBeDefined();
    ui.root.querySelector<HTMLButtonElement>(".lx-result-academy")!.click();
    expect(ui.onDone).toHaveBeenCalledWith(groupId);
  });

  it("treats 'Not sure' as a miss and moves on", () => {
    vi.useFakeTimers();
    const ui = setup();
    ui.root.querySelector<HTMLButtonElement>(".lx-placement-start")!.click();
    ui.root.querySelector<HTMLButtonElement>(".lx-skip")!.click();
    expect(ui.root.querySelector(".lx-option.is-answer")).not.toBeNull();
    vi.advanceTimersByTime(25);
    expect(ui.root.querySelectorAll(".lx-dot.is-warm")).toHaveLength(1);
    expect(ui.root.querySelector(".lx-dot.is-current")).not.toBeNull();
  });
});
