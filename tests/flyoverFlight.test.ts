// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlyoverFlight } from "../src/ui/components/FlyoverFlight";
import { FLYOVER_SPEED, FLYOVER_BOOST, buildFlyoverCountries, wrappedDeltaX } from "../src/core/flyover";
import type { PlaneState } from "../src/core/flyover";
import type { WorldCountryFeature } from "../src/core/map";

const countries = buildFlyoverCountries([
  { name: "Alpha", code: "AA", continent: "Europe", geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
] as WorldCountryFeature[]);
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); vi.restoreAllMocks(); });

function setup(start: PlaneState = { x: 500, y: 250, heading: 0 }) {
  let time = 1000;
  let clockOffset = 0;
  let frames: (() => void)[] = [];
  const controller = new AbortController();
  const onReach = vi.fn();
  const flight = createFlyoverFlight({
    countries, hudRight: document.createElement("div"), overlay: document.createElement("div"),
    skipLabel: "Skip", flightSeconds: 90, signal: controller.signal,
    now: () => time + clockOffset, animationNow: () => time,
    requestFrame: (callback) => { frames.push(callback); return frames.length; }, cancelFrame: () => { frames = []; },
    onReach, onSkip() {}, onTimeUp() {},
  });
  document.body.append(flight.element);
  flight.reset(start);
  flight.fly(time + 90_000);
  cleanups.push(() => { controller.abort(); flight.destroy(); });
  const frame = (ms = 1000 / 60) => {
    time += ms;
    const pending = frames; frames = [];
    pending.forEach((callback) => callback());
    return flight.plane();
  };
  return { flight, frame, onReach, setClockOffset: (offset: number) => { clockOffset = offset; } };
}

describe("local Flyover movement", () => {
  it("moves continuously at the original speed across the wrapping map", () => {
    const ui = setup({ x: 998, y: 250, heading: 0 });
    let previous = ui.flight.plane();
    for (let frame = 0; frame < 120; frame++) {
      const shown = ui.frame();
      expect(wrappedDeltaX(previous.x, shown.x)).toBeCloseTo(FLYOVER_SPEED / 60);
      previous = shown;
    }
    expect(ui.flight.plane().x).toBeCloseTo(82);
  });

  it("boosts immediately and returns to normal speed on release", () => {
    const ui = setup();
    const before = ui.flight.plane();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    const boosted = ui.frame();
    expect(wrappedDeltaX(before.x, boosted.x)).toBeCloseTo(FLYOVER_SPEED * FLYOVER_BOOST / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" }));
    expect(wrappedDeltaX(boosted.x, ui.frame().x)).toBeCloseTo(FLYOVER_SPEED / 60);
  });

  it("steers towards a held map pointer immediately and stops turning on release", () => {
    const ui = setup();
    const canvas = ui.flight.element.querySelector("canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 500));
    canvas.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, clientX: 400, clientY: 450 }));
    expect(ui.frame().heading).toBeGreaterThan(0);
    canvas.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    const heading = ui.flight.plane().heading;
    expect(ui.frame().heading).toBeCloseTo(heading);
  });

  it("steers on the next animation frame even while waiting for the server", () => {
    const ui = setup();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(ui.frame().heading).toBeGreaterThan(0);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    const heading = ui.flight.plane().heading;
    expect(ui.frame().heading).toBeCloseTo(heading);
  });

  it("resets the flight without retaining old movement", () => {
    const ui = setup();
    ui.flight.setPlane({ x: 700, y: 300, heading: 1 });
    const start = { x: 100, y: 250, heading: 0 };
    ui.flight.reset(start);
    expect(ui.flight.plane()).toEqual(start);
    ui.flight.fly(90_000);
    expect(ui.frame().x).toBeCloseTo(start.x + FLYOVER_SPEED / 60);
    expect(ui.flight.plane().heading).toBe(0);
  });

  it("ignores key-release events without a key value", () => {
    const ui = setup();
    expect(() => window.dispatchEvent(new Event("keyup"))).not.toThrow();
    expect(ui.frame().heading).toBe(0);
  });

  it("uses a steady animation clock when server clock estimates change", () => {
    const ui = setup();
    const before = ui.frame();
    ui.setClockOffset(-500);
    const after = ui.frame();
    expect(wrappedDeltaX(before.x, after.x)).toBeCloseTo(FLYOVER_SPEED / 60);
    ui.setClockOffset(500);
    expect(wrappedDeltaX(after.x, ui.frame().x)).toBeCloseTo(FLYOVER_SPEED / 60);
  });

  it("keeps the current target stable on repeated updates and animates a real change", () => {
    const ui = setup();
    const country = countries[0]!;
    ui.flight.setTarget(country);
    const card = ui.flight.element.querySelector<HTMLElement>(".flyover-target")!;
    const flag = ui.flight.element.querySelector<HTMLImageElement>(".flyover-target-flag")!;
    const restartAnimation = vi.spyOn(card.classList, "remove");
    const changeFlag = vi.spyOn(flag, "setAttribute");
    for (let i = 0; i < 10; i++) { ui.frame(); ui.flight.setTarget({ ...country }); }
    expect(restartAnimation).not.toHaveBeenCalled();
    expect(changeFlag).not.toHaveBeenCalled();
    ui.flight.setTarget({ ...country, code: "BB", name: "Bravo" });
    expect(restartAnimation).toHaveBeenCalledOnce();
    expect(card.textContent).toContain("Bravo");
  });

  it("awards a local touch on the same frame and clears its target", () => {
    const country = countries[0]!;
    const ui = setup({ x: country.centre[0], y: country.centre[1], heading: 0 });
    ui.flight.setTarget(country);
    ui.frame();
    expect(ui.onReach).toHaveBeenCalledOnce();
    expect(ui.flight.target()).toBeNull();
  });
});
