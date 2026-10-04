import { describe, expect, it } from "vitest";
import { buildFlyoverCountries, buildFlyoverRoute, FLYOVER_SKIP_HOLD_SECONDS, FLYOVER_TAKEOFF_COUNTDOWN_MS, isPlausibleReach, wrappedDistance } from "../src/core/flyover";
import { createSeededRandom } from "../src/core/game/random";
import { parseClientMessage, parseServerMessage, type FlyoverFlightPrompt, type ServerMessage } from "../src/core/multiplayer";
import type { WorldCountryFeature } from "../src/core/map";
import { FlyoverRoom } from "../server/rooms/FlyoverRoom";
import { RoomManager, type MultiplayerConnection } from "../server/rooms/RoomManager";

const square = (lng: number, lat: number) => ({ type: "Polygon" as const, coordinates: [[[lng, lat], [lng + 10, lat], [lng + 10, lat + 10], [lng, lat + 10], [lng, lat]]] });
// Four countries a quarter of the world apart, so no hop is quicker than ~2 seconds.
const countries = buildFlyoverCountries([
  { name: "Alpha", code: "AA", continent: "Europe", geometry: square(-140, 0) },
  { name: "Bravo", code: "BB", continent: "Africa", geometry: square(-50, 0) },
  { name: "Charlie", code: "CC", continent: "Asia", geometry: square(40, 0) },
  { name: "Delta", code: "DD", continent: "Oceania", geometry: square(130, 0) },
] as unknown as WorldCountryFeature[]);
const byCode = (code: string) => countries.find((country) => country.code === code)!;

function messagesOf(result: ReturnType<FlyoverRoom["startGame"]>): readonly ServerMessage[] {
  return result.ok ? result.messages : [];
}

function replyOf(result: ReturnType<FlyoverRoom["startGame"]>): readonly ServerMessage[] {
  return result.ok ? (result.reply ?? []) : [];
}

function startedRoom(flightMs?: number) {
  const room = new FlyoverRoom({ code: "FLY01", hostPlayerId: "host", hostName: "Host", countries, seed: "seed", now: 0, ...(flightMs ? { flightMs } : {}) });
  room.addPlayer("guest", "Guest", 10);
  room.setReady("guest", true, 20);
  const started = room.startGame("host", 1000);
  const round = messagesOf(started).find((message) => message.type === "GAME_STARTED");
  const prompt = JSON.parse(round && round.type === "GAME_STARTED" ? round.round.prompt.value : "{}") as FlyoverFlightPrompt;
  return { room, started, round, prompt, takeoffAt: 1000 + FLYOVER_TAKEOFF_COUNTDOWN_MS };
}

describe("flyover race route", () => {
  it("is the same for the same seed, visits every country once and starts off-route", () => {
    const a = buildFlyoverRoute(countries, createSeededRandom("x"));
    const b = buildFlyoverRoute(countries, createSeededRandom("x"));
    expect(a.route.map((country) => country.code)).toEqual(b.route.map((country) => country.code));
    expect(a.start).toEqual(b.start);
    const codes = a.route.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(3);
  });

  it("turns down reaches in the wrong place or quicker than a plane can fly", () => {
    const bravo = byCode("BB");
    expect(isPlausibleReach(bravo, bravo.centre, byCode("AA").centre, 10)).toBe(true);
    expect(isPlausibleReach(bravo, byCode("CC").centre, byCode("AA").centre, 10)).toBe(false);
    expect(isPlausibleReach(bravo, bravo.centre, byCode("AA").centre, 0)).toBe(false);
  });
});

// These are server fixtures, so inspecting the private engine supplies a known target for
// legitimate steering. The public prompt deliberately contains no future route.
function pilot(room: FlyoverRoom, playerId: string, takeoffAt: number, wanted = 1) {
  const engines = (room as unknown as { engines: Map<string, { plane: { x: number; y: number }; target: typeof countries[number] | null }> }).engines;
  const messages: ServerMessage[] = [];
  let time = takeoffAt;
  while ((room.snapshot().players.find((p) => p.id === playerId)?.score ?? 0) < wanted && time < takeoffAt + 45_000) {
    const engine = engines.get(playerId)!;
    if (!engine.target) break;
    let dx = engine.target.centre[0] - engine.plane.x;
    if (dx > 500) dx -= 1000;
    if (dx < -500) dx += 1000;
    const heading = Math.atan2(engine.target.centre[1] - engine.plane.y, dx);
    messages.push(...messagesOf(room.steer(playerId, { turn: 0, towards: heading, boost: true }, time)));
    time += 100;
  }
  return { time, messages };
}

describe("flyover room", () => {
  it("starts together with only the first target disclosed", () => {
    const { round, prompt, takeoffAt } = startedRoom(60_000);
    expect(round && round.type === "GAME_STARTED" && round.round.startedAt).toBe(takeoffAt);
    expect(round && round.type === "GAME_STARTED" && round.round.endsAt).toBe(takeoffAt + 60_000);
    expect(prompt.route).toBeUndefined();
    expect(prompt.target).toEqual(expect.any(String));
    expect(prompt.start.x).toBeGreaterThan(0);
  });

  it("awards touches from normal steering and emits the next target", () => {
    const { room, takeoffAt } = startedRoom();
    const result = pilot(room, "guest", takeoffAt);
    expect(result.messages).toContainEqual(expect.objectContaining({ type: "FLYOVER_PROGRESS", playerId: "guest", index: 1, score: 1, event: "reached", target: expect.any(String) }));
    expect(room.snapshot().players.find((p) => p.id === "guest")).toMatchObject({ score: 1, routeIndex: 1 });
  });

  it("ignores forged reaches and teleported positions", () => {
    const { room, prompt, takeoffAt } = startedRoom();
    const target = byCode(prompt.target!);
    for (const index of [0, 1, 2]) {
      expect(messagesOf(room.reach("guest", index, ...target.centre, takeoffAt + 10_000))).toEqual([]);
      expect(replyOf(room.reach("guest", index, ...target.centre, takeoffAt + 10_000))[0]).toMatchObject({ score: 0, index: 0, event: "sync" });
    }
    room.updatePosition("guest", ...target.centre, 0, takeoffAt + 10_000);
    expect(room.drainPlanes()).toBeNull();
    expect(room.snapshot().players.find((p) => p.id === "guest")?.score).toBe(0);
  });

  it("skips without scoring, enforces the hold, and rejects stale skip indices", () => {
    const { room, takeoffAt } = startedRoom();
    const time = takeoffAt + 1000;
    expect(messagesOf(room.skip("host", 0, time))[0]).toMatchObject({ index: 1, score: 0, event: "skipped" });
    expect(replyOf(room.skip("host", 1, time + 1000))[0]).toMatchObject({ index: 1, score: 0 });
    expect(replyOf(room.skip("host", 0, time + 6000))[0]).toMatchObject({ index: 1, score: 0 });
    expect(messagesOf(room.skip("host", 1, time + FLYOVER_SKIP_HOLD_SECONDS * 1000))[0]).toMatchObject({ index: 2, score: 0 });
  });

  it("relays server positions, freezes after stale controls, and stops on deadline", () => {
    const { room, prompt, takeoffAt } = startedRoom();
    room.steer("host", { turn: 0, boost: true }, takeoffAt);
    room.tick(takeoffAt + 500);
    const first = room.drainPlanes();
    expect(first?.type).toBe("FLYOVER_PLANES");
    if (first?.type !== "FLYOVER_PLANES") throw new Error("No positions");
    expect(first.planes.find((p) => p.playerId === "host")?.x).not.toBe(prompt.start.x);
    room.tick(takeoffAt + 2000);
    const frozen = room.drainPlanes();
    room.tick(takeoffAt + 30_000);
    expect(room.drainPlanes()).toEqual(frozen);
    room.endRound(takeoffAt + 90_000);
    expect(messagesOf(room.steer("host", { turn: 0, boost: true }, takeoffAt + 100_000))).toEqual([]);
  });

  it("ends on server time and ranks verified scores", () => {
    const { room, takeoffAt } = startedRoom();
    pilot(room, "guest", takeoffAt);
    expect(room.pendingTransitionAt).toBe(takeoffAt + 90_000);
    const completed = messagesOf(room.endRound(takeoffAt + 90_000)).find((m) => m.type === "GAME_COMPLETED");
    expect(completed && completed.type === "GAME_COMPLETED" && completed.results[0]).toMatchObject({ name: "Guest", score: 1 });
    expect(room.state).toBe("complete");
    expect(room.snapshot().round).toBeNull();
  });

  it("only offers listed lengths and resets on rematch", () => {
    const room = new FlyoverRoom({ code: "FLY02", hostPlayerId: "host", hostName: "Host", countries, seed: "s", now: 0 });
    expect(room.updateOptions("host", { roundDurationMs: 45_000 }, 1).ok).toBe(false);
    expect(room.updateOptions("host", { roundDurationMs: 120_000 }, 2).ok).toBe(true);
    room.startGame("host", 10);
    room.endRound(200_000);
    expect(room.restart("host", 200_001).ok).toBe(true);
    expect(room.snapshot().players[0]).toMatchObject({ score: 0, routeIndex: 0 });
  });
});

describe("flyover messages", () => {
  it("validates positions, reaches and skips strictly", () => {
    expect(parseClientMessage({ type: "FLYOVER_POSITION", x: 10, y: 20, heading: 1 }).ok).toBe(true);
    expect(parseClientMessage({ type: "FLYOVER_POSITION", x: 1200, y: 20, heading: 1 }).ok).toBe(false);
    expect(parseClientMessage({ type: "FLYOVER_POSITION", x: 10, y: 20, heading: 9 }).ok).toBe(false);
    expect(parseClientMessage({ type: "FLYOVER_REACHED", index: 2, x: 10, y: 20, clientSentAt: 1 }).ok).toBe(true);
    expect(parseClientMessage({ type: "FLYOVER_REACHED", index: 1.5, x: 10, y: 20, clientSentAt: 1 }).ok).toBe(false);
    expect(parseClientMessage({ type: "FLYOVER_SKIP", index: -1 }).ok).toBe(false);
    expect(parseServerMessage({ type: "FLYOVER_PROGRESS", playerId: "p", index: 1, score: 1, event: "reached" }).ok).toBe(true);
    expect(parseServerMessage({ type: "FLYOVER_PROGRESS", playerId: "p", index: 1, score: 1, event: "teleport" }).ok).toBe(false);
    expect(parseServerMessage({ type: "FLYOVER_PLANES", planes: [{ playerId: "p", x: 1, y: 2, heading: 0 }] }).ok).toBe(true);
  });
});

class TestConnection implements MultiplayerConnection {
  readonly authenticatedName: string | null = null;
  readonly messages: ServerMessage[] = [];
  send(message: string): void {
    this.messages.push(JSON.parse(message) as ServerMessage);
  }
  of<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.messages.filter((message): message is Extract<ServerMessage, { type: T }> => message.type === type);
  }
}

describe("flyover room manager", () => {
  it("ignores old cheats and privately delivers current targets on verified progress", () => {
    const manager = new RoomManager({ flyoverCountries: () => countries });
    const host = new TestConnection(), guest = new TestConnection();
    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flyover"], roundDurationMs: 60_000 }, 0);
    const roomCode = host.of("SESSION_ASSIGNED")[0]!.roomCode;
    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode, playerName: "Guest" }, 10);
    manager.handleMessage(guest, { type: "SET_READY", ready: true }, 20);
    manager.handleMessage(host, { type: "START_GAME" }, 1000);
    const round = guest.of("GAME_STARTED")[0]!.round;
    const prompt = JSON.parse(round.prompt.value) as FlyoverFlightPrompt;
    expect(prompt.route).toBeUndefined();
    const [x, y] = byCode(prompt.target!).centre;
    manager.handleMessage(guest, { type: "FLYOVER_REACHED", index: 0, x, y, clientSentAt: 0 }, round.startedAt + 100);
    expect(guest.of("FLYOVER_PROGRESS").at(-1)).toMatchObject({ score: 0 });
    const guestId = guest.of("SESSION_ASSIGNED")[0]!.playerId;
    let plane = prompt.start;
    for (let now = round.startedAt; now < round.startedAt + 30_000; now += 100) {
      let dx = x - plane.x;
      if (dx > 500) dx -= 1000;
      if (dx < -500) dx += 1000;
      manager.handleMessage(guest, { type: "FLYOVER_INPUT", turn: 0, towards: Math.atan2(y - plane.y, dx), boost: true }, now);
      manager.sweep(now);
      plane = guest.of("FLYOVER_PLANES").at(-1)?.planes.find((p) => p.playerId === guestId) ?? plane;
      if (guest.of("FLYOVER_PROGRESS").at(-1)?.score === 1) break;
    }
    expect(guest.of("FLYOVER_PROGRESS").at(-1)).toMatchObject({ score: 1, target: expect.any(String) });
    expect(host.of("FLYOVER_PROGRESS").at(-1)).toMatchObject({ score: 1 });
    expect(host.of("FLYOVER_PROGRESS").at(-1)).not.toHaveProperty("target");
    manager.sweep(round.endsAt!);
    expect(host.of("GAME_COMPLETED")[0]?.results[0]).toMatchObject({ name: "Guest", score: 1 });
  });

  it("refuses Flyover rooms when the map can't load", () => {
    const manager = new RoomManager({ flyoverCountries: () => { throw new Error("missing"); } });
    const host = new TestConnection();
    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flyover"] }, 0);
    expect(host.of("ERROR")[0]?.code).toBe("mode-unavailable");
    expect(manager.stats().rooms).toBe(0);
  });
});

describe("flyover on the real map", async () => {
  const { loadFlyoverCountries } = await import("../server/rooms/flyoverCountries");
  it("loads the map on the server and builds a route through nearly every country", () => {
    const world = loadFlyoverCountries();
    expect(world.length).toBeGreaterThan(190);
    const { route } = buildFlyoverRoute(world, createSeededRandom("world"));
    expect(route.length).toBeGreaterThan(150);
    expect(new Set(route.map((country) => country.code)).size).toBe(route.length);
    // Each hop is picked near the last one, so the first few stay within a short flight.
    for (let index = 1; index < 6; index += 1) expect(wrappedDistance(route[index - 1]!.centre, route[index]!.centre)).toBeLessThan(250);
  });
});

describe("flyover reach checks", () => {
  it("accept every touch the plane itself counts, even a sliver between the touch rings", () => {
    // A thin strip 2.1–2.3 units east of the plane: the plane's 2.2-unit ring touches it, a wider
    // 3.3-unit ring jumps over it.
    const [x, y] = [500, 250];
    const toLng = (px: number) => (px / 1000) * 360 - 180;
    const strip = buildFlyoverCountries([{ name: "Strip", code: "SS", continent: "Asia", geometry: { type: "Polygon", coordinates: [[[toLng(x + 2.1), -20], [toLng(x + 2.3), -20], [toLng(x + 2.3), 40], [toLng(x + 2.1), 40], [toLng(x + 2.1), -20]]] } }] as unknown as WorldCountryFeature[])[0]!;
    expect(isPlausibleReach(strip, [x, y], [x - 100, y], 10)).toBe(true);
  });
});
