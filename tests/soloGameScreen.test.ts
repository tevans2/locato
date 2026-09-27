// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexCountries, type RawCountry } from "../src/core/countries";
import { createGameEngine } from "../src/core/game";
import { createSoloGameScreen, type SoloGameScreenOptions } from "../src/ui/screens/SoloGameScreen";
import type { ShellContext } from "../src/ui/shell/types";

const countries = [
  { name: "Japan", code: "JP", aliases: [], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Brazil", code: "BR", aliases: [], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: ["Brasilia"] },
] as const satisfies readonly RawCountry[];

function makeShell(): ShellContext & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openSection: (section) => calls.push(`section:${section}`),
    goHome: () => calls.push("home"),
    goBack: (fallback) => calls.push(`back:${fallback ?? ""}`),
    openGame: (mode, run) => calls.push(`game:${mode}:${run ?? "practice"}`),
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

function setup(overrides: Partial<SoloGameScreenOptions> = {}) {
  const index = indexCountries(countries);
  const engine = createGameEngine({ countryIndex: index, categoryIds: ["flags"], seed: "screen-test", now: 1000 });
  const shell = makeShell();
  const onReset = vi.fn();
  const screen = createSoloGameScreen({
    shell,
    countryIndex: index,
    engine,
    selectedGameMode: "flags",
    storage: window.localStorage,
    onGameModeChange: vi.fn(),
    onStateChange: vi.fn(),
    onReset,
    getAuthUser: () => null,
    ...overrides,
  });
  screens.push(screen);
  document.body.append(screen.element);
  const root = screen.element;
  const answerCurrent = (): void => {
    const current = index.byId[engine.getState().currentCountryId!]!;
    const input = root.querySelector<HTMLInputElement>("#guess-input")!;
    input.value = current.name;
    root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  };
  return { root, shell, engine, onReset, answerCurrent };
}

describe("SoloGameScreen practice vs timed", () => {
  it("practice: GameBar with a Practice pill, no clock and no Practice/Timer dropdown", () => {
    const { root } = setup();
    expect(root.dataset.shell).toBe("game");
    expect(root.querySelector(".shell-gamebar")).not.toBeNull();
    expect(root.querySelector(".shell-run-pill")?.getAttribute("data-run")).toBe("practice");
    expect(root.querySelector(".game-run-clock-value")).toBeNull();
    expect(root.querySelector("select#solo-timer-mode")).toBeNull();
    expect(root.querySelector(".game-header")).toBeNull();
    // The score stays outside the phone "Details" fold.
    expect(root.querySelector(".mobile-extras-panel .stats-panel[aria-label='Game statistics']")).toBeNull();
    expect(root.querySelector(".mobile-extras-panel .feedback")).toBeNull();
  });

  it("timed: the clock lives in the GameBar pill and there is no mode dropdown", () => {
    const { root } = setup({ run: "timed" });
    const pill = root.querySelector(".shell-run-pill")!;
    expect(pill.getAttribute("data-run")).toBe("timed");
    expect(pill.querySelector(".game-run-clock-value")?.textContent).toBe("0:00.0");
    expect(root.querySelector("select")).toBeNull();
  });

  it("a mode without a leaderboard stays practice even when asked for timed", () => {
    const index = indexCountries(countries);
    const engine = createGameEngine({ countryIndex: index, categoryIds: ["flag-colors"], seed: "fc", now: 1 });
    const { root } = setup({ run: "timed", engine, selectedGameMode: "flag-colors" });
    expect(root.dataset.run).toBe("practice");
  });

  it("practice completion shows the results card with Play again and the timed cross-link", () => {
    const { root, shell, answerCurrent, onReset } = setup();
    answerCurrent();
    answerCurrent();
    const card = root.querySelector(".shell-results");
    expect(root.dataset.phase).toBe("results");
    expect(card?.querySelector(".shell-results-kicker")?.textContent).toBe("Flags · Practice");
    expect(card?.querySelector(".shell-results-primary")?.textContent).toBe("Play again");
    expect(card?.textContent).toContain("Try another game");
    expect(card?.textContent).toContain("Share");
    card!.querySelector<HTMLButtonElement>(".shell-results-cross")!.click();
    expect(shell.calls).toContain("compete:flags");
    card!.querySelector<HTMLButtonElement>(".shell-results-primary")!.click();
    expect(onReset).toHaveBeenCalled();
    expect(root.dataset.phase).toBeUndefined();
    expect(root.querySelector(".shell-results")).toBeNull();
  });

  it("lists passed countries on the results card, each linking to the Atlas", () => {
    const { root, shell, engine, answerCurrent } = setup();
    const skipped = engine.getState().currentCountryId!;
    root.querySelector<HTMLButtonElement>(".solo-action-grid button[aria-label='Reveal this answer']")!.click();
    answerCurrent();
    answerCurrent();
    const chip = root.querySelector<HTMLButtonElement>(".shell-results [data-country]");
    expect(chip).not.toBeNull();
    chip!.click();
    expect(shell.calls.some((call) => call.startsWith("country:"))).toBe(true);
    expect(skipped).toBeDefined();
  });

  it("timed completion shows the time, View leaderboard, sign-in prompt and Practise this mode", async () => {
    const { root, shell, answerCurrent } = setup({ run: "timed" });
    answerCurrent();
    answerCurrent();
    const card = root.querySelector(".shell-results")!;
    expect(card.querySelector(".shell-results-kicker")?.textContent).toBe("Flags · Timed run");
    expect(card.querySelector(".shell-results-primary")?.textContent).toBe("Run again");
    expect(card.textContent).toContain("View leaderboard");
    await vi.waitFor(() => expect(card.querySelector(".shell-results-sub")?.textContent).toContain("Sign in to post"));
    card.querySelector<HTMLButtonElement>(".shell-results-cross")!.click();
    expect(shell.calls).toContain("game:flags:practice");
  });

  it("asks before leaving a timed run in progress, but not a practice run", async () => {
    const timed = setup({ run: "timed" });
    timed.answerCurrent();
    timed.root.querySelector<HTMLButtonElement>(".shell-gamebar-back")!.click();
    await vi.waitFor(() => expect(timed.shell.confirmLeave).toHaveBeenCalledWith("This timed run is still going — it won't be posted.", expect.anything()));

    const practice = setup();
    practice.answerCurrent();
    practice.root.querySelector<HTMLButtonElement>(".shell-gamebar-back")!.click();
    await vi.waitFor(() => expect(practice.shell.calls).toContain("back:play"));
    expect(practice.shell.confirmLeave).not.toHaveBeenCalled();
  });

  it("daily prompt stage uses the focus bar with round progress and no game switcher", () => {
    const onExit = vi.fn();
    const { root } = setup({ onExitDailyChallenge: onExit, dailyChallenge: { date: "2026-09-27", onComplete: vi.fn() } });
    expect(root.dataset.shell).toBe("focus");
    expect(root.querySelector(".shell-gamebar")).toBeNull();
    expect(root.querySelector(".shell-switcher")).toBeNull();
    expect(root.querySelector(".daily-round-label")?.textContent).toBe("Round 1 of 10");
    root.querySelector<HTMLButtonElement>(".shell-focusbar-close")!.click();
    expect(onExit).toHaveBeenCalled();
  });
});
