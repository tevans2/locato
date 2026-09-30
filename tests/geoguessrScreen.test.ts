// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeoGuessrScreen, type GeoGuessrScreenServices } from "../src/ui/screens/GeoGuessrScreen";
import { indexCountries, rawCountries } from "../src/core/countries";
import type { GeoGuessMapOptions } from "../src/ui/components/GeoGuessMap";
import type { LngLatPoint } from "../src/core/maptap/distance";
import type { ShellContext } from "../src/ui/shell/types";
import { GEOGUESSR_ROUND_LIMIT } from "../src/core/geoguessr";
import { GEOGUESSR_ATTEMPT_ROUNDS } from "../src/core/leaderboards";
import { RANKED_LEAVE_MESSAGE, type PostRankedAttempt } from "../src/ui/screens/rankedAttempt";

const locations = ["IT", "JP", "ZA", "BR", "CA"].map((countryCode, i) => ({ countryCode, lat: i, lng: i, heading: 0, label: "Round" }));
const screens: ReturnType<typeof createGeoGuessrScreen>[] = [];
function stubShell(): ShellContext {
  return { openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openCompete() {}, openAccount() {}, controls: document.createElement("div"), confirmLeave: async () => true, signedIn: () => false };
}
afterEach(() => { for (const screen of screens.splice(0)) screen.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });
async function setup(overrides: Partial<GeoGuessrScreenServices> = {}) {
  let choose: (point: LngLatPoint) => void = () => {};
  const map = { element: document.createElement("div"), reset: vi.fn(), reveal: vi.fn(), setAcceptingGuesses: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
  const panorama = { element: document.createElement("div"), show: vi.fn(async (p: LngLatPoint) => p), reset: vi.fn(), destroy: vi.fn() };
  const screen = createGeoGuessrScreen({ countryIndex: indexCountries(rawCountries), onHome: vi.fn(), onGameModeChange: vi.fn(), onDailyChallenge: vi.fn(), onMultiplayer: vi.fn() }, {
    createMap: (options: GeoGuessMapOptions) => { choose = options.onGuessChange; return map; }, createPanorama: () => panorama, loadLocations: async () => locations, ...overrides,
  });
  screens.push(screen); document.body.append(screen.element);
  await vi.waitFor(() => expect(screen.element.dataset.phase).not.toBe("loading"));
  const click = (selector: string) => { const button = screen.element.querySelector<HTMLButtonElement>(selector); if (!button) throw new Error(`Missing ${selector}`); button.click(); };
  return { screen, map, panorama, choose: (p: LngLatPoint) => choose(p), click };
}

describe("GeoGuessr play surface", () => {
  it("requires a pin, scores once, and returns to a clean next round", async () => {
    const ui = await setup();
    expect(ui.screen.element.querySelector<HTMLButtonElement>(".geo-lock")?.disabled).toBe(true);
    ui.choose({ lat: 0, lng: 0 }); ui.click(".geo-lock"); ui.click(".geo-lock");
    expect(ui.screen.element.dataset.phase).toBe("result");
    expect(ui.screen.element.querySelector(".geo-total-score")?.textContent).toBe("5,000");
    expect(ui.map.reveal).toHaveBeenCalledTimes(1);
    ui.click(".geo-result-card .geo-primary");
    await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("playing"));
    expect(ui.screen.element.querySelector(".geo-round-number")?.textContent).toBe("02");
    expect(ui.screen.element.querySelector<HTMLButtonElement>(".geo-lock")?.disabled).toBe(true);
  });
  it("shows a five-round recap and can review earlier pins before restarting", async () => {
    const ui = await setup();
    for (const p of locations) {
      ui.choose(p); ui.click(".geo-lock"); ui.click(".geo-result-card .geo-primary");
      await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe(p === locations.at(-1) ? "complete" : "playing"));
    }
    expect(ui.screen.element.querySelector(".geo-result-card .shell-results-stat.is-hero strong")?.textContent).toBe("25,000");
    // Visited countries link to the Atlas.
    expect([...ui.screen.element.querySelectorAll(".shell-results-missed [data-country]")].map((chip) => chip.getAttribute("data-country"))).toEqual(["IT", "JP", "ZA", "BR", "CA"]);
    expect(ui.screen.element.querySelectorAll(".geo-recap-row")).toHaveLength(5);
    ui.click(".geo-recap-row");
    expect(ui.map.reveal).toHaveBeenLastCalledWith(locations[0], [{ lat: 0, lng: 0, label: "Your pin", color: "#d8ec99" }]);
    ui.click(".geo-result-card .shell-results-primary");
    await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("playing"));
    expect(ui.screen.element.querySelector(".geo-total-score")?.textContent).toBe("0");
    expect(ui.screen.element.querySelector(".geo-round-number")?.textContent).toBe("01");
  });
  it("scores against the actual snapped start, not the requested coordinates", async () => {
    const show = vi.fn(async () => ({ lat: 10, lng: 20 }));
    const ui = await setup({ createPanorama: () => ({ element: document.createElement("div"), show, reset() {}, destroy() {} }) });
    ui.choose({ lat: 10, lng: 20 }); ui.click(".geo-lock");
    expect(ui.screen.element.querySelector(".geo-total-score")?.textContent).toBe("5,000");
  });
  it("recovers from a panorama error without skipping or scoring the round", async () => {
    const show = vi.fn().mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue({ lat: 0, lng: 0 });
    const ui = await setup({ createPanorama: () => ({ element: document.createElement("div"), show, reset() {}, destroy() {} }) });
    expect(ui.screen.element.dataset.phase).toBe("error");
    ui.click(".geo-loading-actions .geo-primary");
    await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("playing"));
    expect(ui.screen.element.querySelector(".geo-round-number")?.textContent).toBe("01");
    expect(ui.screen.element.querySelector(".geo-total-score")?.textContent).toBe("0");
  });
  it("supports map shortcuts without stealing text input", async () => {
    const ui = await setup();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "m" }));
    expect(ui.screen.element.dataset.mapSize).toBe("collapsed");
    const input = document.createElement("input"); ui.screen.element.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    expect(ui.screen.element.dataset.mapSize).toBe("collapsed");
    ui.click(".geo-open-map"); expect(ui.screen.element.dataset.mapSize).not.toBe("collapsed");
    ui.click(".geo-reset"); expect(ui.panorama.reset).toHaveBeenCalledOnce();
  });
  it("renders inside the GameBar layout and explains when Street View isn't configured", async () => {
    const shell = { openGame: vi.fn(), openGamePicker: vi.fn(), goBack: vi.fn() };
    const screen = createGeoGuessrScreen({ shell: { ...stubShell(), ...shell }, countryIndex: indexCountries(rawCountries), onHome() {}, onGameModeChange() {}, onDailyChallenge() {}, onMultiplayer() {} }, { isConfigured: () => false, createMap: () => ({ element: document.createElement("div"), reset() {}, reveal() {}, resize() {}, destroy() {}, setAcceptingGuesses() {} }) });
    screens.push(screen);
    expect(screen.element.dataset.shell).toBe("game");
    expect(screen.element.querySelector(".shell-gamebar .shell-switcher-name")?.textContent).toBe("GeoGuessr");
    expect(screen.element.dataset.phase).toBe("unconfigured");
    screen.element.querySelector<HTMLButtonElement>(".geo-alt-games .geo-primary")!.click();
    expect(shell.openGame).toHaveBeenCalledWith("map-tap");
  });
  it("does not restore an asynchronously loaded screen after navigation away", async () => {
    let finish!: (p: LngLatPoint) => void;
    const show = () => new Promise<LngLatPoint>(resolve => { finish = resolve; });
    const screen = createGeoGuessrScreen({ countryIndex: indexCountries(rawCountries), onHome() {}, onGameModeChange() {}, onDailyChallenge() {}, onMultiplayer() {} }, {
      createMap: () => ({ element: document.createElement("div"), reset() {}, reveal() {}, resize() {}, destroy() {}, setAcceptingGuesses() {} }),
      createPanorama: () => ({ element: document.createElement("div"), show, reset() {}, destroy() {} }), loadLocations: async () => locations,
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    screen.destroy(); finish({ lat: 0, lng: 0 }); await Promise.resolve();
    expect(screen.element.dataset.phase).toBe("loading");
  });
});

describe("GeoGuessr ranked attempt", () => {
  async function ranked(shellOverrides: Partial<ShellContext> = {}, postAttempt = vi.fn<PostRankedAttempt>(async () => ({ serverAccepted: null, rank: 9 }))) {
    let choose: (point: LngLatPoint) => void = () => {};
    const map = { element: document.createElement("div"), reset: vi.fn(), reveal: vi.fn(), setAcceptingGuesses: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
    const panorama = { element: document.createElement("div"), show: vi.fn(async (p: LngLatPoint) => p), reset: vi.fn(), destroy: vi.fn() };
    const shell = { ...stubShell(), openCompete: vi.fn(), openGame: vi.fn(), confirmLeave: vi.fn(async () => false), ...shellOverrides };
    const screen = createGeoGuessrScreen({ shell, run: "timed", countryIndex: indexCountries(rawCountries), onHome() {}, onGameModeChange() {}, onDailyChallenge() {}, onMultiplayer() {} }, {
      createMap: (options: GeoGuessMapOptions) => { choose = options.onGuessChange; return map; }, createPanorama: () => panorama, loadLocations: async () => locations, postAttempt,
    });
    screens.push(screen); document.body.append(screen.element);
    await vi.waitFor(() => expect(screen.element.dataset.phase).toBe("playing"));
    const click = (selector: string) => screen.element.querySelector<HTMLButtonElement>(selector)!.click();
    return { screen, shell, postAttempt, choose: (p: LngLatPoint) => choose(p), click };
  }

  it("plays the standard five rounds under a Ranked pill and posts the total", async () => {
    const ui = await ranked();
    expect(GEOGUESSR_ROUND_LIMIT).toBe(GEOGUESSR_ATTEMPT_ROUNDS);
    expect(ui.screen.element.querySelector(".shell-run-pill .shell-run-label")?.textContent).toBe("Ranked");
    ui.screen.element.querySelector<HTMLButtonElement>(".shell-gamebar-more")!.click();
    expect(ui.screen.element.querySelector(".shell-menu")?.textContent).not.toContain("Restart run");
    for (const p of locations) {
      ui.choose(p); ui.click(".geo-lock"); ui.click(".geo-result-card .geo-primary");
      await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe(p === locations.at(-1) ? "complete" : "playing"));
    }
    const card = ui.screen.element.querySelector(".geo-result-card .shell-results")!;
    expect(card.querySelector(".shell-results-kicker")?.textContent).toBe("GeoGuessr · Ranked attempt");
    expect(ui.postAttempt).toHaveBeenCalledWith({ gameMode: "geoguessr", variant: "", value: 25_000, isLoggedIn: false });
    await vi.waitFor(() => expect(card.querySelector(".shell-results-sub")?.textContent).toContain("That would place #9"));
    expect(card.querySelector(".shell-results-primary")?.textContent).toBe("Try again");
    [...card.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("View leaderboard"))!.click();
    expect(ui.shell.openCompete).toHaveBeenCalledWith("geoguessr");
    card.querySelector<HTMLButtonElement>(".shell-results-cross")!.click();
    expect(ui.shell.openGame).toHaveBeenCalledWith("geoguessr", "practice");
  });

  it("asks before leaving an attempt", async () => {
    const ui = await ranked();
    ui.click(".shell-gamebar-back");
    await vi.waitFor(() => expect(ui.shell.confirmLeave).toHaveBeenCalledWith(RANKED_LEAVE_MESSAGE, expect.anything()));
  });

  it("explains that ranked attempts need Street View when it isn't configured", () => {
    const openGame = vi.fn();
    const screen = createGeoGuessrScreen({ shell: { ...stubShell(), openGame }, run: "timed", countryIndex: indexCountries(rawCountries), onHome() {}, onGameModeChange() {}, onDailyChallenge() {}, onMultiplayer() {} }, { isConfigured: () => false, createMap: () => ({ element: document.createElement("div"), reset() {}, reveal() {}, resize() {}, destroy() {}, setAcceptingGuesses() {} }) });
    screens.push(screen);
    expect(screen.element.dataset.phase).toBe("unconfigured");
    expect(screen.element.querySelector(".geo-loading-panel h1")?.textContent).toBe("Ranked attempts need Street View — not available here");
    screen.element.querySelector<HTMLButtonElement>(".geo-alt-games .geo-primary")!.click();
    expect(openGame).toHaveBeenCalledWith("map-tap", "timed");
  });
});
