// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMysteryScreen } from "../src/ui/screens/MysteryScreen";
import { createDailyMysteryTarget, createMysteryTargets } from "../src/core/mystery";
import { indexCountries, rawCountries } from "../src/core/countries";
import { MYSTERY_ATTEMPT_COUNTRIES } from "../src/core/leaderboards";
import { readMysteryDailyStats } from "../src/storage/mysteryDaily";
import { rankedWorld } from "../server/ranked/assets";
import type { ShellContext } from "../src/ui/shell/types";
import type { PostRankedAttempt } from "../src/ui/screens/rankedAttempt";

const SEED = "mystery-ui";
const targets = createMysteryTargets(SEED);
const index = indexCountries(rawCountries);
const world = rankedWorld();
const nameOf = (code: string) => index.byCode.get(code)!.name;
/** Wrong guesses that are never the hidden country. */
const decoys = (target: string, count: number) => ["NZ", "AU", "IS", "CL", "JP", "ZA", "CA", "MN", "AR"].filter((code) => code !== target).slice(0, count);

const screens: ReturnType<typeof createMysteryScreen>[] = [];
afterEach(() => { for (const screen of screens.splice(0)) screen.destroy(); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); });

function stubShell(overrides: Partial<ShellContext> = {}): ShellContext {
  return { openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openLeaderboards() {}, openAccount() {}, controls: document.createElement("div"), confirmLeave: async () => true, signedIn: () => false, storage: localStorage, ...overrides };
}

function setup(options: { shell?: Partial<ShellContext>; postAttempt?: PostRankedAttempt; today?: string; onPlayRun?: () => void } = {}) {
  const screen = createMysteryScreen({
    shell: stubShell(options.shell), worldCountryFeatures: world, countryIndex: index, storage: localStorage, onGameModeChange() {}, onHome() {},
    ...(options.today ? { today: { date: options.today } } : {}), ...(options.onPlayRun ? { onPlayRun: options.onPlayRun } : {}),
  }, { seed: SEED, postAttempt: options.postAttempt ?? (async () => ({ serverAccepted: null, rank: null })) });
  screens.push(screen);
  document.body.append(screen.element);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => screen.element.querySelector<T>(selector);
  const all = (selector: string) => [...screen.element.querySelectorAll<HTMLElement>(selector)];
  const guess = (code: string) => {
    $<HTMLInputElement>("#mystery-guess-input")!.value = nameOf(code);
    $(".mystery-guess-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  };
  return { screen, $, all, guess };
}

describe("Mystery country (single-run: every run counts)", () => {
  it("hides five countries with a Best badge, and gives clues for every guess", () => {
    const ui = setup();
    const target = targets[0]!;
    expect(ui.$(".shell-run-pill")?.dataset.run).toBe("single");
    expect(ui.$(".mystery-progress-label")?.textContent).toBe(`Country 1 of ${MYSTERY_ATTEMPT_COUNTRIES}`);
    const [first, second] = decoys(target, 2);
    ui.guess(first!);
    ui.guess(second!);
    const rows = ui.all(".mystery-guess");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector(".mystery-guess-name")?.textContent).toBe(nameOf(second!));
    expect(rows[0]!.querySelector(".mystery-guess-distance")?.textContent).toMatch(/^[\d,]+ km$/);
    expect(rows[0]!.querySelector(".mystery-guess-direction")?.getAttribute("aria-label")).toMatch(/^Head (north|south|east|west|north-east|north-west|south-east|south-west)$/);
    expect(rows[0]!.querySelectorAll(".mystery-chip").length).toBeGreaterThanOrEqual(3);
    expect(ui.$(".mystery-known")?.textContent).toMatch(/^It's (landlocked|on the coast) and drives on the (left|right)\.$/);
    expect(ui.$(".mystery-meter-label")?.textContent).toBe("2 of 8");
    expect(ui.all(".world-map-country[class*='is-my-']")).toHaveLength(2);
    ui.guess(first!);
    expect(ui.$(".mystery-feedback")?.textContent).toBe(`You've already guessed ${nameOf(first!)}.`);
    ui.guess(target);
    expect(ui.$(".mystery-outcome-title")?.textContent).toBe("Found it in 3!");
    expect(ui.$(".mystery-outcome-points")?.textContent).toBe("+76 points");
    expect(ui.$(".mystery-answer-name")?.textContent).toBe(nameOf(target));
    expect(ui.all(".world-map-country.is-my-found")).toHaveLength(1);
  });

  it("fills in a country tapped on the map, gives two hints, and gives up after asking", async () => {
    const confirmLeave = vi.fn(async () => true);
    const ui = setup({ shell: { confirmLeave } });
    const target = targets[0]!;
    const tapped = decoys(target, 1)[0]!;
    ui.$(`.world-map-country[data-country-id='${index.byCode.get(tapped)!.id}']`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ui.$<HTMLInputElement>("#mystery-guess-input")!.value).toBe(nameOf(tapped));
    expect(ui.all(".mystery-guess")).toHaveLength(0);
    const hint = ui.$<HTMLButtonElement>(".mystery-hint")!;
    hint.click();
    hint.click();
    expect(ui.all(".mystery-hint-notes li").map((item) => item.textContent)).toEqual([expect.stringMatching(/^It's in .+\.$/), `Its name starts with “${nameOf(target).charAt(0)}”.`]);
    expect(hint.disabled).toBe(true);
    ui.$<HTMLButtonElement>(".mystery-give-up")!.click();
    await vi.waitFor(() => expect(ui.$(".mystery-outcome-title")?.textContent).toBe("Given up"));
    expect(confirmLeave).toHaveBeenCalledWith("This country won't score, and the answer will be shown.", expect.objectContaining({ title: "Give up on this country?" }));
    expect(ui.$(".mystery-answer-name")?.textContent).toBe(nameOf(target));
    expect(ui.all(".world-map-country.is-my-answer")).toHaveLength(1);
  });

  it("ends a country after the eighth wrong guess", () => {
    const ui = setup();
    for (const code of decoys(targets[0]!, 8)) ui.guess(code);
    expect(ui.$(".mystery-outcome-title")?.textContent).toBe("Out of guesses");
    expect(ui.$<HTMLInputElement>("#mystery-guess-input")!.disabled).toBe(true);
  });

  it("posts every finished run and ends on the results card", async () => {
    const postAttempt = vi.fn<PostRankedAttempt>(async () => ({ serverAccepted: null, rank: 2 }));
    const ui = setup({ postAttempt });
    for (const [position, target] of targets.entries()) {
      ui.guess(target);
      expect(ui.$(".mystery-next")?.textContent).toBe(position === targets.length - 1 ? "See final score" : "Next country");
      ui.$<HTMLButtonElement>(".mystery-next")!.click();
    }
    const stage = ui.$(".gb-results-stage")!;
    expect(stage.hidden).toBe(false);
    expect(stage.querySelector(".shell-results-kicker")?.textContent).toBe("Mystery country");
    expect(stage.querySelector(".shell-results-stat.is-hero strong")?.textContent).toBe("500");
    expect(postAttempt).toHaveBeenCalledWith({ gameMode: "mystery", variant: "", value: 500, isLoggedIn: false });
    expect(stage.querySelectorAll(".gb-run-row")).toHaveLength(MYSTERY_ATTEMPT_COUNTRIES);
    stage.querySelector<HTMLButtonElement>(".shell-results-primary")!.click();
    await vi.waitFor(() => expect(stage.hidden).toBe(true));
    expect(ui.$(".mystery-progress-label")?.textContent).toBe(`Country 1 of ${MYSTERY_ATTEMPT_COUNTRIES}`);
  });
});

describe("Mystery country: today's mystery", () => {
  const DATE = "2026-10-14";
  const target = createDailyMysteryTarget(DATE);

  it("resumes, can't be replayed, keeps a streak and copies a spoiler-free result", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const first = setup({ today: DATE });
    expect(first.$(".mystery-eyebrow")?.textContent).toBe("Today's mystery · 14 Oct");
    expect(first.$(".mystery-progress")?.hidden).toBe(true);
    const decoy = decoys(target, 1)[0]!;
    first.guess(decoy);
    first.screen.destroy();

    const onPlayRun = vi.fn();
    const again = setup({ today: DATE, onPlayRun });
    expect(again.all(".mystery-guess-name").map((item) => item.textContent)).toEqual([nameOf(decoy)]);
    again.guess(target);
    expect(again.$(".mystery-outcome-title")?.textContent).toBe("Found it in 2!");
    expect(again.$(".mystery-next")).toBeNull();
    expect(readMysteryDailyStats(localStorage, DATE)).toEqual({ streak: 1, bestStreak: 1, played: 1, solved: 1 });
    const text = again.$(".mystery-share-preview")!.textContent!;
    expect(text.split("\n")[0]).toBe("#locato Mystery #1 2/8");
    expect(text).not.toContain(nameOf(target));
    again.$<HTMLButtonElement>(".mystery-share")!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(text));
    again.$<HTMLButtonElement>(".mystery-play-run")!.click();
    expect(onPlayRun).toHaveBeenCalledOnce();
    again.screen.destroy();

    const done = setup({ today: DATE });
    expect(done.$<HTMLElement>(".mystery-outcome")?.hidden).toBe(false);
    expect(done.$<HTMLElement>(".mystery-play-controls")?.hidden).toBe(true);
  });
});
