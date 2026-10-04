// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMultiplayerFlyoverGameView } from "../src/ui/components/MultiplayerFlyoverGameView";
import { createFlyoverScreen } from "../src/ui/screens/FlyoverScreen";
import { createSeededRandom } from "../src/core/game/random";
import { buildFlyoverCountries } from "../src/core/flyover";
import * as flightPhysics from "../src/core/flyover";
import { FlyoverRoom } from "../server/rooms/FlyoverRoom";
import type { WorldCountryFeature } from "../src/core/map";

const source = readFileSync(resolve(process.env.FLYOVER_TEST_SCRIPT ?? "scripts/flyover-autopilot.js"), "utf8");
const world = JSON.parse(readFileSync(resolve("public/assets/world-map.json"), "utf8")) as WorldCountryFeature[];
const frameMs = Number(process.env.FLYOVER_TEST_FRAME_MS ?? 50);
const cleanups: (() => void)[] = [];
class TestCanvasContext {
  constructor(readonly canvas: HTMLCanvasElement) {}
  arc(..._args: number[]) {}
  rotate(_angle: number) {}
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("Flyover real-control autopilot reproduction", () => {
  it.each(["audit-one", "audit-two", "audit-three"])("the old script cannot obtain a full multiplayer route or claim points (%s)", async (seed) => {
    let time = 100_000;
    let frames: (() => void)[] = [];
    let tick: (() => void) | null = null;
    let tickPeriod = 50, nextTickAt = Infinity;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    vi.stubGlobal("location", new URL("http://localhost:3000"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(world), { status: 200 })));
    vi.stubGlobal("setInterval", (callback: () => void, ms: number) => { tick = callback; tickPeriod = ms; nextTickAt = time + ms; return 1; });
    vi.stubGlobal("clearInterval", () => { tick = null; });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    class TestSocket extends EventTarget {
      url = "ws://localhost:3000/ws";
      sent: string[] = [];
      send(data: string) { this.sent.push(data); }
    }
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubGlobal("CanvasRenderingContext2D", TestCanvasContext);
    const originalSend = TestSocket.prototype.send;
    const socket = new TestSocket();
    const api = await new Function(source.replace("(async () => {", "return (async () => {"))();
    cleanups.push(() => api.stop());
    socket.send(JSON.stringify({ type: "CREATE_ROOM", categoryIds: ["flyover"] }));

    const room = new FlyoverRoom({ code: "TEST1", hostPlayerId: "bot", hostName: "Test bot", countries: buildFlyoverCountries(world), seed, now: time });
    const started = room.startGame("bot", time);
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error("Could not start test room");
    const gameStarted = started.messages.find((message) => message.type === "GAME_STARTED")!;
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(gameStarted) }));
    const controller = new AbortController();
    let rejected = 0;
    let clientArrivals = 0;
    const view = createMultiplayerFlyoverGameView({
      signal: controller.signal,
      worldCountryFeatures: world,
      now: () => time,
      requestFrame: (callback) => { frames.push(callback); return frames.length; },
      cancelFrame: () => undefined,
      onPosition: (plane) => socket.send(JSON.stringify({ type: "FLYOVER_POSITION", ...plane })),
      onSkip: () => { throw new Error("Autopilot must not skip"); },
      onReach: (index, plane) => {
        clientArrivals++;
        socket.send(JSON.stringify({ type: "FLYOVER_REACHED", index, x: plane.x, y: plane.y, clientSentAt: time }));
        const result = room.reach("bot", index, plane.x, plane.y, time);
        if (!result.ok) throw new Error(result.message);
        if (result.reply?.length) rejected++;
        for (const message of [...result.messages, ...(result.reply ?? [])]) {
          if (message.type === "FLYOVER_PROGRESS") view.applyProgress(message);
        }
      },
    });
    cleanups.push(() => { controller.abort(); view.destroy(); });
    document.body.append(view.element);
    const snapshot = room.snapshot();
    view.update({ room: snapshot, localPlayerId: "bot", round: snapshot.round, canSubmit: true });
    const canvas = view.element.querySelector<HTMLCanvasElement>(".flyover-canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON() {} });
    const pointerMoves = vi.fn();
    canvas.addEventListener("pointermove", pointerMoves);

    for (let elapsed = 0; elapsed < 93_000; elapsed += frameMs) {
      time += frameMs;
      const run = frames;
      frames = [];
      for (const frame of run) frame();
      if (tick && time + 1e-6 >= nextTickAt) { nextTickAt += tickPeriod; (tick as () => void)(); }
    }
    const score = room.snapshot().players[0]!.score;
    expect(errors).not.toHaveBeenCalled();
    expect(pointerMoves).not.toHaveBeenCalled();
    expect(score).toBe(0);
    expect(rejected).toBe(0);
    expect(score).toBe(clientArrivals);
    expect(clientArrivals).toBe(0);
    expect(JSON.parse(gameStarted.round.prompt.value)).not.toHaveProperty("route");
    api.stop();
    expect(TestSocket.prototype.send).toBe(originalSend);
    console.log(JSON.stringify({ seed, score, rejected, actualClientArrivals: clientArrivals, fullRouteVisible: false }));
  });

  it.each([
    { seed: "solo-one", speedFactor: 1, radiusFactor: 1, simulationFrameMs: frameMs },
    { seed: "solo-two", speedFactor: 1, radiusFactor: 1, simulationFrameMs: frameMs },
    { seed: "solo-three", speedFactor: 1, radiusFactor: 1, simulationFrameMs: frameMs },
    { seed: "solo-one", speedFactor: 3, radiusFactor: 3, simulationFrameMs: 1000 / 60 },
  ])("flies a solo game using its actual drawings ($seed, speed ×$speedFactor, radius ×$radiusFactor)", async ({ seed, speedFactor, radiusFactor, simulationFrameMs }) => {
    let time = 100_000;
    let frames: (() => void)[] = [];
    let tick: (() => void) | null = null;
    let tickPeriod = 50, nextTickAt = Infinity;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    vi.stubGlobal("location", new URL("http://localhost:3000"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(world), { status: 200 })));
    vi.stubGlobal("setInterval", (callback: () => void, ms: number) => { tick = callback; tickPeriod = ms; nextTickAt = time + ms; return 1; });
    vi.stubGlobal("clearInterval", () => { tick = null; });
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    if (speedFactor !== 1) {
      const step = flightPhysics.stepPlane;
      // Isolated simulation of an altered browser bundle: multiply movement
      // and turning without changing the 90-second clock or posting code.
      vi.spyOn(flightPhysics, "stepPlane").mockImplementation((plane, input, dt) => step(plane, input, dt * speedFactor));
    }
    if (radiusFactor !== 1) {
      const touches = flightPhysics.planeTouchesCountry;
      vi.spyOn(flightPhysics, "planeTouchesCountry").mockImplementation((country, x, y, radius = flightPhysics.FLYOVER_TOUCH_RADIUS) => touches(country, x, y, radius * radiusFactor));
    }
    vi.stubGlobal("CanvasRenderingContext2D", TestCanvasContext);
    class TestPath { moveTo() {} lineTo() {} closePath() {} }
    vi.stubGlobal("Path2D", TestPath);
    const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      if (!contexts.has(this)) contexts.set(this, new Proxy(new TestCanvasContext(this), {
        get(target, property) { return Reflect.has(target, property) ? Reflect.get(target, property) : () => undefined; },
      }) as unknown as CanvasRenderingContext2D);
      return contexts.get(this)!;
    } as unknown as HTMLCanvasElement["getContext"]);
    const arc = TestCanvasContext.prototype.arc;
    const rotate = TestCanvasContext.prototype.rotate;
    const api = await new Function(source.replace("(async () => {", "return (async () => {"))();
    cleanups.push(() => api.stop());
    const posted = vi.fn(async () => ({ serverAccepted: null, rank: null }));
    const screen = createFlyoverScreen({ worldCountryFeatures: world, storage: localStorage, onHome() {} }, {
      rng: createSeededRandom(seed),
      now: () => time,
      requestFrame: (callback) => { frames.push(callback); return frames.length; },
      cancelFrame: () => undefined,
      postAttempt: posted,
    });
    cleanups.push(() => screen.destroy());
    document.body.append(screen.element);
    const canvas = screen.element.querySelector<HTMLCanvasElement>(".flyover-canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON() {} });
    screen.element.querySelector<HTMLButtonElement>(".flyover-start")!.click();
    for (let elapsed = 0; elapsed < 90_100; elapsed += simulationFrameMs) {
      time += simulationFrameMs;
      const run = frames;
      frames = [];
      for (const frame of run) frame();
      if (tick && time + 1e-6 >= nextTickAt) { nextTickAt += tickPeriod; (tick as () => void)(); }
    }
    const score = Number(screen.element.querySelector(".flyover-score-value")!.textContent);
    expect(errors).not.toHaveBeenCalled();
    expect(score).toBeGreaterThan(speedFactor > 1 ? 150 : 70);
    expect(posted).toHaveBeenCalledWith(expect.objectContaining({ gameMode: "flyover", value: score }));
    // Solo needs no route or multiplayer position messages.
    expect(api.status().arrivalClaims).toBe(0);
    expect(api.status().route).toEqual([]);
    api.stop();
    expect(TestCanvasContext.prototype.arc).toBe(arc);
    expect(TestCanvasContext.prototype.rotate).toBe(rotate);
    console.log(JSON.stringify({ seed, soloScore: score, speedFactor, radiusFactor, positionFromCanvas: true }));
  // Keep the complete flight simulation; allow slower CI runners time to render every frame.
  }, 60_000);
});
