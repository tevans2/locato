// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createFlyoverScreen } from "../src/ui/screens/FlyoverScreen";
import { createRankedGameScreen } from "../src/ui/screens/RankedGameScreen";
import * as flightComponent from "../src/ui/components/FlyoverFlight";
import type { WorldCountryFeature } from "../src/core/map";
import type { ShellContext } from "../src/ui/shell/types";
import type { Screen } from "../src/app/router";

const screens: Screen[] = [];
afterEach(() => { screens.splice(0).forEach((s) => s.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); localStorage.clear(); });
const square = (lng: number, lat: number) => ({ type: "Polygon" as const, coordinates: [[[lng, lat], [lng + 10, lat], [lng + 10, lat + 10], [lng, lat + 10], [lng, lat]]] });
const features = [
  { name: "Alpha", code: "AA", continent: "Europe", geometry: square(0, 0) },
  { name: "Bravo", code: "BB", continent: "Africa", geometry: square(-30, 0) },
  { name: "Charlie", code: "CC", continent: "Asia", geometry: square(100, 20) },
] as unknown as WorldCountryFeature[];

it("gives signed-in and guest flights identical controls, local touches, skips and results with HTTP stalled", async () => {
  let time = 1000;
  let frames: FrameRequestCallback[] = [];
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const fetcher = vi.fn((_path: string, _init?: RequestInit) => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetcher);
  const flights: flightComponent.FlyoverFlight[] = [];
  const createFlight = flightComponent.createFlyoverFlight;
  vi.spyOn(flightComponent, "createFlyoverFlight").mockImplementation((options) => { const flight = createFlight(options); flights.push(flight); return flight; });
  const shell = (signedIn: boolean): ShellContext => ({ signedIn: () => signedIn, storage: localStorage, controls: document.createElement("div"), openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openLeaderboards() {}, openAccount() {}, confirmLeave: async () => true });
  const signedIn = await createRankedGameScreen({ mode: "flyover", shell: shell(true), world: features, storage: localStorage, getAuthUser: () => null });
  const guest = createFlyoverScreen({ shell: shell(false), storage: localStorage, worldCountryFeatures: features, onHome() {} });
  screens.push(signedIn, guest);
  document.body.append(signedIn.element, guest.element);
  const frame = (ms = 50) => { time += ms; const pending = frames; frames = []; pending.forEach((callback) => callback(time)); expect(flights[0]!.plane()).toEqual(flights[1]!.plane()); };
  for (const screen of screens) screen.element.querySelector<HTMLButtonElement>(".flyover-start")!.click();
  expect(flights.every((f) => f.isFlying())).toBe(true);
  for (let i = 0; i < 50; i++) frame();
  for (const screen of screens) {
    expect(screen.element.querySelector(".flyover-score-value")?.textContent).toBe("1");
    expect(screen.element.querySelector(".flyover-target-name")?.textContent).toBe("Alpha");
  }
  const updatePlane = flights.map((flight) => vi.spyOn(flight, "setPlane"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
  const before = flights[0]!.plane();
  for (let i = 0; i < 25; i++) frame();
  expect(flights[0]!.plane().heading).not.toBe(before.heading);
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" }));
  for (let i = 0; i < 20; i++) frame();
  expect(updatePlane.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  expect(fetcher.mock.calls.some(([path]) => String(path).startsWith("/api/ranked/"))).toBe(false);
  for (const screen of screens) screen.element.querySelector<HTMLButtonElement>(".flyover-skip")!.click();
  expect(flights[0]!.endsAt()).toBe(86000);
  expect(flights[1]!.endsAt()).toBe(86000);
  for (const screen of screens) {
    expect(screen.element.querySelector(".flyover-target-name")?.textContent).toBe("Charlie");
    screen.element.querySelector<HTMLButtonElement>(".flyover-skip")!.click();
    expect(screen.element.querySelector(".shell-results")).not.toBeNull();
  }
  expect(flights.every((f) => !f.isFlying())).toBe(true);
  expect(fetcher.mock.calls.filter(([path]) => path === "/api/leaderboard")).toHaveLength(1);
});
