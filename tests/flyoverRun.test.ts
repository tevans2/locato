// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlyoverScreen } from "../src/ui/screens/FlyoverScreen";
import { FLYOVER_RUN_SECONDS, FLYOVER_SKIP_PENALTY_SECONDS } from "../src/core/flyover";
import type { WorldCountryFeature } from "../src/core/map";
import type { ShellContext } from "../src/ui/shell/types";
import type { PostRankedAttempt } from "../src/ui/screens/rankedAttempt";

const square = (lng: number, lat: number) => ({ type: "Polygon" as const, coordinates: [[[lng, lat], [lng + 10, lat], [lng + 10, lat + 10], [lng, lat + 10], [lng, lat]]] });
// rng() = 0 starts over Alpha flying due west, and always picks the nearest target: Bravo, due west.
const features = [
  { name: "Alpha", code: "AA", continent: "Europe", geometry: square(0, 0) },
  { name: "Bravo", code: "BB", continent: "Africa", geometry: square(-30, 0) },
  { name: "Charlie", code: "CC", continent: "Asia", geometry: square(100, 20) },
] as unknown as WorldCountryFeature[];

const screens: ReturnType<typeof createFlyoverScreen>[] = [];
afterEach(() => { for (const screen of screens.splice(0)) screen.destroy(); document.body.replaceChildren(); localStorage.clear(); });

function stubShell(overrides: Partial<ShellContext> = {}): ShellContext {
  return { openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openCompete() {}, openAccount() {}, controls: document.createElement("div"), confirmLeave: async () => true, signedIn: () => false, storage: localStorage, ...overrides };
}

function setup(options: { shell?: Partial<ShellContext>; postAttempt?: PostRankedAttempt } = {}) {
  let time = 1000;
  let frames: (() => void)[] = [];
  const screen = createFlyoverScreen({
    shell: stubShell(options.shell),
    worldCountryFeatures: features,
    storage: localStorage,
    onHome() {},
  }, {
    rng: () => 0,
    now: () => time,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => undefined,
    postAttempt: options.postAttempt ?? (async () => ({ serverAccepted: null, rank: null })),
  });
  screens.push(screen);
  document.body.append(screen.element);
  const $ = <T extends Element = HTMLElement>(selector: string) => screen.element.querySelector<T>(selector);
  /** Advance the clock by `ms` and run one animation frame. */
  const frame = (ms = 50) => {
    time += ms;
    const run = frames;
    frames = [];
    for (const callback of run) callback();
  };
  const fly = (seconds: number) => { for (let t = 0; t < seconds * 1000; t += 50) frame(50); };
  return { screen, $, frame, fly };
}

describe("Flyover", () => {
  it("waits on a briefing until take-off, then names a country and runs the clock", () => {
    const ui = setup();
    expect(ui.$(".flyover-ready")?.hidden).toBe(false);
    expect(ui.$(".flyover-clock-value")?.textContent).toBe("1:30");
    ui.$<HTMLButtonElement>(".flyover-start")!.click();
    expect(ui.$(".flyover-ready")?.hidden).toBe(true);
    expect(ui.$(".flyover-target-name")?.textContent).toBe("Bravo");
    ui.fly(1);
    expect(ui.$(".flyover-clock-value")?.textContent).toBe("1:29");
  });

  it("scores a country when the plane flies over it and names the next", () => {
    const ui = setup();
    ui.$<HTMLButtonElement>(".flyover-start")!.click();
    ui.fly(2.5);
    expect(ui.$(".flyover-score-value")?.textContent).toBe("1");
    expect(ui.$(".flyover-target-name")?.textContent).not.toBe("Bravo");
    expect(ui.$(".flyover-over")?.textContent).toBe("Over Bravo");
  });

  it("starts from the arrow keys and steers with them", () => {
    const ui = setup();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(ui.$(".flyover-ready")?.hidden).toBe(true);
    ui.fly(2.5);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    // Turning the whole time means the plane never reaches Bravo in a straight line.
    expect(ui.$(".flyover-score-value")?.textContent).toBe("0");
  });

  it("skipping costs time and names another country", () => {
    const ui = setup();
    ui.$<HTMLButtonElement>(".flyover-start")!.click();
    ui.$<HTMLButtonElement>(".flyover-skip")!.click();
    expect(ui.$(".flyover-target-name")?.textContent).not.toBe("Bravo");
    ui.frame(0);
    expect(ui.$(".flyover-clock-value")?.textContent).toBe(`1:${String(30 - FLYOVER_SKIP_PENALTY_SECONDS).padStart(2, "0")}`);
  });

  it("posts every finished flight and keeps the best in the bar, never asking before leaving", async () => {
    const confirmLeave = vi.fn(async () => true);
    const postAttempt = vi.fn<PostRankedAttempt>(async () => ({ serverAccepted: null, rank: 4 }));
    const openCompete = vi.fn();
    localStorage.setItem("locato:flyover:best-score:v1", "3");
    const ui = setup({ postAttempt, shell: { confirmLeave, openCompete } });
    expect(ui.$(".shell-run-option")).toBeNull();
    expect(ui.$(".shell-run-best-value")?.textContent).toBe("3");
    ui.$<HTMLButtonElement>(".flyover-start")!.click();
    ui.$<HTMLButtonElement>(".shell-gamebar-back")!.click();
    await Promise.resolve();
    expect(confirmLeave).not.toHaveBeenCalled();

    ui.fly(2.5);
    ui.frame(FLYOVER_RUN_SECONDS * 1000);
    expect(postAttempt).toHaveBeenCalledWith({ gameMode: "flyover", variant: "", value: 1, isLoggedIn: false });
    const stage = ui.$(".gb-results-stage")!;
    expect(stage.hidden).toBe(false);
    expect(stage.querySelector(".shell-results-kicker")?.textContent).toBe("Flyover");
    expect(stage.querySelector(".shell-results-stat.is-hero strong")?.textContent).toBe("1");
    expect(stage.querySelectorAll(".gb-run-row")).toHaveLength(1);
    expect(stage.querySelector(".shell-results-cross")).toBeNull();
    await vi.waitFor(() => expect(stage.querySelector(".shell-results-sub")?.textContent).toContain("#4"));
    [...stage.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("View leaderboard"))!.click();
    expect(openCompete).toHaveBeenCalledWith("flyover");

    const again = stage.querySelector<HTMLButtonElement>(".shell-results-primary")!;
    expect(again.textContent).toBe("Play again");
    again.click();
    expect(stage.hidden).toBe(true);
    expect(ui.$(".flyover-ready")?.hidden).toBe(false);
    expect(ui.$(".flyover-score-value")?.textContent).toBe("0");
    expect(ui.$(".shell-run-best-value")?.textContent).toBe("3");
  });

  it("a better flight becomes the new best", () => {
    localStorage.setItem("locato:ranked-best:flyover:v1", "0");
    const ui = setup({ postAttempt: async () => ({ serverAccepted: null, rank: null }) });
    expect(ui.$(".shell-run-best-value")?.textContent).toBe("—");
    ui.$<HTMLButtonElement>(".flyover-start")!.click();
    ui.fly(2.5);
    ui.frame(FLYOVER_RUN_SECONDS * 1000);
    expect(ui.$(".shell-run-best-value")?.textContent).toBe("1");
    expect(localStorage.getItem("locato:ranked-best:flyover:v1")).toBe("1");
  });
});
