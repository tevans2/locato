// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeoGuessrScreen, type GeoGuessrScreenServices } from "../src/ui/screens/GeoGuessrScreen";
import { indexCountries, rawCountries } from "../src/core/countries";
import type { GeoGuessMapOptions } from "../src/ui/components/GeoGuessMap";
import type { LngLatPoint } from "../src/core/maptap/distance";
import type { ShellContext } from "../src/ui/shell/types";
import { GEOGUESSR_ROUND_LIMIT, type GeoGuessrCandidate } from "../src/core/geoguessr";
import { GEOGUESSR_ATTEMPT_ROUNDS } from "../src/core/leaderboards";
import type { PostRankedAttempt } from "../src/ui/screens/rankedAttempt";

const locations = ["IT", "JP", "ZA", "BR", "CA"].map((countryCode, i) => ({ countryCode, lat: i, lng: i, heading: 0, label: "Round" }));
const screens: ReturnType<typeof createGeoGuessrScreen>[] = [];
function stubShell(): ShellContext {
  return { openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openLeaderboards() {}, openAccount() {}, controls: document.createElement("div"), confirmLeave: async () => true, signedIn: () => false };
}
afterEach(() => { for (const screen of screens.splice(0)) screen.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); localStorage.clear(); });
async function setup(overrides: Partial<GeoGuessrScreenServices> = {}, autoplay = true) {
  let choose: (point: LngLatPoint) => void = () => {};
  const map = { element: document.createElement("div"), setStyle: vi.fn(), zoomBy: vi.fn(), showWorld: vi.fn(), showGuess: vi.fn(), highlightCountry: vi.fn(), showCountry: vi.fn(), showResult: vi.fn(), reset: vi.fn(), reveal: vi.fn(), setAcceptingGuesses: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
  const panorama = { element: document.createElement("div"), show: vi.fn(async (p: GeoGuessrCandidate) => ({ lat: p.lat ?? 1, lng: p.lng ?? 2 })), reset: vi.fn(), destroy: vi.fn() };
  const screen = createGeoGuessrScreen({ storage: localStorage, countryIndex: indexCountries(rawCountries), onHome: vi.fn(), onGameModeChange: vi.fn(), onDailyChallenge: vi.fn() }, {
    countdown: async () => {}, createMap: (options: GeoGuessMapOptions) => { choose = options.onGuessChange; return map; }, createPanorama: () => panorama, loadLocations: async () => locations, postAttempt: vi.fn(async () => ({ serverAccepted: null, rank: null })), ...overrides,
  });
  screens.push(screen); document.body.append(screen.element);
  if (autoplay) screen.element.querySelector<HTMLButtonElement>(".geo-start-map")!.click();
  await vi.waitFor(() => expect(screen.element.dataset.phase).not.toBe("loading"));
  const click = (selector: string) => { const button = screen.element.querySelector<HTMLButtonElement>(selector); if (!button) throw new Error(`Missing ${selector}`); button.click(); };
  return { screen, map, panorama, choose: (p: LngLatPoint) => choose(p), click };
}

describe("GeoGuessr play surface", () => {
  it("expands on hover, shrinks on leave, and lets the player pin it open", async () => {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation(query => {
      const media = matchMedia(query);
      if (query.includes("hover")) Object.defineProperty(media, "matches", { value: true });
      return media;
    });
    const ui = await setup();
    const dock = ui.screen.element.querySelector(".geo-map-panel")!;
    dock.dispatchEvent(new Event("pointerenter"));
    expect(ui.screen.element.dataset.mapSize).toBe("expanded");
    dock.dispatchEvent(new Event("pointerleave"));
    expect(ui.screen.element.dataset.mapSize).toBe("compact");
    dock.dispatchEvent(new Event("pointerenter"));
    ui.click(".geo-pin-map");
    dock.dispatchEvent(new Event("pointerleave"));
    expect(ui.screen.element.dataset.mapSize).toBe("expanded");
    expect(ui.screen.element.querySelector(".geo-pin-map")?.getAttribute("aria-pressed")).toBe("true");
    ui.choose(locations[0]!); ui.click(".geo-lock");
    expect(ui.screen.element.querySelector(".geo-step-score")?.textContent).toBe("5,000");
    ui.click(".geo-result-card .geo-primary");
    await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("playing"));
    expect(ui.screen.element.dataset.mapSize).toBe("expanded");
  });
  it("keeps the selected map style across rounds and reconnects the map controls", async () => {
    const ui = await setup();
    ui.click('[data-style="terrain"]');
    expect(ui.map.setStyle).toHaveBeenLastCalledWith("terrain");
    expect(ui.screen.element.querySelector('[data-style="terrain"]')?.getAttribute("aria-pressed")).toBe("true");
    ui.click(".geo-zoom-in"); ui.click(".geo-zoom-out"); ui.click(".geo-world");
    expect(ui.map.zoomBy.mock.calls).toEqual([[1], [-1]]);
    expect(ui.map.showWorld).toHaveBeenCalledOnce();
    expect(ui.screen.element.querySelector<HTMLButtonElement>(".geo-return-pin")?.disabled).toBe(true);
    ui.choose(locations[0]!); ui.click(".geo-return-pin");
    expect(ui.map.showGuess).toHaveBeenCalledOnce();
    expect(ui.map.highlightCountry).not.toHaveBeenCalled();
    ui.click(".geo-lock");
    expect(ui.map.highlightCountry).toHaveBeenCalledWith("IT");
    for (const selector of [".geo-map-header", ".geo-map-toolbar"]) expect(ui.screen.element.querySelector<HTMLElement>(selector)!.hidden).toBe(true);
    expect(ui.screen.element.querySelector(".geo-show-country")).toBeNull();
    expect(ui.screen.element.querySelector(".geo-show-pins")).toBeNull();
    expect(ui.screen.element.querySelector<HTMLElement>(".geo-map-tools")!.hidden).toBe(false);
    await vi.waitFor(() => expect(ui.map.showResult).toHaveBeenCalled());
    expect(ui.screen.element.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("5000");
    ui.click(".geo-result-card .geo-primary");
    await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("playing"));
    expect(ui.screen.element.querySelector<HTMLButtonElement>(".geo-return-pin")?.disabled).toBe(true);
    expect(ui.screen.element.querySelector('[data-style="terrain"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("locato:geoguessr:map-style")).toBe("terrain");
  });
  it("supports Enter to submit once without intercepting an interactive control", async () => {
    const ui = await setup();
    ui.choose(locations[0]!);
    const button = ui.screen.element.querySelector<HTMLButtonElement>('[data-style="terrain"]')!;
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(ui.screen.element.dataset.phase).toBe("playing");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true }));
    expect(ui.screen.element.dataset.phase).toBe("result");
    expect(ui.map.reveal).toHaveBeenCalledOnce();
  });
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
    expect(ui.screen.element.querySelector(".shell-results-missed")).toBeNull();
    expect(ui.screen.element.querySelectorAll(".geo-recap-row .gb-run-flag")).toHaveLength(5);
    for (const selector of [".geo-map-header", ".geo-map-toolbar", ".geo-map-tools", ".geo-session"]) expect(ui.screen.element.querySelector<HTMLElement>(selector)!.hidden).toBe(true);
    expect(ui.screen.element.querySelector(".shell-results-kicker")?.textContent).toBe("World · Trip complete");
    expect(ui.map.setStyle).toHaveBeenLastCalledWith("roadmap");
    expect(ui.screen.element.querySelector(".shell-results")!.classList.contains("is-celebrate")).toBe(false);
    expect(ui.screen.element.querySelectorAll(".geo-recap-row")).toHaveLength(5);
    ui.click(".geo-recap-row");
    expect(ui.map.reveal).toHaveBeenLastCalledWith(locations[0], [{ lat: 0, lng: 0, label: "Your pin", color: "#287965" }]);
    ui.click(".geo-end-change-map");
    expect(ui.screen.element.dataset.mapPicker).toBe("open");
    ui.click(".geo-atlas-close");
    expect(ui.screen.element.dataset.phase).toBe("complete");
    expect(document.activeElement).toBe(ui.screen.element.querySelector(".shell-results-title"));
    ui.click(".geo-result-card .shell-results-primary");
    await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("playing"));
    expect(ui.screen.element.querySelector(".geo-total-score")?.textContent).toBe("0");
    expect(ui.screen.element.querySelector(".geo-round-number")?.textContent).toBe("01");
    expect(ui.screen.element.querySelector<HTMLElement>(".geo-map-toolbar")!.hidden).toBe(false);
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
    const screen = createGeoGuessrScreen({ shell: { ...stubShell(), ...shell }, countryIndex: indexCountries(rawCountries), onHome() {}, onGameModeChange() {}, onDailyChallenge() {} }, { isConfigured: () => false, createMap: () => ({ element: document.createElement("div"), reset() {}, reveal() {}, resize() {}, destroy() {}, setAcceptingGuesses() {} }) });
    screens.push(screen);
    screen.element.querySelector<HTMLButtonElement>(".geo-start-map")!.click();
    expect(screen.element.dataset.shell).toBe("game");
    expect(screen.element.querySelector(".shell-gamebar .shell-switcher-name")?.textContent).toBe("GeoGuessr");
    expect(screen.element.dataset.phase).toBe("unconfigured");
    screen.element.querySelector<HTMLButtonElement>(".geo-alt-games .geo-primary")!.click();
    expect(shell.openGame).toHaveBeenCalledWith("map-tap");
  });
  it("does not restore an asynchronously loaded screen after navigation away", async () => {
    let finish!: (p: LngLatPoint) => void;
    const show = () => new Promise<LngLatPoint>(resolve => { finish = resolve; });
    const screen = createGeoGuessrScreen({ countryIndex: indexCountries(rawCountries), onHome() {}, onGameModeChange() {}, onDailyChallenge() {} }, {
      createMap: () => ({ element: document.createElement("div"), reset() {}, reveal() {}, resize() {}, destroy() {}, setAcceptingGuesses() {} }),
      createPanorama: () => ({ element: document.createElement("div"), show, reset() {}, destroy() {} }), loadLocations: async () => locations,
    });
    screen.element.querySelector<HTMLButtonElement>(".geo-start-map")!.click();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    screen.destroy(); finish({ lat: 0, lng: 0 }); await Promise.resolve();
    expect(screen.element.dataset.phase).toBe("loading");
  });
});

describe("GeoGuessr (single-run: every trip counts)", () => {
  async function play(shellOverrides: Partial<ShellContext> = {}, postAttempt = vi.fn<PostRankedAttempt>(async () => ({ serverAccepted: null, rank: 9 }))) {
    let choose: (point: LngLatPoint) => void = () => {};
    const map = { element: document.createElement("div"), setStyle: vi.fn(), zoomBy: vi.fn(), showWorld: vi.fn(), showGuess: vi.fn(), highlightCountry: vi.fn(), showCountry: vi.fn(), showResult: vi.fn(), reset: vi.fn(), reveal: vi.fn(), setAcceptingGuesses: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
    const panorama = { element: document.createElement("div"), show: vi.fn(async (p: GeoGuessrCandidate) => ({ lat: p.lat ?? 1, lng: p.lng ?? 2 })), reset: vi.fn(), destroy: vi.fn() };
    const shell = { ...stubShell(), openLeaderboards: vi.fn(), openGame: vi.fn(), confirmLeave: vi.fn(async () => false), ...shellOverrides };
    const screen = createGeoGuessrScreen({ shell, storage: localStorage, countryIndex: indexCountries(rawCountries), onHome() {}, onGameModeChange() {}, onDailyChallenge() {} }, {
      countdown: async () => {}, createMap: (options: GeoGuessMapOptions) => { choose = options.onGuessChange; return map; }, createPanorama: () => panorama, loadLocations: async () => locations, postAttempt,
    });
    screens.push(screen); document.body.append(screen.element);
  screen.element.querySelector<HTMLButtonElement>(".geo-start-map")!.click();
    await vi.waitFor(() => expect(screen.element.dataset.phase).toBe("playing"));
    const click = (selector: string) => screen.element.querySelector<HTMLButtonElement>(selector)!.click();
    return { screen, shell, postAttempt, choose: (p: LngLatPoint) => choose(p), click };
  }

  it("plays the standard five rounds under a Best badge and posts the total", async () => {
    localStorage.setItem("locato:geoguessr:best-run:v1", "12000");
    const ui = await play();
    expect(GEOGUESSR_ROUND_LIMIT).toBe(GEOGUESSR_ATTEMPT_ROUNDS);
    expect(ui.screen.element.querySelector(".shell-run-option")).toBeNull();
    expect(ui.screen.element.querySelector(".shell-run-best-value")?.textContent).toBe("12,000");
    ui.screen.element.querySelector<HTMLButtonElement>(".shell-gamebar-more")!.click();
    expect(ui.screen.element.querySelector(".shell-menu")?.textContent).toContain("Restart run");
    for (const p of locations) {
      ui.choose(p); ui.click(".geo-lock"); ui.click(".geo-result-card .geo-primary");
      await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe(p === locations.at(-1) ? "complete" : "playing"));
    }
    const card = ui.screen.element.querySelector(".geo-result-card .shell-results")!;
    expect(card.querySelector(".shell-results-kicker")?.textContent).toBe("World · Trip complete");
    expect(card.querySelector(".shell-results-title")?.textContent).toBe("A new best trip!");
    expect(ui.postAttempt).toHaveBeenCalledWith({ gameMode: "geoguessr", variant: "", value: 25_000, isLoggedIn: false });
    await vi.waitFor(() => expect(card.querySelector(".shell-results-sub")?.textContent).toContain("That would place #9"));
    expect(card.querySelector(".shell-results-primary")?.textContent).toBe("Play again");
    expect(card.querySelector(".shell-results-cross")).toBeNull();
    expect(ui.screen.element.querySelector(".shell-run-best-value")?.textContent).toBe("25,000");
    [...card.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("View leaderboard"))!.click();
    expect(ui.shell.openLeaderboards).toHaveBeenCalledWith("geoguessr");
  });

  it("never asks before leaving mid-trip", async () => {
    const ui = await play();
    ui.click(".shell-gamebar-back");
    await Promise.resolve();
    expect(ui.shell.confirmLeave).not.toHaveBeenCalled();
  });
});


describe("GeoGuessr map selection", () => {
  it("waits for a map choice, supports search, and loads only the selected country", async () => {
    const loadLocations = vi.fn(async () => []);
    const ui = await setup({ loadLocations }, false);
    expect(ui.screen.element.dataset.phase).toBe("selecting");
    expect(loadLocations).not.toHaveBeenCalled();
    expect(ui.panorama.show).not.toHaveBeenCalled();
    expect(ui.screen.element.querySelectorAll(".geo-atlas-card")).toHaveLength(31);
    const search = ui.screen.element.querySelector<HTMLInputElement>(".geo-atlas-search")!;
    search.value = "France"; search.dispatchEvent(new Event("input"));
    expect(ui.screen.element.querySelectorAll(".geo-atlas-card")).toHaveLength(1);
    ui.click('[data-map="france"]');
    expect(ui.screen.element.querySelector(".geo-start-map")?.textContent).toBe("Play France →");
    expect(ui.screen.element.querySelector(".geo-atlas-mobile-start")?.textContent).toBe("Play France →");
    ui.click(".geo-start-map");
    await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("playing"));
    expect(loadLocations).toHaveBeenCalledWith(expect.any(AbortSignal), "france");
    expect(ui.panorama.show.mock.calls[0]![0]).toMatchObject({ countryCode: "FR" });
    expect(localStorage.getItem("locato:geoguessr:selected-map")).toBe("france");
    expect(ui.screen.element.querySelector(".geo-selected-map")).toBeNull();
  });
  it("keeps map selection out of a running trip and returns to the recap when cancelled", async () => {
    const ui = await setup();
    expect(ui.screen.element.querySelector(".geo-selected-map")).toBeNull();
    expect([...ui.screen.element.querySelectorAll(".shell-menu-label")].some(label => label.textContent === "Change map")).toBe(false);
    for (const point of locations) {
      ui.choose(point); ui.click(".geo-lock"); ui.click(".geo-result-card .geo-primary");
      await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe(point === locations.at(-1) ? "complete" : "playing"));
    }
    ui.click(".geo-end-change-map");
    expect(ui.screen.element.dataset.mapPicker).toBe("open");
    ui.click('[data-map="japan"]');
    ui.click(".geo-atlas-close");
    expect(ui.screen.element.dataset.mapPicker).toBe("closed");
    expect(ui.screen.element.dataset.phase).toBe("complete");
    expect(ui.screen.element.querySelector(".shell-results-kicker")?.textContent).toBe("World · Trip complete");
    expect(ui.panorama.show).toHaveBeenCalledTimes(5);
  });
  it("keeps country-map bests and posting separate from the World best", async () => {
    localStorage.setItem("locato:ranked-best:geoguessr:v1", "12000");
    const postAttempt = vi.fn<PostRankedAttempt>(async () => ({ serverAccepted: null, rank: null }));
    const ui = await setup({ loadLocations: async () => [], postAttempt }, false);
    ui.click('[data-map="france"]'); ui.click(".geo-start-map");
    for (let i = 0; i < 5; i++) {
      await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("playing"));
      const target = ui.panorama.show.mock.calls.at(-1)![0];
      ui.choose({ lat: target.lat!, lng: target.lng! }); ui.click(".geo-lock"); ui.click(".geo-result-card .geo-primary");
    }
    expect(ui.screen.element.dataset.phase).toBe("complete");
    expect(postAttempt).toHaveBeenCalledWith({ gameMode: "geoguessr", variant: "france", value: 25000, isLoggedIn: false });
    expect(localStorage.getItem("locato:ranked-best:geoguessr:france:v1")).toBe("25000");
    expect(localStorage.getItem("locato:ranked-best:geoguessr:v1")).toBe("12000");
  });
});
