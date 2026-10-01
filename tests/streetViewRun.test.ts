// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreetViewCountryScreen, STREETVIEW_RUN_LENGTH } from "../src/ui/screens/StreetViewCountryScreen";
import { indexCountries, rawCountries } from "../src/core/countries";
import { streetViewCountryRounds } from "../src/core/streetview";
import type { ShellContext } from "../src/ui/shell/types";
import { STREET_VIEW_ATTEMPT_COUNTRIES, streetViewCountryPoints } from "../src/core/leaderboards";
import type { PostRankedAttempt } from "../src/ui/screens/rankedAttempt";

const countryIndex = indexCountries(rawCountries);
const screens: ReturnType<typeof createStreetViewCountryScreen>[] = [];
afterEach(() => { for (const screen of screens.splice(0)) screen.destroy(); document.body.replaceChildren(); localStorage.clear(); });

function stubShell(overrides: Partial<ShellContext> = {}): ShellContext {
  return { openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openCompete() {}, openAccount() {}, controls: document.createElement("div"), confirmLeave: async () => true, signedIn: () => false, ...overrides };
}

const services = {
  apiKey: "test-key",
  // Unique, inert URLs per round/frame: the code is readable from the active frame.
  embedUrl: (_key: string, round: { countryCode: string }, attempt: number) => `about:blank#${round.countryCode}-${attempt}`,
  fetchRounds: async () => [],
  loadTimeoutMs: 0,
};

function setup(options: { shell?: Partial<ShellContext>; daily?: boolean; postAttempt?: PostRankedAttempt; apiKey?: string } = {}) {
  const onComplete = vi.fn();
  const dailyRound = streetViewCountryRounds.find((round) => round.frames.length === 3 && countryIndex.byCode.has(round.countryCode))!;
  const screen = createStreetViewCountryScreen({
    shell: stubShell(options.shell),
    storage: localStorage,
    countryIndex,
    onGameModeChange() {},
    onHome: vi.fn(),
    onMultiplayer() {},
    onDailyChallenge() {},
    ...(options.daily ? { dailyChallenge: { date: "2026-09-27", round: dailyRound, onComplete, progress: { round: 10, total: 10 } } } : {}),
  }, { ...services, postAttempt: options.postAttempt ?? (async () => ({ serverAccepted: null, rank: null })), ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}) });
  screens.push(screen);
  document.body.append(screen.element);
  const $ = <T extends Element = HTMLElement>(selector: string) => screen.element.querySelector<T>(selector);
  const input = $<HTMLInputElement>("#streetview-guess-input")!;
  const ready = () => vi.waitFor(() => expect(input.disabled).toBe(false));
  const currentCode = () => /#([A-Z]{2})-/.exec($(".streetview-frame.is-active")?.getAttribute("src") ?? "")?.[1] ?? "";
  const guess = (name: string) => {
    input.value = name;
    $<HTMLFormElement>(".streetview-guess-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  };
  const wrongName = (code: string, n: number) => ["France", "Germany", "Japan", "Brazil", "Kenya"].filter((name) => countryIndex.byCode.get(code)?.name !== name)[n]!;
  return { screen, $, input, ready, currentCode, guess, wrongName, onComplete };
}

describe("Street View country run", () => {
  it("renders in the GameBar layout with a Best badge, not a Practice / Ranked choice", async () => {
    const ui = setup();
    expect(ui.screen.element.dataset.shell).toBe("game");
    expect(ui.$(".shell-gamebar .shell-switcher-name")?.textContent).toBe("Street View country");
    expect(ui.$(".shell-run-pill")?.dataset.run).toBe("single");
    expect(ui.$(".shell-run-option")).toBeNull();
  });

  it("ends after 5 countries on results with the correct count, guesses and Atlas links", async () => {
    const openCountry = vi.fn();
    const ui = setup({ shell: { openCountry } });
    const codes: string[] = [];

    // Rounds 1–3: correct first time.
    for (let i = 0; i < 3; i++) {
      await ui.ready();
      const code = ui.currentCode();
      codes.push(code);
      ui.guess(countryIndex.byCode.get(code)!.name);
    }
    // Round 4: three wrong guesses.
    await ui.ready();
    codes.push(ui.currentCode());
    for (let n = 0; n < 3; n++) {
      await ui.ready();
      ui.guess(ui.wrongName(codes[3]!, n));
    }
    const next = ui.$<HTMLButtonElement>(".streetview-panel .actions .primary-action")!;
    expect(next.hidden).toBe(false);
    expect(next.textContent).toBe("Next country");
    next.click();
    // Round 5: reveal.
    await ui.ready();
    codes.push(ui.currentCode());
    ui.$<HTMLButtonElement>(".streetview-panel .actions .ghost-action:last-child")!.click();
    expect(next.textContent).toBe("See results");
    next.click();

    const stage = ui.$(".gb-results-stage")!;
    expect(stage.hidden).toBe(false);
    const stats = [...stage.querySelectorAll(".shell-results-stat strong")].map((node) => node.textContent);
    // 3 first-guess countries (3 points each), one missed, one revealed; best on this device = this run.
    expect(stats).toEqual(["9", `3/${STREETVIEW_RUN_LENGTH}`, "6", "9"]);
    const chips = [...stage.querySelectorAll<HTMLButtonElement>(".shell-results-missed [data-country]")];
    expect(chips.map((chip) => chip.dataset.country)).toEqual(codes);
    chips[3]!.click();
    expect(openCountry).toHaveBeenCalledWith(codes[3]);

    stage.querySelector<HTMLButtonElement>(".shell-results-primary")!.click();
    expect(stage.hidden).toBe(true);
    await ui.ready();
    expect(ui.$(".streetview-stats .stat-value")?.textContent).toBe(`1 / ${STREETVIEW_RUN_LENGTH}`);
  });

  it("uses the focus layout inside the daily challenge", async () => {
    const ui = setup({ daily: true });
    expect(ui.screen.element.dataset.shell).toBe("focus");
    expect(ui.$(".shell-gamebar")).toBeNull();
    expect(ui.$(".shell-focusbar .gb-daily-count")?.textContent).toBe("Round 10 of 10");
    await ui.ready();
    ui.guess(countryIndex.byCode.get(ui.currentCode())!.name);
    // The result is queued: the answer stays up until the player asks for results.
    expect(ui.onComplete).not.toHaveBeenCalled();
    const next = ui.$<HTMLButtonElement>(".streetview-panel .actions .primary-action")!;
    expect(next.hidden).toBe(false);
    expect(next.textContent).toBe("See results");
    next.click();
    expect(ui.onComplete).toHaveBeenCalledWith({ missed: false, wrongGuesses: 0 });
    next.click();
    expect(ui.onComplete).toHaveBeenCalledOnce();
  });

  it("shows the daily answer after the last wrong guess and completes only on See results", async () => {
    const ui = setup({ daily: true });
    await ui.ready();
    const code = ui.currentCode();
    const next = ui.$<HTMLButtonElement>(".streetview-panel .actions .primary-action")!;
    for (let n = 0; n < 3; n++) {
      expect(next.hidden).toBe(true);
      await ui.ready();
      ui.guess(ui.wrongName(code, n));
    }
    const answer = countryIndex.byCode.get(code)!.name;
    expect(ui.onComplete).not.toHaveBeenCalled();
    expect(ui.$(".feedback")?.textContent).toBe(`Not ${ui.wrongName(code, 2)}. Answer — ${answer}.`);
    expect(ui.$(".streetview-result")?.textContent).toBe(`Answer — ${answer}.`);
    expect(ui.input.disabled).toBe(true);
    // Fullscreen shortens the label.
    ui.$<HTMLButtonElement>(".streetview-fullscreen-action")!.click();
    expect(next.textContent).toBe("Results");
    next.click();
    expect(ui.onComplete).toHaveBeenCalledWith({ missed: true, wrongGuesses: 3 });
  });

  it("waits after Reveal in the daily and says Continue when later rounds remain", async () => {
    const onComplete = vi.fn();
    const dailyRound = streetViewCountryRounds.find((round) => round.frames.length === 3 && countryIndex.byCode.has(round.countryCode))!;
    const screen = createStreetViewCountryScreen({
      shell: stubShell(), countryIndex, onGameModeChange() {}, onHome() {}, onMultiplayer() {}, onDailyChallenge() {},
      dailyChallenge: { date: "2026-09-27", round: dailyRound, onComplete, progress: { round: 4, total: 10 } },
    }, services);
    screens.push(screen);
    document.body.append(screen.element);
    const input = screen.element.querySelector<HTMLInputElement>("#streetview-guess-input")!;
    await vi.waitFor(() => expect(input.disabled).toBe(false));
    screen.element.querySelector<HTMLButtonElement>(".streetview-panel .actions .ghost-action:last-child")!.click();
    expect(onComplete).not.toHaveBeenCalled();
    const next = screen.element.querySelector<HTMLButtonElement>(".streetview-panel .actions .primary-action")!;
    expect(next.textContent).toBe("Continue daily challenge");
    next.click();
    expect(onComplete).toHaveBeenCalledWith({ missed: true, wrongGuesses: 0 });
  });

  it("explains a missing Street View key inside the GameBar layout", () => {
    const openGame = vi.fn();
    const screen = createStreetViewCountryScreen({ shell: stubShell({ openGame }), countryIndex, onGameModeChange() {}, onHome() {}, onMultiplayer() {}, onDailyChallenge() {} }, { ...services, apiKey: "" });
    screens.push(screen);
    expect(screen.element.dataset.shell).toBe("game");
    expect(screen.element.querySelector<HTMLElement>(".streetview-missing-key")?.hidden).toBe(false);
    expect(screen.element.querySelector<HTMLElement>(".streetview-panel")?.hidden).toBe(true);
    screen.element.querySelector<HTMLButtonElement>(".streetview-missing-actions .primary-action")!.click();
    expect(openGame).toHaveBeenCalledWith("flags");
  });
});

describe("Street View country scoring (single-run: every run counts)", () => {
  it("scores 3/2/1/0 points per country", () => {
    expect([1, 2, 3, null].map(streetViewCountryPoints)).toEqual([3, 2, 1, 0]);
  });

  it("plays five countries for points and posts every finished run", async () => {
    const postAttempt = vi.fn<PostRankedAttempt>(async () => ({ serverAccepted: true, rank: 5 }));
    const openCompete = vi.fn();
    const ui = setup({ postAttempt, shell: { openCompete, signedIn: () => true } });
    expect(ui.$(".streetview-rules")?.textContent).toContain("3 / 2 / 1 points");

    // Country 1: first guess (3). Country 2: second guess (2). Country 3: third guess (1).
    for (let wrong = 0; wrong < 3; wrong++) {
      await ui.ready();
      const code = ui.currentCode();
      for (let n = 0; n < wrong; n++) { ui.guess(ui.wrongName(code, n)); await ui.ready(); }
      ui.guess(countryIndex.byCode.get(code)!.name);
    }
    await ui.ready();
    expect(ui.$(".streetview-points")?.textContent).toBe("6");
    // Country 4: revealed (0). Country 5: first guess (3).
    ui.$<HTMLButtonElement>(".streetview-panel .actions .ghost-action:last-child")!.click();
    ui.$<HTMLButtonElement>(".streetview-panel .actions .primary-action")!.click();
    await ui.ready();
    ui.guess(countryIndex.byCode.get(ui.currentCode())!.name);

    const stage = ui.$(".gb-results-stage")!;
    await vi.waitFor(() => expect(stage.hidden).toBe(false));
    expect(stage.querySelector(".shell-results-kicker")?.textContent).toBe("Street View country");
    expect(stage.querySelector(".shell-results-stat.is-hero strong")?.textContent).toBe("9");
    expect([...stage.querySelectorAll(".gb-run-value")].map((node) => node.textContent)).toEqual(["+3", "+2", "+1", "+0", "+3"]);
    expect(postAttempt).toHaveBeenCalledWith({ gameMode: "streetview-country", variant: "", value: 9, isLoggedIn: true });
    await vi.waitFor(() => expect(stage.querySelector(".shell-results-sub")?.textContent).toBe("Posted to the leaderboard — you're #5."));
    expect(stage.querySelector(".shell-results-primary")?.textContent).toBe("Play again");
    expect(stage.querySelector(".shell-results-cross")).toBeNull();
    expect(ui.$(".shell-run-best-value")?.textContent).toBe("9");
    [...stage.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("View leaderboard"))!.click();
    expect(openCompete).toHaveBeenCalledWith("streetview-country");
    expect(STREET_VIEW_ATTEMPT_COUNTRIES).toBe(5);
  });

  it("never asks before leaving, and can restart from the menu", async () => {
    const confirmLeave = vi.fn(async () => false);
    const ui = setup({ shell: { confirmLeave } });
    ui.$<HTMLButtonElement>(".shell-gamebar-more")!.click();
    expect(ui.$(".shell-menu")?.textContent).toContain("Restart run");
    ui.$<HTMLButtonElement>(".shell-gamebar-back")!.click();
    await Promise.resolve();
    expect(confirmLeave).not.toHaveBeenCalled();
  });
});
