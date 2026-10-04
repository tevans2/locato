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
    openLeaderboards: (mode, variant) => calls.push(`compete:${mode ?? ""}${variant ? `:${variant}` : ""}`),
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
    expect(card.querySelector(".shell-results-kicker")?.textContent).toBe("Name all countries · Solo timed run");
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

describe("CountryGuessingScreen run audit", () => {
  const user = { id: "u1", email: "u@test.local", displayName: "u", avatarUrl: null } as never;

  function mockServer() {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ path, body });
      const reply = path === "/api/runs/start" ? { runId: "run_test" } : path === "/api/leaderboard" ? { accepted: true, isPersonalBest: true, rank: 1, bestTimeMs: 1 } : { ok: true };
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("asks for a ticket on the first country and sends the timeline when a practice run is restarted", async () => {
    const calls = mockServer();
    const { root, type } = setup({ getAuthUser: () => user });
    type("Japan");
    type("Brazil");
    expect(calls.filter((call) => call.path === "/api/runs/start")).toEqual([{ path: "/api/runs/start", body: { gameMode: "name-all", variant: "", timed: false } }]);
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Restart")!.click();
    await vi.waitFor(() => expect(calls.some((call) => call.path === "/api/runs/finish")).toBe(true));
    const finish = calls.find((call) => call.path === "/api/runs/finish")!.body;
    expect(finish).toMatchObject({ runId: "run_test", outcome: "abandoned" });
    const entries = (finish.timeline as { entries: unknown[][] }).entries;
    expect(entries.map((entry) => entry[0])).toEqual(["JP", "BR"]);
    // Test events are dispatched from script, so the browser marks them untrusted.
    expect(entries.map((entry) => [entry[2], entry[3]])).toEqual([[0, 1], [0, 1]]);
  });

  it("a given-up run says so", async () => {
    const calls = mockServer();
    const { root, type } = setup({ getAuthUser: () => user });
    type("Japan");
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Give up")!.click();
    await vi.waitFor(() => expect(calls.find((call) => call.path === "/api/runs/finish")?.body.outcome).toBe("given-up"));
    expect(calls.filter((call) => call.path === "/api/runs/finish")).toHaveLength(1);
  });

  it("posts a finished timed run with its ticket and timeline", async () => {
    const calls = mockServer();
    const { type } = setup({ run: "timed", getAuthUser: () => user });
    type("Japan");
    type("Brazil");
    type("Kenya");
    await vi.waitFor(() => expect(calls.some((call) => call.path === "/api/leaderboard")).toBe(true));
    const post = calls.find((call) => call.path === "/api/leaderboard")!.body;
    expect(post).toMatchObject({ gameMode: "name-all", runId: "run_test" });
    expect((post.timeline as { entries: unknown[][] }).entries.map((entry) => entry[0])).toEqual(["JP", "BR", "KE"]);
    // The timed run's timeline goes with the post, not as a separate finish.
    expect(calls.some((call) => call.path === "/api/runs/finish")).toBe(false);
  });

  it("guests send nothing", () => {
    const calls = mockServer();
    const { type } = setup();
    type("Japan");
    expect(calls).toEqual([]);
  });
});
