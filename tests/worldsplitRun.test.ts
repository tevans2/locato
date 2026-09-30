// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorldSplitScreen } from "../src/ui/screens/WorldSplitScreen";
import { WORLD_SPLIT_ROUNDS } from "../src/core/worldsplit";
import { WORLD_SPLIT_ATTEMPT_ROUNDS } from "../src/core/leaderboards";
import type { WorldCountryFeature } from "../src/core/map";
import type { ShellContext } from "../src/ui/shell/types";
import { RANKED_LEAVE_MESSAGE, type PostRankedAttempt } from "../src/ui/screens/rankedAttempt";

const square = (lng: number, lat: number) => ({ type: "Polygon" as const, coordinates: [[[lng, lat], [lng + 4, lat], [lng + 4, lat + 4], [lng, lat + 4], [lng, lat]]] as [number, number][][] });
const features: WorldCountryFeature[] = [
  { name: "Brazil", code: "BR", continent: "South America", geometry: square(-50, -12) },
  { name: "Argentina", code: "AR", continent: "South America", geometry: square(-65, -35) },
  { name: "France", code: "FR", continent: "Europe", geometry: square(2, 46) },
  { name: "Germany", code: "DE", continent: "Europe", geometry: square(10, 51) },
  { name: "Japan", code: "JP", continent: "Asia", geometry: square(138, 36) },
  { name: "India", code: "IN", continent: "Asia", geometry: square(78, 21) },
  { name: "Nigeria", code: "NG", continent: "Africa", geometry: square(8, 9) },
  { name: "Kenya", code: "KE", continent: "Africa", geometry: square(37, 0) },
  { name: "United States", code: "US", continent: "North America", geometry: square(-100, 38) },
  { name: "Mexico", code: "MX", continent: "North America", geometry: square(-102, 23) },
  { name: "Australia", code: "AU", continent: "Oceania", geometry: square(134, -25) },
  { name: "New Zealand", code: "NZ", continent: "Oceania", geometry: square(172, -41) },
] as unknown as WorldCountryFeature[];

const screens: ReturnType<typeof createWorldSplitScreen>[] = [];
afterEach(() => { for (const screen of screens.splice(0)) screen.destroy(); document.body.replaceChildren(); localStorage.clear(); });

function stubShell(overrides: Partial<ShellContext> = {}): ShellContext {
  return { openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openCompete() {}, openAccount() {}, controls: document.createElement("div"), confirmLeave: async () => true, signedIn: () => false, storage: localStorage, ...overrides };
}

function setup(options: { ranked?: boolean; shell?: Partial<ShellContext>; postAttempt?: PostRankedAttempt } = {}) {
  const screen = createWorldSplitScreen({
    shell: stubShell(options.shell),
    worldCountryFeatures: features,
    storage: localStorage,
    onGameModeChange() {},
    onHome() {},
    ...(options.ranked ? { run: "timed" as const } : {}),
  }, options.postAttempt ? { postAttempt: options.postAttempt } : {});
  screens.push(screen);
  document.body.append(screen.element);
  const $ = <T extends Element = HTMLElement>(selector: string) => screen.element.querySelector<T>(selector);
  /** Nudge the default line into place, lock it, and move on. */
  const playRound = () => {
    $<HTMLButtonElement>(".worldsplit-adjust-button")!.click();
    const [lock, next] = [...screen.element.querySelectorAll<HTMLButtonElement>(".worldsplit-primary")];
    lock!.click();
    const points = Number(/\+(\d+)/.exec($(".worldsplit-result-callout strong")?.textContent ?? "")?.[1] ?? "0");
    next!.click();
    return points;
  };
  return { screen, $, playRound };
}

describe("Worldsplit ranked attempt", () => {
  it("is the standard five rounds under a Ranked pill, with no Restart", () => {
    expect(WORLD_SPLIT_ROUNDS.length).toBeGreaterThanOrEqual(WORLD_SPLIT_ATTEMPT_ROUNDS);
    const ui = setup({ ranked: true });
    expect(ui.$(".shell-run-pill")?.dataset.run).toBe("timed");
    expect(ui.$(".shell-run-pill .shell-run-label")?.textContent).toBe("Ranked");
    expect(ui.$(".worldsplit-progress-label")?.textContent).toBe(`Round 1 of ${WORLD_SPLIT_ATTEMPT_ROUNDS}`);
    expect(ui.screen.element.querySelectorAll(".worldsplit-progress-dot")).toHaveLength(WORLD_SPLIT_ATTEMPT_ROUNDS);
    ui.$<HTMLButtonElement>(".shell-gamebar-more")!.click();
    expect(ui.$(".shell-menu")?.textContent).not.toContain("Restart run");
  });

  it("asks before leaving an attempt, even before the first lock", async () => {
    const confirmLeave = vi.fn(async () => false);
    const goBack = vi.fn();
    const ui = setup({ ranked: true, shell: { confirmLeave, goBack } });
    ui.$<HTMLButtonElement>(".shell-gamebar-back")!.click();
    await vi.waitFor(() => expect(confirmLeave).toHaveBeenCalledWith(RANKED_LEAVE_MESSAGE, expect.anything()));
    expect(goBack).not.toHaveBeenCalled();
  });

  it("posts the total and ends on the ranked results card", async () => {
    const postAttempt = vi.fn<PostRankedAttempt>(async () => ({ serverAccepted: null, rank: 11 }));
    const openCompete = vi.fn();
    const openGame = vi.fn();
    const ui = setup({ ranked: true, postAttempt, shell: { openCompete, openGame } });
    let total = 0;
    for (let i = 0; i < WORLD_SPLIT_ATTEMPT_ROUNDS; i++) total += ui.playRound();
    expect(Number.isFinite(total)).toBe(true);
    const stage = ui.$(".gb-results-stage")!;
    expect(stage.hidden).toBe(false);
    expect(stage.querySelector(".shell-results-kicker")?.textContent).toBe("Worldsplit · Ranked attempt");
    expect(stage.querySelector(".shell-results-stat.is-hero strong")?.textContent).toBe(String(total));
    expect(postAttempt).toHaveBeenCalledWith({ gameMode: "worldsplit", variant: "", value: total, isLoggedIn: false });
    await vi.waitFor(() => expect(stage.querySelector(".shell-results-sub")?.textContent).toBe("That would place #11 on the board. Sign in to post your score to the leaderboard."));
    expect(stage.querySelectorAll(".gb-run-row")).toHaveLength(WORLD_SPLIT_ATTEMPT_ROUNDS);
    expect(stage.textContent).toContain("Share");
    [...stage.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("View leaderboard"))!.click();
    expect(openCompete).toHaveBeenCalledWith("worldsplit");
    stage.querySelector<HTMLButtonElement>(".shell-results-cross")!.click();
    expect(openGame).toHaveBeenCalledWith("worldsplit", "practice");

    const again = stage.querySelector<HTMLButtonElement>(".shell-results-primary")!;
    expect(again.textContent).toBe("Try again");
    again.click();
    expect(stage.hidden).toBe(true);
    expect(ui.$(".worldsplit-progress-label")?.textContent).toBe(`Round 1 of ${WORLD_SPLIT_ATTEMPT_ROUNDS}`);
    expect(ui.$(".worldsplit-running-score")?.textContent).toBe("0 pts");
  });

  it("practice results cross-link to a ranked attempt", () => {
    const openCompete = vi.fn();
    const ui = setup({ shell: { openCompete } });
    for (let i = 0; i < WORLD_SPLIT_ROUNDS.length; i++) ui.playRound();
    const cross = ui.$<HTMLButtonElement>(".gb-results-stage .shell-results-cross")!;
    expect(cross.textContent).toBe("Play a ranked attempt");
    cross.click();
    expect(openCompete).toHaveBeenCalledWith("worldsplit");
    expect(ui.$(".gb-results-stage .shell-results-kicker")?.textContent).toBe("Worldsplit · Practice");
  });
});
