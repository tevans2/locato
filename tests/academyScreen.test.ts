// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AcademyProgressStore } from "../src/app/academyProgress";
import { ACADEMY_SKILLS, emptyProgress, type AcademyProgress, type CardKey, type CardProgress } from "../src/core/academy";
import { indexCountries, rawCountries } from "../src/core/countries";
import type { WorldCountryFeature } from "../src/core/map";
import { createAcademyScreen, type AcademyScreenOptions } from "../src/ui/screens/AcademyScreen";

const NOW = Date.UTC(2026, 8, 26, 12);
const DAY = 86_400_000;
const countryIndex = indexCountries(rawCountries);
const MAP_CODES = new Set(["FR", "DE", "GB", "CN", "JP", "BR", "MC", "IE"]);
const features = (JSON.parse(readFileSync(resolve(process.cwd(), "public/assets/world-map.json"), "utf8")) as WorldCountryFeature[]).filter((feature) =>
  MAP_CODES.has(feature.code.toUpperCase()),
);

function withCards(codes: readonly string[], box: CardProgress["box"], dueAt: number, base: AcademyProgress = emptyProgress()): AcademyProgress {
  const cards: Record<CardKey, CardProgress> = { ...base.cards };
  for (const code of codes) for (const skill of ACADEMY_SKILLS) cards[`${code}:${skill}`] = { box, correct: box, wrong: 0, lastSeenAt: NOW - DAY, dueAt };
  return { ...base, cards, placementCompletedAt: NOW - 3 * DAY, updatedAt: NOW };
}

function fakeStore(initial: AcademyProgress): AcademyProgressStore & { readonly listenerCount: () => number } {
  let progress = initial;
  const listeners = new Set<(progress: AcademyProgress) => void>();
  return {
    get: () => progress,
    update: (change) => {
      progress = change(progress);
      for (const listener of listeners) listener(progress);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncWithAccount: async () => undefined,
    detachAccount: () => undefined,
    listenerCount: () => listeners.size,
  };
}

const screens: { destroy: () => void }[] = [];
afterEach(() => {
  for (const screen of screens.splice(0)) screen.destroy();
  document.body.replaceChildren();
});

function setup(progress: AcademyProgress, overrides: Partial<AcademyScreenOptions> = {}) {
  const store = fakeStore(progress);
  const handlers = {
    onHome: vi.fn(),
    onBack: vi.fn(),
    onStartLesson: vi.fn(),
    onStartPlacement: vi.fn(),
    onOpenCountry: vi.fn(),
    onGroupChange: vi.fn(),
  };
  const screen = createAcademyScreen({ countryIndex, worldCountryFeatures: features, progressStore: store, now: () => NOW, ...handlers, ...overrides });
  screens.push(screen);
  document.body.append(screen.element);
  const root = screen.element;
  const q = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T & HTMLElement>(selector);
  const click = (selector: string) => {
    const target = q(selector);
    if (!target) throw new Error(`Missing ${selector}`);
    target.click();
  };
  return { screen, store, root, q, click, ...handlers };
}

describe("Academy hub", () => {
  it("welcomes first-time players with placement or a fresh start", () => {
    const ui = setup(emptyProgress());
    expect(ui.q(".academy-welcome")).not.toBeNull();
    expect(ui.q(".academy-continue")).toBeNull();
    expect(ui.q(".academy-review-button")).toBeNull();
    expect(ui.q(".academy-rank-title")?.textContent).toBe("Tourist");

    ui.click(".academy-find-level");
    expect(ui.onStartPlacement).toHaveBeenCalledTimes(1);

    ui.click(".academy-from-scratch");
    expect(ui.store.get().placementCompletedAt).toBe(NOW);
    expect(ui.onStartLesson).toHaveBeenCalledWith("europe-big-names");
  });

  it("shows returning players their rank, streak, next stop and due reviews", () => {
    const today = new Date(NOW);
    const dayKey = (offset: number) => {
      const date = new Date(today.getTime() - offset * DAY);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    let progress = withCards(["GB", "FR", "DE", "IT", "ES", "PT", "GR"], 5, NOW + 10 * DAY);
    progress = withCards(["US", "CA"], 2, NOW - 1000, progress);
    progress = { ...progress, activity: { [dayKey(0)]: 12, [dayKey(1)]: 8, [dayKey(2)]: 4 } };
    const ui = setup(progress);

    expect(ui.q(".academy-welcome")).toBeNull();
    expect(ui.q(".academy-rank-title")?.textContent).toBe("Backpacker");
    expect(ui.root.querySelector(".academy-stat dd")?.textContent).toBe("3");
    expect(ui.q(".academy-review-count")?.textContent).toBe("8");
    ui.click(".academy-review-button");
    expect(ui.onStartLesson).toHaveBeenLastCalledWith("review");

    expect(ui.q("#academy-continue-title")?.textContent).toBe("North America's headliners");
    ui.click(".academy-continue-start");
    expect(ui.onStartLesson).toHaveBeenLastCalledWith("north-america-headliners");

    const cleared = ui.q('.academy-group-card[data-group-id="europe-big-names"]');
    expect(cleared?.classList.contains("is-complete")).toBe(true);
    expect(cleared?.querySelector(".academy-stamp")).not.toBeNull();
    expect(ui.q('.academy-group-card[data-group-id="north-america-headliners"]')?.classList.contains("is-next")).toBe(true);
  });

  it("hides the review button when nothing is due and reveals it live when cards fall due", () => {
    const ui = setup(withCards(["FR"], 3, NOW + DAY));
    expect(ui.q(".academy-review-button")).toBeNull();
    ui.store.update((progress) => withCards(["JP"], 2, NOW - 1, progress));
    expect(ui.q(".academy-review-count")?.textContent).toBe("4");
  });

  it("opens and closes a group panel, keeping the URL in sync", () => {
    const ui = setup(withCards(["IE"], 2, NOW + DAY));
    ui.click('.academy-group-open[data-group-id="northern-lights"]');
    expect(ui.onGroupChange).toHaveBeenLastCalledWith("northern-lights");
    expect(ui.q(".academy-panel-title")?.textContent).toBe("Northern lights");
    expect(ui.root.querySelectorAll(".academy-country-row")).toHaveLength(6);
    expect(ui.q('.academy-group-card[data-group-id="northern-lights"]')?.classList.contains("is-open")).toBe(true);
    expect(ui.q<SVGPathElement>(".academy-map .world-map-country.is-in-group")).not.toBeNull();

    ui.click('.academy-country-row[data-country="IS"]');
    expect(ui.onOpenCountry).toHaveBeenCalledWith("IS");

    ui.click(".academy-panel-start");
    expect(ui.onStartLesson).toHaveBeenLastCalledWith("northern-lights");
    ui.click(".academy-panel-lookalikes");
    expect(ui.onStartLesson.mock.lastCall?.[0]).toMatch(/^lookalikes:(IE|IS|DK|NO|SE|FI)$/);

    ui.click(".academy-panel-close");
    expect(ui.onGroupChange).toHaveBeenLastCalledWith(null);
    expect(ui.q(".academy-panel")).toBeNull();
    expect(ui.q(".academy-map.has-group")).toBeNull();

    ui.click('.academy-group-open[data-group-id="east-asia"]');
    ui.q(".academy-panel-title")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(ui.q(".academy-panel")).toBeNull();
    expect(ui.onGroupChange).toHaveBeenLastCalledWith(null);
  });

  it("opens the initial group from the URL without rewriting it, and clears unknown ids", () => {
    const ui = setup(emptyProgress(), { initialGroupId: "the-stans" });
    expect(ui.q(".academy-panel-title")?.textContent).toBe("The Stans");
    expect(ui.onGroupChange).not.toHaveBeenCalled();

    const bad = setup(emptyProgress(), { initialGroupId: "atlantis" });
    expect(bad.q(".academy-panel")).toBeNull();
    expect(bad.onGroupChange).toHaveBeenCalledWith(null);
  });

  it("opens a country's group when it is clicked on the map", () => {
    const ui = setup(withCards(["FR"], 3, NOW + DAY));
    const france = countryIndex.byCode.get("FR")!;
    const path = ui.q<SVGPathElement>(`.world-map-country[data-country-id="${france.id}"]`);
    expect(path?.dataset.mastery).toBe("familiar");
    path?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ui.onGroupChange).toHaveBeenLastCalledWith("europe-big-names");
    expect(ui.q(".academy-country-list li.is-picked .academy-country-row")?.dataset.country).toBe("FR");
  });

  it("filters the trail by continent", () => {
    const ui = setup(emptyProgress());
    expect(ui.root.querySelectorAll(".academy-leg").length).toBe(6);
    const africa = [...ui.root.querySelectorAll<HTMLButtonElement>(".academy-chip")].find((chip) => chip.textContent?.startsWith("Africa"))!;
    africa.click();
    expect(africa.getAttribute("aria-pressed")).toBe("true");
    expect([...ui.root.querySelectorAll(".academy-leg-head h3")].map((heading) => heading.textContent)).toEqual(["Africa"]);
  });

  it("stops listening to progress after destroy", () => {
    const ui = setup(emptyProgress());
    expect(ui.store.listenerCount()).toBe(1);
    ui.screen.destroy();
    screens.splice(screens.indexOf(ui.screen), 1);
    expect(ui.store.listenerCount()).toBe(0);
  });
});
