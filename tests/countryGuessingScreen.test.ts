// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexCountries, type RawCountry } from "../src/core/countries";
import { createCountryGuessingScreen, type CountryGuessingScreenOptions } from "../src/ui/screens/CountryGuessingScreen";
import type { ShellContext } from "../src/ui/shell/types";

const countries = [
  { name: "Japan", code: "JP", aliases: [], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Brazil", code: "BR", aliases: [], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: ["Brasilia"] },
  { name: "Kenya", code: "KE", aliases: [], continent: "Africa", flagSrc: "assets/flags/ke.svg", capital: "Nairobi", capitalAliases: [] },
] as const satisfies readonly RawCountry[];

function makeShell(): ShellContext & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openSection: (section) => calls.push(`section:${section}`),
    goHome: () => calls.push("home"),
    goBack: (fallback) => calls.push(`back:${fallback ?? ""}`),
    openGame: (mode, run, variant) => calls.push(`game:${mode}:${run ?? "practice"}${variant ? `:${variant}` : ""}`),
    openGamePicker: () => calls.push("picker"),
    openCountry: (code) => calls.push(`country:${code}`),
    openCompete: (mode, variant) => calls.push(`compete:${mode ?? ""}${variant ? `:${variant}` : ""}`),
    openAccount: () => calls.push("account"),
    controls: document.createElement("div"),
    confirmLeave: vi.fn(async () => true),
    signedIn: () => false,
    storage: window.localStorage,
  };
}

const screens: { destroy: () => void }[] = [];
afterEach(() => {
  for (const screen of screens.splice(0)) screen.destroy();
  document.body.replaceChildren();
  window.localStorage.clear();
});

function setup(overrides: Partial<CountryGuessingScreenOptions> = {}) {
  const shell = makeShell();
  const onRecordGame = vi.fn();
  const screen = createCountryGuessingScreen({
    shell,
    countryIndex: indexCountries(countries),
    worldCountryFeatures: [],
    storage: window.localStorage,
    initialMode: "name-all",
    onRecordGame,
    getAuthUser: () => null,
    ...overrides,
  });
  screens.push(screen);
  document.body.append(screen.element);
  const root = screen.element;
  const type = (value: string): void => {
    const input = root.querySelector<HTMLInputElement>("#guess-input")!;
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };
  return { root, shell, type, onRecordGame };
}

describe("CountryGuessingScreen practice vs timed", () => {
  it("practice has no clock, no mode dropdown and no timer select", () => {
    const { root } = setup();
    expect(root.dataset.shell).toBe("game");
    expect(root.querySelector(".shell-run-pill")?.getAttribute("data-run")).toBe("practice");
    expect(root.querySelector(".game-run-clock-value")).toBeNull();
    expect(root.querySelector("#country-timer-mode")).toBeNull();
    expect(root.querySelector(".game-mode-dropdown")).toBeNull();
    // Found / remaining stay outside the phone Details fold.
    expect(root.querySelector(".answer-panel > .country-guess-score")).not.toBeNull();
  });

  it("timed shows the clock in the GameBar", () => {
    const { root } = setup({ run: "timed" });
    expect(root.querySelector(".shell-run-pill .game-run-clock-value")).not.toBeNull();
    expect(root.querySelector("select#country-timer-mode")).toBeNull();
  });

  it("finishing the world shows the practice results card", () => {
    const { root, shell, type, onRecordGame } = setup();
    type("Japan");
    type("Brazil");
    type("Kenya");
    expect(root.dataset.phase).toBe("results");
    const card = root.querySelector(".shell-results")!;
    expect(card.querySelector(".shell-results-title")?.textContent).toBe("World complete");
    expect(card.querySelector(".shell-results-primary")?.textContent).toBe("Play again");
    card.querySelector<HTMLButtonElement>(".shell-results-cross")!.click();
    expect(shell.calls).toContain("compete:name-all");
    expect(onRecordGame).toHaveBeenCalledWith(expect.objectContaining({ completed: true, timed: false, countriesFound: 3 }));
    card.querySelector<HTMLButtonElement>(".shell-results-primary")!.click();
    expect(root.dataset.phase).toBeUndefined();
  });

  it("give up shows the missed list and can go back to review on the map", () => {
    const { root, shell, type } = setup();
    type("Japan");
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Give up")!.click();
    const card = root.querySelector(".shell-results")!;
    expect(card.querySelector(".shell-results-title")?.textContent).toBe("Round over");
    const chips = [...card.querySelectorAll<HTMLElement>("[data-country]")].map((chip) => chip.dataset.country);
    expect(chips.sort()).toEqual(["BR", "KE"]);
    card.querySelector<HTMLButtonElement>("[data-country='KE']")!.click();
    expect(shell.calls).toContain("country:KE");
    [...card.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Review on the map")!.click();
    expect(root.dataset.phase).toBeUndefined();
    const seeResults = root.querySelector<HTMLButtonElement>(".game-show-results")!;
    expect(seeResults.hidden).toBe(false);
    seeResults.click();
    expect(root.dataset.phase).toBe("results");
  });

  it("timed completion offers the leaderboard and practice cross-link", async () => {
    const { root, shell, type } = setup({ run: "timed" });
    type("Japan");
    type("Brazil");
    type("Kenya");
    const card = root.querySelector(".shell-results")!;
    expect(card.querySelector(".shell-results-kicker")?.textContent).toBe("Name all countries · Timed run");
    expect(card.querySelector(".shell-results-primary")?.textContent).toBe("Run again");
    [...card.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "View leaderboard")!.click();
    expect(shell.calls).toContain("compete:name-all");
    await vi.waitFor(() => expect(card.textContent).toContain("Sign in to post"));
    card.querySelector<HTMLButtonElement>(".shell-results-cross")!.click();
    expect(shell.calls).toContain("game:name-all:practice");
  });

  it("a timed puzzle is locked to its continent (no continent picker)", () => {
    const { root } = setup({ run: "timed", initialMode: "puzzle", puzzleContinent: "Asia" });
    expect(root.querySelector("#puzzle-continent")).toBeNull();
    expect(root.querySelector(".puzzle-continent-locked")?.textContent).toBe("Asia");
  });

  it("the GameBar switcher replaces in-place mode switching", () => {
    const { root } = setup();
    expect(root.querySelector(".shell-switcher")).not.toBeNull();
  });
});
