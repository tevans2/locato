// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMultiplayerFlyoverGameView } from "../src/ui/components/MultiplayerFlyoverGameView";
import { FLYOVER_TAKEOFF_COUNTDOWN_MS, buildFlyoverCountries } from "../src/core/flyover";
import type { WorldCountryFeature } from "../src/core/map";
import type { PublicPlayerState, PublicRoomState } from "../src/core/multiplayer";

const square = (lng: number, lat: number) => ({ type: "Polygon" as const, coordinates: [[[lng, lat], [lng + 10, lat], [lng + 10, lat + 10], [lng, lat + 10], [lng, lat]]] });
// Take off over Alpha flying due west: Bravo is straight ahead, Charlie far away.
const features = [
  { name: "Alpha", code: "AA", continent: "Europe", geometry: square(0, 0) },
  { name: "Bravo", code: "BB", continent: "Africa", geometry: square(-30, 0) },
  { name: "Charlie", code: "CC", continent: "Asia", geometry: square(100, 20) },
] as unknown as WorldCountryFeature[];
const alpha = buildFlyoverCountries(features)[0]!;

const controllers: AbortController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
  document.body.replaceChildren();
});

const player = (id: string, name: string, extra: Partial<PublicPlayerState> = {}): PublicPlayerState => ({ id, name, connected: true, ready: true, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0, ...extra });

function setup(players: readonly PublicPlayerState[] = [player("me", "Me"), player("rival", "Rival")]) {
  let time = 100_000;
  let frames: (() => void)[] = [];
  const onPosition = vi.fn();
  const onReach = vi.fn();
  const onSkip = vi.fn();
  const controller = new AbortController();
  controllers.push(controller);
  const view = createMultiplayerFlyoverGameView({
    signal: controller.signal,
    worldCountryFeatures: features,
    onPosition,
    onReach,
    onSkip,
    now: () => time,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => undefined,
  });
  document.body.append(view.element);
  const takeoffAt = time + FLYOVER_TAKEOFF_COUNTDOWN_MS;
  const room: PublicRoomState = {
    roomCode: "FLY01",
    hostPlayerId: "me",
    categoryIds: ["flyover"],
    settings: { roundLimit: 1, roundDurationMs: 60_000 },
    status: "playing",
    players,
    round: {
      roundNumber: 1,
      prompt: { kind: "flyover-flight", value: JSON.stringify({ start: { x: alpha.centre[0], y: alpha.centre[1], heading: Math.PI }, route: ["BB", "CC"] }) },
      startedAt: takeoffAt,
      endsAt: takeoffAt + 60_000,
    },
    skipVotes: [],
    skipRequired: 0,
    phaseStartedAt: takeoffAt,
    phaseEndsAt: takeoffAt + 60_000,
    chatMessages: [],
  };
  view.update({ room, localPlayerId: "me", round: room.round, canSubmit: true });
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => view.element.querySelector<T>(selector);
  const frame = (ms = 50) => {
    time += ms;
    const run = frames;
    frames = [];
    for (const callback of run) callback();
  };
  const fly = (seconds: number) => { for (let t = 0; t < seconds * 1000; t += 50) frame(50); };
  return { view, room, $, frame, fly, onPosition, onReach, onSkip };
}

describe("Flyover race view", () => {
  it("counts down, then takes off towards the first country on the shared route", () => {
    const ui = setup();
    expect(ui.$(".flyover-ready")?.hidden).toBe(false);
    expect(ui.$(".flyover-countdown")?.textContent).toBe("3");
    expect(ui.$(".flyover-clock-value")?.textContent).toBe("1:00");
    ui.fly(1.2);
    expect(ui.$(".flyover-countdown")?.textContent).toBe("2");
    ui.fly(2);
    expect(ui.$(".flyover-ready")?.hidden).toBe(true);
    expect(ui.$(".flyover-target-name")?.textContent).toBe("Bravo");
  });

  it("claims a reach straight away and moves on, then rolls back if the server says no", () => {
    const ui = setup();
    ui.fly(3.1);
    ui.fly(2.5);
    expect(ui.onReach).toHaveBeenCalledTimes(1);
    expect(ui.onReach.mock.calls[0]![0]).toBe(0);
    expect(ui.$(".flyover-target-name")?.textContent).toBe("Charlie");
    expect(ui.$(".flyover-standing.is-local .flyover-standing-score")?.textContent).toBe("1");

    ui.view.applyProgress({ type: "FLYOVER_PROGRESS", playerId: "me", index: 0, score: 0, event: "sync" });
    expect(ui.$(".flyover-target-name")?.textContent).toBe("Bravo");
    expect(ui.$(".flyover-standing.is-local .flyover-standing-score")?.textContent).toBe("0");
  });

  it("updates rivals' scores live and ranks the standings", () => {
    const ui = setup();
    ui.view.applyProgress({ type: "FLYOVER_PROGRESS", playerId: "rival", index: 2, score: 2, event: "reached" });
    const rows = [...ui.view.element.querySelectorAll(".flyover-standing")].map((row) => row.textContent);
    expect(rows).toEqual(["1Rival2", "2You0"]);
  });

  it("skips into a holding pattern and reports the skipped route position", () => {
    const ui = setup();
    ui.fly(3.1);
    ui.$<HTMLButtonElement>(".flyover-skip")!.click();
    expect(ui.onSkip).toHaveBeenCalledWith(0);
    expect(ui.$(".flyover-target-name")?.textContent).toBe("Charlie");
    expect(ui.$(".flyover-skip")?.textContent).toContain("5s hold");
  });

  it("reports the plane about five times a second, and draws rivals without counting yourself", () => {
    const ui = setup();
    ui.fly(3.1);
    ui.onPosition.mockClear();
    ui.fly(1);
    expect(ui.onPosition.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(ui.onPosition.mock.calls.length).toBeLessThanOrEqual(6);
    expect(() => ui.view.setPlanes([{ playerId: "rival", x: 400, y: 200, heading: 0 }, { playerId: "me", x: 1, y: 1, heading: 0 }])).not.toThrow();
  });

  it("rejoining mid-flight resumes from the server's place on the route", () => {
    const ui = setup([player("me", "Me", { score: 1, routeIndex: 1 }), player("rival", "Rival")]);
    ui.fly(3.1);
    expect(ui.$(".flyover-target-name")?.textContent).toBe("Charlie");
    expect(ui.$(".flyover-standing.is-local .flyover-standing-score")?.textContent).toBe("1");
  });

  it("steers with the arrow keys while the game-over card waits hidden, and not while it shows", () => {
    // The lobby mounts its game-over dialog up front and hides it until the race ends.
    const backdrop = document.createElement("div");
    backdrop.hidden = true;
    backdrop.innerHTML = '<div role="dialog" aria-modal="true"></div>';
    document.body.append(backdrop);
    const ui = setup();
    ui.fly(3.1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    ui.fly(2.5);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    // Turning the whole way, the plane never flies straight on into Bravo.
    expect(ui.onReach).not.toHaveBeenCalled();

    const flying = setup();
    backdrop.hidden = false;
    flying.fly(3.1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    flying.fly(2.5);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    expect(flying.onReach).toHaveBeenCalledTimes(1);
  });

  it("lets go of the lobby's focused button at take-off, so Space boosts instead of pressing it", () => {
    const start = document.createElement("button");
    document.body.append(start);
    const ui = setup();
    start.focus();
    expect(document.activeElement).toBe(start);
    ui.fly(3.1);
    expect(document.activeElement).not.toBe(start);
  });

  it("lands when the clock runs out", () => {
    const ui = setup();
    ui.fly(3.1);
    ui.frame(60_000);
    expect(ui.$(".flyover-target-name")?.textContent).toBe("Landing…");
    expect(ui.$(".flyover-stage")?.classList.contains("is-flying")).toBe(false);
  });
});
