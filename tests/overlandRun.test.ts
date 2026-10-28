// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOverlandScreen } from "../src/ui/screens/OverlandScreen";
import { createDailyOverlandRoute, createOverlandRoutes, overlandGraph, overlandRouteBetween, type OverlandRound } from "../src/core/overland";
import { readOverlandDailyStats } from "../src/storage/overlandDaily";
import { indexCountries, rawCountries } from "../src/core/countries";
import { OVERLAND_ATTEMPT_ROUTES } from "../src/core/leaderboards";
import { rankedWorld } from "../server/ranked/assets";
import type { ShellContext } from "../src/ui/shell/types";
import type { PostRankedAttempt } from "../src/ui/screens/rankedAttempt";

const SEED = "overland-ui";
const routes = createOverlandRoutes(SEED);
const graph = overlandGraph();
const index = indexCountries(rawCountries);
const world = rankedWorld();
const nameOf = (code: string) => index.byCode.get(code)!.name;
const ISLANDS = ["JP", "AU", "NZ", "IS", "MG", "LK", "CU", "PH", "FJ", "TW", "SG", "JM"];

const screens: ReturnType<typeof createOverlandScreen>[] = [];
afterEach(() => { for (const screen of screens.splice(0)) screen.destroy(); document.body.replaceChildren(); localStorage.clear(); });

function stubShell(overrides: Partial<ShellContext> = {}): ShellContext {
  return { openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openLeaderboards() {}, openAccount() {}, controls: document.createElement("div"), confirmLeave: async () => true, signedIn: () => false, storage: localStorage, ...overrides };
}

function setup(options: { shell?: Partial<ShellContext>; postAttempt?: PostRankedAttempt } = {}) {
  const screen = createOverlandScreen({
    shell: stubShell(options.shell),
    worldCountryFeatures: world,
    countryIndex: index,
    storage: localStorage,
    onGameModeChange() {},
    onHome() {},
  }, { seed: SEED, postAttempt: options.postAttempt ?? (async () => ({ serverAccepted: null, rank: null })) });
  screens.push(screen);
  document.body.append(screen.element);
  const $ = <T extends Element = HTMLElement>(selector: string) => screen.element.querySelector<T>(selector);
  const all = (selector: string) => [...screen.element.querySelectorAll<HTMLElement>(selector)];
  const input = $<HTMLInputElement>("#overland-guess-input")!;
  const guess = (text: string) => {
    input.value = text;
    $<HTMLFormElement>(".overland-guess-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
  };
  const feedback = () => $(".overland-feedback")?.textContent ?? "";
  /** Name the countries of a shortest route, then move on. */
  const playRoute = (position: number) => {
    const route = routes[position]!;
    for (const code of graph.shortestRoute(route.start, route.end)!.slice(1, -1)) guess(nameOf(code));
    expect($<HTMLElement>(".overland-outcome")!.hidden).toBe(false);
    $<HTMLButtonElement>(".overland-next")!.click();
  };
  return { screen, $, all, input, guess, feedback, playRoute };
}

describe("Overland (single-run: every run counts)", () => {
  it("deals five routes with a Best badge instead of a Practice / Ranked choice", () => {
    expect(routes).toHaveLength(OVERLAND_ATTEMPT_ROUTES);
    localStorage.setItem("locato:ranked-best:overland:v1", "312");
    const ui = setup();
    const [first] = routes;
    expect(ui.$(".shell-run-pill")?.dataset.run).toBe("single");
    expect(ui.$(".shell-run-option")).toBeNull();
    expect(ui.$(".shell-run-best-value")?.textContent).toBe("312");
    expect(ui.$(".overland-progress-label")?.textContent).toBe(`Route 1 of ${OVERLAND_ATTEMPT_ROUTES}`);
    expect(ui.all(".overland-end-name").map((item) => item.textContent)).toEqual([nameOf(first!.start), nameOf(first!.end)]);
    expect(ui.$(".overland-route-detail")?.textContent).toBe(`Name the countries in between. The shortest route crosses ${first!.minimum} countries.`);
    expect(ui.$(".overland-meter-label")?.textContent).toBe(`0 of ${first!.guessesAllowed}`);
    expect(ui.all(".world-map-country.is-ov-start, .world-map-country.is-ov-end")).toHaveLength(2);
    ui.$<HTMLButtonElement>(".shell-gamebar-more")!.click();
    expect(ui.$(".shell-menu")?.textContent).toContain("How to play");
    expect(ui.$(".shell-menu")?.textContent).toContain("Restart run");
  });

  it("colours each guess on the map and in the list, and refuses the ends, repeats and unknown names", () => {
    const ui = setup();
    const [first] = routes;
    const onRoute = graph.shortestRoute(first!.start, first!.end)![1]!;
    ui.guess(nameOf(first!.start));
    expect(ui.feedback()).toBe(`${nameOf(first!.start)} is one end of the route. Name the countries in between.`);
    ui.guess("Atlantis");
    expect(ui.feedback()).toBe("No country called “Atlantis”. Check the spelling.");
    expect(ui.all(".overland-guess")).toHaveLength(0);

    ui.guess(nameOf(onRoute).toLowerCase());
    expect(ui.all(".overland-guess.is-route").map((row) => row.textContent)).toEqual([`1${nameOf(onRoute)}On route`]);
    expect(ui.feedback()).toBe(`${nameOf(onRoute)}: On route.`);
    expect(ui.all(".world-map-country.is-ov-route")).toHaveLength(1);
    ui.guess(nameOf(onRoute));
    expect(ui.feedback()).toBe(`You've already named ${nameOf(onRoute)}.`);

    ui.guess("Japan");
    expect(ui.all(".overland-guess")[1]?.classList.contains("is-off")).toBe(true);
    expect(ui.all(".world-map-country.is-ov-off")).toHaveLength(1);
    expect(ui.$(".overland-meter-label")?.textContent).toBe(`2 of ${first!.guessesAllowed}`);
    expect(ui.all(".overland-pip.is-route, .overland-pip.is-off")).toHaveLength(2);
  });

  it("offers matching countries while typing and adds one from the keyboard", () => {
    const ui = setup();
    const ends = new Set([routes[0]!.start, routes[0]!.end]);
    const pick = ["MN", "CL", "BO"].find((code) => !ends.has(code))!;
    ui.input.value = nameOf(pick).slice(0, 4);
    ui.input.dispatchEvent(new Event("input"));
    expect(ui.all(".overland-suggestion").map((item) => item.textContent)).toContain(nameOf(pick));
    expect(ui.input.getAttribute("aria-expanded")).toBe("true");
    const position = ui.all(".overland-suggestion").findIndex((item) => item.textContent === nameOf(pick));
    for (let step = 0; step <= position; step++) ui.input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(ui.input.getAttribute("aria-activedescendant")).toBe(`overland-suggestions-${position}`);
    ui.$<HTMLFormElement>(".overland-guess-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(ui.all(".overland-guess-name").map((item) => item.textContent)).toEqual([nameOf(pick)]);
    expect(ui.$<HTMLElement>(".overland-suggestions")!.hidden).toBe(true);
    // Ends of the route are never offered.
    ui.input.value = nameOf(routes[0]!.start);
    ui.input.dispatchEvent(new Event("input"));
    expect(ui.all(".overland-suggestion").map((item) => item.textContent)).not.toContain(nameOf(routes[0]!.start));
    ui.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(ui.$<HTMLElement>(".overland-suggestions")!.hidden).toBe(true);
  });

  it("gives three hints in order — an outline, every missing outline, then initials — at a cost", () => {
    const ui = setup();
    const route = routes[0]!;
    const hint = ui.$<HTMLButtonElement>(".overland-hint")!;
    expect(hint.textContent).toBe("Hint 1 of 3: outline the next country−15");
    hint.click();
    expect(ui.all(".world-map-country.is-ov-hinted")).toHaveLength(1);
    expect(ui.$(".overland-hint-note")?.textContent).toBe("Dashed outline on the map: a country you still need.");
    hint.click();
    expect(ui.all(".world-map-country.is-ov-hinted")).toHaveLength(route.minimum);
    hint.click();
    expect(ui.all(".overland-initial")).toHaveLength(route.minimum);
    expect(hint.disabled).toBe(true);
    expect(hint.textContent).toBe("No hints left");
    for (const code of graph.shortestRoute(route.start, route.end)!.slice(1, -1)) ui.guess(nameOf(code));
    expect(ui.$(".overland-outcome-points")?.textContent).toBe("+55 points");
    expect(ui.all(".world-map-country.is-ov-hinted")).toHaveLength(0);
  });

  it("accepts a longer route and shows it beside the shortest one", () => {
    const ui = setup();
    const route = routes[0]!;
    const crossings = graph.distance(route.start, route.end)!;
    const detour = graph.neighbours(route.start).find((code) => code !== route.end && graph.distance(code, route.end) === crossings)!;
    expect(detour).toBeDefined();
    for (const code of [detour, ...graph.shortestRoute(detour, route.end)!.slice(1, -1)]) ui.guess(nameOf(code));
    expect(ui.$(".overland-outcome-title")?.textContent).toBe("Route found");
    expect(ui.$(".overland-outcome-points")?.textContent).toBe("+90 points");
    const count = graph.countShortestRoutes(route.start, route.end);
    expect(ui.all(".overland-chain-label").slice(0, 2).map((label) => label.textContent)).toEqual(["Your route", count === 1 ? "Shortest route" : `A shortest route (1 of ${count})`]);
  });

  it("says when your route was a shortest one and can show every other shortest route", () => {
    const ui = setup();
    const position = routes.findIndex((route) => graph.countShortestRoutes(route.start, route.end) > 1);
    expect(position).toBeGreaterThanOrEqual(0);
    for (let earlier = 0; earlier < position; earlier++) ui.playRoute(earlier);
    const route = routes[position]!;
    const count = graph.countShortestRoutes(route.start, route.end);
    const mine = graph.shortestRoute(route.start, route.end)!;
    for (const code of mine.slice(1, -1)) ui.guess(nameOf(code));
    expect(ui.all(".overland-chain-label")[0]?.textContent).toBe(`Your route · one of ${count} shortest`);
    const toggle = ui.$<HTMLButtonElement>(".overland-all-toggle")!;
    const list = ui.$<HTMLElement>(".overland-all-routes")!;
    expect(toggle.textContent).toBe(`Show all ${count} shortest routes`);
    expect(list.hidden).toBe(true);
    toggle.click();
    expect(list.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(list.querySelectorAll(".overland-chain")).toHaveLength(Math.min(count, 8));
    const others = graph.routeCountries(route.start, route.end).filter((code) => !mine.includes(code));
    expect(ui.all(".world-map-country.is-ov-missed")).toHaveLength(others.length);
    toggle.click();
    expect(list.hidden).toBe(true);
    expect(ui.all(".world-map-country.is-ov-missed")).toHaveLength(0);
  });

  it("gives up a route after asking, scores nothing and reveals a shortest route", async () => {
    const confirmLeave = vi.fn(async () => true);
    const ui = setup({ shell: { confirmLeave } });
    const route = routes[0]!;
    ui.$<HTMLButtonElement>(".overland-give-up")!.click();
    await vi.waitFor(() => expect(ui.$<HTMLElement>(".overland-outcome")!.hidden).toBe(false));
    expect(confirmLeave).toHaveBeenCalledWith("This route won't score, and a shortest route will be shown.", expect.objectContaining({ title: "Give up on this route?", confirmLabel: "Give up" }));
    expect(ui.$(".overland-outcome-title")?.textContent).toBe("Route revealed");
    expect(ui.$(".overland-outcome-points")?.textContent).toBe("No points");
    const shown = ui.$(".overland-chain")!;
    expect(shown.querySelectorAll(".overland-chain-stop")).toHaveLength(route.minimum + 2);
    expect(shown.querySelectorAll(".overland-chain-stop.is-missed")).toHaveLength(route.minimum);
    expect(ui.all(".world-map-country.is-ov-missed")).toHaveLength(route.minimum);
    expect(ui.$(".overland-map")?.classList.contains("has-borders")).toBe(true);
    expect(ui.$(".overland-next")?.textContent).toBe("Next route");
    ui.$<HTMLButtonElement>(".overland-next")!.click();
    expect(ui.$(".overland-progress-label")?.textContent).toBe(`Route 2 of ${OVERLAND_ATTEMPT_ROUTES}`);
    expect(ui.$(".overland-running-score")?.textContent).toBe("0 pts");
    expect(ui.$(".overland-map")?.classList.contains("has-borders")).toBe(false);
  });

  it("keeps the route when giving up is cancelled", async () => {
    const confirmLeave = vi.fn(async () => false);
    const ui = setup({ shell: { confirmLeave } });
    ui.$<HTMLButtonElement>(".overland-give-up")!.click();
    await vi.waitFor(() => expect(confirmLeave).toHaveBeenCalled());
    expect(ui.$<HTMLElement>(".overland-outcome")!.hidden).toBe(true);
    expect(ui.input.disabled).toBe(false);
  });

  it("ends a route when the last guess runs out", () => {
    const ui = setup();
    const route = routes[0]!;
    for (const code of ISLANDS.slice(0, route.guessesAllowed)) ui.guess(nameOf(code));
    expect(ui.$(".overland-outcome-title")?.textContent).toBe("Out of guesses");
    expect(ui.input.disabled).toBe(true);
  });

  it("never asks before leaving: an unfinished run just isn't counted", async () => {
    const confirmLeave = vi.fn(async () => false);
    const goBack = vi.fn();
    const ui = setup({ shell: { confirmLeave, goBack } });
    ui.playRoute(0);
    ui.$<HTMLButtonElement>(".shell-gamebar-back")!.click();
    await vi.waitFor(() => expect(goBack).toHaveBeenCalled());
    expect(confirmLeave).not.toHaveBeenCalled();
  });

  it("posts every finished run and ends on the results card", async () => {
    const postAttempt = vi.fn<PostRankedAttempt>(async () => ({ serverAccepted: null, rank: 4 }));
    const openLeaderboards = vi.fn();
    const ui = setup({ postAttempt, shell: { openLeaderboards } });
    for (let position = 0; position < OVERLAND_ATTEMPT_ROUTES; position++) {
      if (position === OVERLAND_ATTEMPT_ROUTES - 1) {
        const route = routes[position]!;
        for (const code of graph.shortestRoute(route.start, route.end)!.slice(1, -1)) ui.guess(nameOf(code));
        expect(ui.$(".overland-next")?.textContent).toBe("See final score");
        ui.$<HTMLButtonElement>(".overland-next")!.click();
      } else ui.playRoute(position);
    }
    const stage = ui.$(".gb-results-stage")!;
    expect(stage.hidden).toBe(false);
    expect(stage.querySelector(".shell-results-kicker")?.textContent).toBe("Overland");
    expect(stage.querySelector(".shell-results-stat.is-hero strong")?.textContent).toBe("500");
    expect(postAttempt).toHaveBeenCalledWith({ gameMode: "overland", variant: "", value: 500, isLoggedIn: false });
    await vi.waitFor(() => expect(stage.querySelector(".shell-results-sub")?.textContent).toBe("That would place #4 on the board. Sign in to post your score to the leaderboard."));
    expect(stage.querySelectorAll(".gb-run-row")).toHaveLength(OVERLAND_ATTEMPT_ROUTES);
    expect(stage.querySelector(".gb-run-row")?.textContent).toContain(`${nameOf(routes[0]!.start)} → ${nameOf(routes[0]!.end)}`);
    expect(ui.$(".shell-run-best-value")?.textContent).toBe("500");
    [...stage.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("View leaderboard"))!.click();
    expect(openLeaderboards).toHaveBeenCalledWith("overland");

    const again = stage.querySelector<HTMLButtonElement>(".shell-results-primary")!;
    expect(again.textContent).toBe("Play again");
    again.click();
    await vi.waitFor(() => expect(stage.hidden).toBe(true));
    expect(ui.$(".overland-progress-label")?.textContent).toBe(`Route 1 of ${OVERLAND_ATTEMPT_ROUTES}`);
    expect(ui.$(".overland-running-score")?.textContent).toBe("0 pts");
    expect(ui.all(".overland-guess")).toHaveLength(0);
  });

  it("lists the countries missed on routes that weren't found", async () => {
    const ui = setup();
    for (let position = 0; position < OVERLAND_ATTEMPT_ROUTES; position++) {
      for (const code of ISLANDS.slice(0, routes[position]!.guessesAllowed)) ui.guess(nameOf(code));
      ui.$<HTMLButtonElement>(".overland-next")!.click();
    }
    const stage = ui.$(".gb-results-stage")!;
    expect(stage.querySelector(".shell-results-stat.is-hero strong")?.textContent).toBe("0");
    expect(stage.textContent).toContain("Countries you missed");
    expect(stage.textContent).toContain(nameOf(graph.shortestRoute(routes[0]!.start, routes[0]!.end)![1]!));
  });
});

describe("Overland in the daily challenge (round 8)", () => {
  const route = overlandRouteBetween("PT", "PL")!;
  function mountDaily(daily: { onResult?: (round: OverlandRound) => void; onComplete: (round: OverlandRound) => void; practice?: boolean }) {
    const screen = createOverlandScreen({
      worldCountryFeatures: world, countryIndex: index, storage: localStorage, onGameModeChange() {}, onHome() {},
      dailyChallenge: { date: "2026-10-14", title: "Around the Mediterranean", route, progress: { round: 8, total: 10 }, ...daily },
    });
    screens.push(screen);
    document.body.append(screen.element);
    return screen;
  }

  it("plays one route under the daily's bar and scores it out of 10", () => {
    const onResult = vi.fn();
    const onComplete = vi.fn();
    const screen = mountDaily({ onResult, onComplete });
    const $ = <T extends HTMLElement = HTMLElement>(selector: string) => screen.element.querySelector<T>(selector)!;
    expect(screen.element.querySelector(".shell-focusbar")).not.toBeNull();
    expect(screen.element.querySelector(".shell-gamebar")).toBeNull();
    expect($(".gb-daily-count").textContent).toBe("Round 8 of 10");
    expect($(".overland-progress").hidden).toBe(true);
    expect($(".overland-eyebrow").textContent).toBe("Daily challenge · Overland");
    for (const name of ["Italy", "Spain", "France", "Germany"]) {
      $<HTMLInputElement>("#overland-guess-input").value = name;
      $(".overland-guess-form").dispatchEvent(new Event("submit", { cancelable: true }));
    }
    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult.mock.calls[0]![0]).toMatchObject({ status: "solved" });
    expect($(".overland-outcome-points").textContent).toBe("+8 of 10");
    expect($(".overland-next").textContent).toBe("Continue daily challenge");
    $(".overland-next").click();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("says Continue practice when replaying a missed round", () => {
    const screen = mountDaily({ practice: true, onComplete: vi.fn() });
    expect(screen.element.querySelector(".overland-eyebrow")?.textContent).toBe("Daily practice · Overland");
  });
});

describe("Overland: today's route", () => {
  const DATE = "2026-10-14";
  const todays = createDailyOverlandRoute(DATE);
  function mountToday(onPlayRun = vi.fn()) {
    const screen = createOverlandScreen({ shell: stubShell(), worldCountryFeatures: world, countryIndex: index, storage: localStorage, onGameModeChange() {}, onHome() {}, today: { date: DATE }, onPlayRun });
    screens.push(screen);
    document.body.append(screen.element);
    const $ = <T extends HTMLElement = HTMLElement>(selector: string) => screen.element.querySelector<T>(selector);
    const guess = (code: string) => {
      $<HTMLInputElement>("#overland-guess-input")!.value = nameOf(code);
      $(".overland-guess-form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    };
    return { screen, $, guess };
  }

  it("is the same route for everyone that day, longer at the weekend", () => {
    expect(createDailyOverlandRoute(DATE)).toEqual(todays);
    expect(createDailyOverlandRoute("2026-10-12").minimum).toBe(3); // Monday
    expect(createDailyOverlandRoute("2026-10-18").minimum).toBe(6); // Sunday
    expect(graph.distance(todays.start, todays.end)).toBe(todays.minimum + 1);
  });

  it("resumes a route in progress and can't be replayed once it's over", () => {
    const first = mountToday();
    expect(first.$(".overland-eyebrow")?.textContent).toBe("Today's route · 14 Oct");
    expect(first.$(".overland-progress")?.hidden).toBe(true);
    const path = graph.shortestRoute(todays.start, todays.end)!.slice(1, -1);
    first.guess(path[0]!);
    first.screen.destroy();

    const again = mountToday();
    expect([...again.screen.element.querySelectorAll(".overland-guess-name")].map((item) => item.textContent)).toEqual([nameOf(path[0]!)]);
    for (const code of path.slice(1)) again.guess(code);
    expect(again.$(".overland-outcome-title")?.textContent).toBe("Perfect route!");
    expect(again.$(".overland-next")).toBeNull();
    expect(again.$(".overland-today-stats")?.textContent).toContain("Streak1 day");
    expect(readOverlandDailyStats(localStorage, DATE)).toEqual({ streak: 1, bestStreak: 1, played: 1, solved: 1 });
    again.screen.destroy();

    const done = mountToday();
    expect(done.$<HTMLElement>(".overland-outcome")?.hidden).toBe(false);
    expect(done.$<HTMLElement>(".overland-play-controls")?.hidden).toBe(true);
    expect(done.$(".overland-outcome-title")?.textContent).toBe("Perfect route!");
  });

  it("copies the whole result to the clipboard, not just a link, and links to the five-route run", async () => {
    const writeText = vi.fn(async () => undefined);
    const share = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText }, share });
    const onPlayRun = vi.fn();
    const ui = mountToday(onPlayRun);
    const path = graph.shortestRoute(todays.start, todays.end)!.slice(1, -1);
    ui.guess("JP");
    for (const code of path) ui.guess(code);
    const expected = `#locato Overland #1 (+1)\n${nameOf(todays.start)} → ${nameOf(todays.end)}\n🟥${"🟩".repeat(todays.minimum)}\n${window.location.origin}/?game=overland&daily=1&ref=share`;
    expect(ui.$(".overland-share-preview")?.textContent).toBe(expected);
    ui.$<HTMLButtonElement>(".overland-share")!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    expect(share).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ui.$(".overland-share-status")?.textContent).toBe("Copied — paste it anywhere."));
    for (const code of path) expect(expected).not.toContain(nameOf(code));
    ui.$<HTMLButtonElement>(".overland-play-run")!.click();
    expect(onPlayRun).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
