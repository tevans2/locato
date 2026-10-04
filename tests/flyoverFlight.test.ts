// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlyoverFlight } from "../src/ui/components/FlyoverFlight";
import { FLYOVER_SPEED, buildFlyoverCountries, wrappedDeltaX } from "../src/core/flyover";
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
    skipLabel: "Skip", flightSeconds: 90, signal: controller.signal, authoritative: true,
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

describe("authoritative Flyover presentation", () => {
  it("keeps moving between delayed snapshots without jumping backwards when they arrive", () => {
    const ui = setup();
    let previous = ui.flight.plane();
    for (let frame = 1; frame <= 120; frame++) {
      const shown = ui.frame();
      expect(wrappedDeltaX(previous.x, shown.x)).toBeGreaterThan(0);
      expect(wrappedDeltaX(previous.x, shown.x)).toBeLessThan(1);
      if (frame % 9 === 0) {
        // A server position 100ms old, delivered every 150ms.
        ui.flight.setPlane({ x: 500 + FLYOVER_SPEED * (frame / 60 - 0.1), y: 250, heading: 0 }, 100);
        expect(ui.flight.plane()).toEqual(shown);
      }
      previous = shown;
    }
    expect(ui.flight.plane().x).toBeCloseTo(584, 1);
  });

  it("smoothly corrects a divergent prediction across the wrapping map", () => {
    const ui = setup({ x: 998, y: 250, heading: Math.PI - 0.02 });
    const before = ui.flight.plane();
    ui.flight.setPlane({ x: 2, y: 250, heading: -Math.PI + 0.02 });
    expect(ui.flight.plane()).toEqual(before);
    const after = ui.frame();
    expect(Math.abs(wrappedDeltaX(before.x, after.x))).toBeLessThan(2);
    expect(Math.abs(Math.atan2(Math.sin(after.heading - before.heading), Math.cos(after.heading - before.heading)))).toBeLessThan(0.1);
    for (let i = 0; i < 60; i++) ui.frame();
    const expectedX = 2 + Math.cos(-Math.PI + 0.02) * FLYOVER_SPEED * (61 / 60);
    expect(Math.abs(wrappedDeltaX(expectedX, ui.flight.plane().x))).toBeLessThan(0.1);
  });

  it("steers on the next animation frame even while waiting for the server", () => {
    const ui = setup();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(ui.frame().heading).toBeGreaterThan(0);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    const heading = ui.flight.plane().heading;
    expect(ui.frame().heading).toBeCloseTo(heading);
  });

  it("does not undo active steering when a reply still has the old heading", () => {
    const ui = setup();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    for (let i = 0; i < 12; i++) ui.frame();
    const before = ui.flight.plane();
    ui.flight.setPlane({ ...before, heading: 0 });
    expect(ui.flight.plane()).toEqual(before);
    expect(ui.frame().heading).toBeGreaterThan(before.heading);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
  });

  it("clears a pending correction when restarting the flight", () => {
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

  it("keeps the current target stable on repeated server updates and animates a real change", () => {
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

  it("never awards local touches in an authoritative flight", () => {
    const country = countries[0]!;
    const ui = setup({ x: country.centre[0], y: country.centre[1], heading: 0 });
    ui.flight.setTarget(country);
    ui.frame();
    expect(ui.onReach).not.toHaveBeenCalled();
    expect(ui.flight.target()).toBe(country);
  });
});
