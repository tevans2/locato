// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMapTapScreen, MAP_TAP_BEST_RUN_KEY, MAP_TAP_RUN_LENGTH } from "../src/ui/screens/MapTapScreen";
import type { MapTapGlobeOptions } from "../src/ui/components/MapTapGlobe";
import { MAP_TAP_CATEGORY_OPTIONS, type MapTapCategory, type MapTapGuessResult, type MapTapLocation } from "../src/core/maptap";
import type { ShellContext } from "../src/ui/shell/types";

const screens: ReturnType<typeof createMapTapScreen>[] = [];
afterEach(() => { for (const screen of screens.splice(0)) screen.destroy(); document.body.replaceChildren(); localStorage.clear(); });

function stubShell(overrides: Partial<ShellContext> = {}): ShellContext {
  return { openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openCompete() {}, openAccount() {}, controls: document.createElement("div"), confirmLeave: async () => true, signedIn: () => false, storage: localStorage, ...overrides };
}

const target = (i: number): MapTapLocation => ({ id: `t${i}`, name: `Target ${i}`, category: "city", lat: i, lng: i, difficulty: "easy", wikiSlug: `T${i}` });

function setup(options: { daily?: boolean; shell?: Partial<ShellContext>; start?: boolean } = {}) {
  let guess: (point: { lat: number; lng: number }) => void = () => {};
  let round = 0;
  const globe = { element: document.createElement("div"), reset: vi.fn(), reveal: vi.fn(), setAcceptingGuesses: vi.fn() };
  const validateGuess = vi.fn(async ({ targetId }: { targetId: string }): Promise<MapTapGuessResult> => {
    const index = Number(targetId.slice(1));
    return { target: target(index), guess: { lat: 0, lng: 0 }, distanceKm: 100 * (index + 1), score: 1000 + index * 100, maxScore: 5000, decayKm: 1000, toleranceKm: 25 };
  });
  const onComplete = vi.fn();
  const fetchRound = vi.fn(async (filters: { category?: MapTapCategory | ""; difficulty?: string } = {}) => {
    const t = target(round++);
    return { id: t.id, name: t.name, category: filters.category || t.category, difficulty: t.difficulty };
  });
  const screen = createMapTapScreen({
    shell: stubShell(options.shell),
    storage: localStorage,
    onGameModeChange() {},
    onHome: vi.fn(),
    ...(options.daily ? { dailyChallenge: { date: "2026-09-27", target: target(3), onComplete, progress: { round: 9, total: 10 } } } : {}),
  }, {
    createGlobe: (o: MapTapGlobeOptions) => { guess = o.onGuess; return globe; },
    createInfoOverlay: () => ({ element: document.createElement("div"), show: vi.fn(), hide: vi.fn() }),
    fetchRound,
    validateGuess,
    fetchSummary: vi.fn(async () => null),
  });
  screens.push(screen);
  document.body.append(screen.element);
  const $ = <T extends Element = HTMLElement>(selector: string) => screen.element.querySelector<T>(selector);
  const $$ = (selector: string) => screen.element.querySelectorAll(selector);
  const ready = () => vi.waitFor(() => expect($(".maptap-status")?.textContent).not.toContain("Loading"));
  const start = () => $<HTMLButtonElement>(".maptap-start-action")!.click();
  // Practice opens on the category setup; most tests just want a run going.
  if (!options.daily && options.start !== false) start();
  return { screen, globe, validateGuess, fetchRound, onComplete, $, $$, ready, start, pin: async () => { guess({ lat: 1, lng: 1 }); await vi.waitFor(() => expect($(".maptap-result-panel")?.hidden).toBe(false)); } };
}

describe("MapTap practice run", () => {
  it("renders in the GameBar layout as a practice run", async () => {
    const ui = setup();
    await ui.ready();
    expect(ui.screen.element.dataset.shell).toBe("game");
    expect(ui.$(".shell-gamebar .shell-switcher-name")?.textContent).toBe("MapTap");
    expect(ui.$(".shell-run-pill")?.dataset.run).toBe("practice");
    expect(ui.$(".maptap-run-label")?.textContent).toBe("Target 1 of 10");
  });

  it("disables Reset once the answer is revealed, so a target can't be re-pinned", async () => {
    const ui = setup();
    await ui.ready();
    expect(ui.$<HTMLButtonElement>(".maptap-reset")?.disabled).toBe(false);
    await ui.pin();
    expect(ui.$<HTMLButtonElement>(".maptap-reset")?.disabled).toBe(true);
    ui.$<HTMLButtonElement>(".maptap-reset")!.click();
    expect(ui.$(".maptap-result-panel")?.hidden).toBe(false);
    expect(ui.globe.setAcceptingGuesses).toHaveBeenLastCalledWith(false);
  });

  it("ends after 10 targets on a results screen with the total, targets and a local best", async () => {
    const ui = setup();
    for (let i = 0; i < MAP_TAP_RUN_LENGTH; i++) {
      await ui.ready();
      await ui.pin();
      expect(ui.$(".maptap-run-total")?.textContent).toBe((Array.from({ length: i + 1 }, (_, k) => 1000 + k * 100).reduce((a, b) => a + b, 0)).toLocaleString("en-US"));
      const next = ui.$<HTMLButtonElement>(".maptap-result-panel .primary-action")!;
      expect(next.textContent).toBe(i === MAP_TAP_RUN_LENGTH - 1 ? "See results" : "Next target");
      next.click();
    }
    expect(ui.validateGuess).toHaveBeenCalledTimes(MAP_TAP_RUN_LENGTH);
    const stage = ui.$(".gb-results-stage")!;
    expect(stage.hidden).toBe(false);
    expect(ui.$(".maptap-layout")?.hidden).toBe(true);
    expect(stage.querySelector(".shell-results-stat.is-hero strong")?.textContent).toBe("14,500");
    expect(stage.querySelectorAll(".gb-run-row")).toHaveLength(10);
    expect(stage.textContent).toContain("Average distance");
    expect(stage.textContent).toContain("Best round");
    expect(localStorage.getItem(MAP_TAP_BEST_RUN_KEY)).toBe("14500");

    stage.querySelector<HTMLButtonElement>(".shell-results-primary")!.click();
    expect(stage.hidden).toBe(true);
    await ui.ready();
    expect(ui.$(".maptap-run-label")?.textContent).toBe("Target 1 of 10");
    expect(ui.$(".maptap-run-total")?.textContent).toBe("0");
  });

  it("asks before leaving part-way through a run", async () => {
    const confirmLeave = vi.fn(async (_message: string) => false);
    const goBack = vi.fn();
    const ui = setup({ shell: { confirmLeave, goBack } });
    await ui.ready();
    ui.$<HTMLButtonElement>(".shell-gamebar-back")!.click();
    await Promise.resolve();
    expect(confirmLeave).not.toHaveBeenCalled();
    expect(goBack).toHaveBeenCalledWith("play");
    await ui.pin();
    ui.$<HTMLButtonElement>(".shell-gamebar-back")!.click();
    await vi.waitFor(() => expect(confirmLeave).toHaveBeenCalledOnce());
    expect(String(confirmLeave.mock.calls[0]?.[0])).toContain("1 of 10 targets");
    expect(goBack).toHaveBeenCalledOnce();
  });

  it("uses the focus layout with whole-daily progress inside the daily challenge", async () => {
    const ui = setup({ daily: true });
    await ui.ready();
    expect(ui.screen.element.dataset.shell).toBe("focus");
    expect(ui.$(".shell-gamebar")).toBeNull();
    expect(ui.$(".shell-focusbar .gb-daily-count")?.textContent).toBe("Round 9 of 10");
    expect(ui.$(".shell-focusbar [role=progressbar]")?.getAttribute("aria-valuenow")).toBe("80");
    await ui.pin();
    const next = ui.$<HTMLButtonElement>(".maptap-result-panel .primary-action")!;
    expect(next.textContent).toBe("Continue daily challenge");
    next.click();
    expect(ui.onComplete).toHaveBeenCalledOnce();
  });
});

describe("MapTap category setup", () => {
  const check = (ui: ReturnType<typeof setup>, category: MapTapCategory, checked: boolean) => {
    const input = ui.$<HTMLInputElement>(`.maptap-category-option input[value="${category}"]`)!;
    input.checked = checked;
    input.dispatchEvent(new Event("change"));
  };

  it("opens on the setup panel and only starts a run from it", async () => {
    const ui = setup({ start: false });
    expect(ui.$(".maptap-setup")?.hidden).toBe(false);
    expect(ui.$(".maptap-play-panel")?.hidden).toBe(true);
    expect(ui.$$(".maptap-category-option")).toHaveLength(MAP_TAP_CATEGORY_OPTIONS.length);
    expect(ui.fetchRound).not.toHaveBeenCalled();

    ui.$<HTMLButtonElement>(".maptap-toggle-all")!.click();
    expect(ui.$(".maptap-selection-summary")?.textContent).toBe("Choose at least one category to start.");
    expect(ui.$<HTMLButtonElement>(".maptap-start-action")?.disabled).toBe(true);
    expect(ui.$(".maptap-toggle-all")?.textContent).toBe("Select all");
  });

  it("starts a 10-target run that only draws from the selected categories", async () => {
    const ui = setup({ start: false });
    ui.$<HTMLButtonElement>(".maptap-toggle-all")!.click();
    check(ui, "ocean", true);
    check(ui, "mountain-range", true);
    expect(ui.$(".maptap-selection-summary")?.textContent).toMatch(/locations across 2 categories$/);
    ui.start();
    expect(ui.$(".maptap-setup")?.hidden).toBe(true);
    expect(ui.$(".maptap-play-panel")?.hidden).toBe(false);
    expect(ui.$(".maptap-active-categories")?.textContent).toBe("Mountain ranges, Oceans & seas");

    for (let i = 0; i < MAP_TAP_RUN_LENGTH; i++) {
      await ui.ready();
      expect(ui.$(".maptap-prompt-meta")?.textContent).toMatch(/^(Ocean or sea|Mountain range) · /);
      await ui.pin();
      ui.$<HTMLButtonElement>(".maptap-result-panel .primary-action")!.click();
    }
    const categories = new Set(ui.fetchRound.mock.calls.map(([filters]) => filters?.category));
    expect([...categories].sort()).toEqual(["mountain-range", "ocean"]);

    // Play again keeps the same selection; the results card also offers changing it.
    const stage = ui.$(".gb-results-stage")!;
    expect(stage.hidden).toBe(false);
    expect(stage.textContent).toContain("Change categories");
    ui.fetchRound.mockClear();
    stage.querySelector<HTMLButtonElement>(".shell-results-primary")!.click();
    await ui.ready();
    expect(ui.$(".maptap-setup")?.hidden).toBe(true);
    expect(ui.$(".maptap-run-label")?.textContent).toBe("Target 1 of 10");
    expect(["mountain-range", "ocean"]).toContain(ui.fetchRound.mock.calls[0]?.[0]?.category);
  });

  it("confirms before Change categories discards a run in progress", async () => {
    const confirmLeave = vi.fn(async (_message: string) => false);
    const ui = setup({ shell: { confirmLeave } });
    await ui.ready();
    // Nothing scored yet: straight back to setup, no prompt.
    ui.$<HTMLButtonElement>(".maptap-change-categories")!.click();
    await vi.waitFor(() => expect(ui.$(".maptap-setup")?.hidden).toBe(false));
    expect(confirmLeave).not.toHaveBeenCalled();

    ui.start();
    await ui.ready();
    await ui.pin();
    ui.$<HTMLButtonElement>(".maptap-result-panel .primary-action")!.click();
    await ui.ready();
    ui.$<HTMLButtonElement>(".maptap-change-categories")!.click();
    await vi.waitFor(() => expect(confirmLeave).toHaveBeenCalledOnce());
    expect(String(confirmLeave.mock.calls[0]?.[0])).toContain("1 of 10 targets");
    expect(String(confirmLeave.mock.calls[0]?.[0])).toContain("discards");
    // Declined: the run carries on.
    expect(ui.$(".maptap-play-panel")?.hidden).toBe(false);
    expect(ui.$(".maptap-run-label")?.textContent).toBe("Target 2 of 10");

    confirmLeave.mockResolvedValueOnce(true);
    ui.$<HTMLButtonElement>(".maptap-change-categories")!.click();
    await vi.waitFor(() => expect(ui.$(".maptap-setup")?.hidden).toBe(false));
    ui.start();
    await ui.ready();
    expect(ui.$(".maptap-run-label")?.textContent).toBe("Target 1 of 10");
    expect(ui.$(".maptap-run-total")?.textContent).toBe("0");
  });

  it("skips setup in the daily challenge", async () => {
    const ui = setup({ daily: true });
    await ui.ready();
    expect(ui.$(".maptap-setup")?.hidden).toBe(true);
    expect(ui.$(".maptap-play-panel")?.hidden).toBe(false);
    expect(ui.$(".maptap-current-selection")?.hidden).toBe(true);
    expect(ui.fetchRound).not.toHaveBeenCalled();
  });
});
