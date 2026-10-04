// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createFlyoverScreen } from "../src/ui/screens/FlyoverScreen";
import { RankedSession } from "../src/ui/screens/RankedSession";
import * as flightComponent from "../src/ui/components/FlyoverFlight";
import { FLYOVER_SPEED, wrappedDeltaX } from "../src/core/flyover";
import type { WorldCountryFeature } from "../src/core/map";
import type { RankedState } from "../src/core/ranked";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); localStorage.clear(); });

it("keeps the ranked flight smooth and its target stable while HTTP responses and clock estimates lag", async () => {
  vi.useFakeTimers();
  let localTime = 1000;
  let frames: (() => void)[] = [];
  vi.spyOn(performance, "now").mockImplementation(() => localTime);
  const startState: RankedState = {
    runId: "flight", mode: "flyover", variant: "", status: "playing", startedAt: 100_000,
    serverNow: 100_000, endsAt: 190_000, index: 0, total: 1, score: 0, timeMs: null,
    question: { id: "target", kind: "flight", text: "Alpha" }, plane: { x: 500, y: 250, heading: 0 }, reaches: [],
  };
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const fetcher = vi.fn(async (path: string) => {
    if (path.endsWith("start")) return Response.json(startState);
    const elapsed = localTime - 1000;
    const snapshot = { ...startState, serverNow: 100_000 + elapsed, plane: { x: 500 + FLYOVER_SPEED * elapsed / 1000, y: 250, heading: 0 } };
    await responseGate;
    return Response.json(snapshot);
  });
  vi.stubGlobal("fetch", fetcher);
  let flight!: flightComponent.FlyoverFlight;
  const createFlight = flightComponent.createFlyoverFlight;
  vi.spyOn(flightComponent, "createFlyoverFlight").mockImplementation((options) => { flight = createFlight(options); return flight; });
  const session = new RankedSession("flyover");
  const screen = createFlyoverScreen({
    storage: localStorage, onHome() {}, ranked: session,
    worldCountryFeatures: [{ name: "Alpha", code: "AA", continent: "Europe", geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } }] as WorldCountryFeature[],
  }, { requestFrame: (callback) => { frames.push(callback); return frames.length; }, cancelFrame: () => { frames = []; } });
  document.body.append(screen.element);
  cleanups.push(() => { session.destroy(); screen.destroy(); });
  screen.element.querySelector<HTMLButtonElement>(".flyover-start")!.click();
  await vi.waitFor(() => expect(flight.isFlying()).toBe(true));
  const frame = () => { localTime += 1000 / 60; const pending = frames; frames = []; pending.forEach((callback) => callback()); };
  for (let i = 0; i < 9; i++) frame();
  await vi.advanceTimersByTimeAsync(150);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const card = screen.element.querySelector<HTMLElement>(".flyover-target")!;
  const restartAnimation = vi.spyOn(card.classList, "remove");
  const reconcile = vi.spyOn(flight, "setPlane");
  for (let i = 0; i < 12; i++) frame();
  const beforeReply = flight.plane();
  release();
  await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce());
  expect(reconcile.mock.calls[0]![1]).toBeCloseTo(100);
  expect(flight.plane()).toEqual(beforeReply);
  frame();
  expect(wrappedDeltaX(beforeReply.x, flight.plane().x)).toBeGreaterThan(0);
  expect(wrappedDeltaX(beforeReply.x, flight.plane().x)).toBeLessThan(1);
  expect(restartAnimation).not.toHaveBeenCalled();
  expect(screen.element.querySelector(".flyover-score-value")?.textContent).toBe("0");
  expect(screen.element.querySelector(".flyover-target-name")?.textContent).toBe("Alpha");
});
