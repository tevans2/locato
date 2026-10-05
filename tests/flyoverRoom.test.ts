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

describe("flyover room", () => {
  it("starts everyone together after a countdown, with the shared route in the round", () => {
    const { round, prompt, takeoffAt } = startedRoom(60_000);
    expect(round && round.type === "GAME_STARTED" && round.round.prompt.kind).toBe("flyover-flight");
    expect(round && round.type === "GAME_STARTED" && round.round.startedAt).toBe(takeoffAt);
    expect(round && round.type === "GAME_STARTED" && round.round.endsAt).toBe(takeoffAt + 60_000);
    expect(prompt.route).toHaveLength(3);
    expect(prompt.start.x).toBeGreaterThan(0);
  });

  it("scores a plausible reach and tells the room", () => {
    const { room, prompt, takeoffAt } = startedRoom();
    const target = byCode(prompt.route![0]!);
    const result = room.reach("guest", 0, ...target.centre, takeoffAt + 10_000);
    expect(messagesOf(result)).toEqual([{ type: "FLYOVER_PROGRESS", playerId: "guest", index: 1, score: 1, event: "reached" }]);
    expect(room.snapshot().players.find((player) => player.id === "guest")).toMatchObject({ score: 1, routeIndex: 1 });
  });

  it("corrects only the claimant when a reach is out of order, in the wrong place or too quick", () => {
    const { room, prompt, takeoffAt } = startedRoom();
    const first = byCode(prompt.route![0]!);
    const second = byCode(prompt.route![1]!);
    const sync = { type: "FLYOVER_PROGRESS", playerId: "guest", index: 0, score: 0, event: "sync" };
    for (const result of [
      room.reach("guest", 1, ...second.centre, takeoffAt + 10_000),
      room.reach("guest", 0, ...second.centre, takeoffAt + 10_000),
      room.reach("guest", 0, ...first.centre, takeoffAt),
    ]) {
      expect(messagesOf(result)).toEqual([]);
      expect(replyOf(result)).toEqual([sync]);
    }
    expect(room.snapshot().players.find((player) => player.id === "guest")?.score).toBe(0);
  });

  it("a skip moves on without scoring and holds the plane before the next country counts", () => {
    const { room, prompt, takeoffAt } = startedRoom();
    const skippedAt = takeoffAt + 1_000;
    expect(messagesOf(room.skip("host", 0, skippedAt))).toEqual([{ type: "FLYOVER_PROGRESS", playerId: "host", index: 1, score: 0, event: "skipped" }]);
    const next = byCode(prompt.route![1]!);
    expect(replyOf(room.reach("host", 1, ...next.centre, skippedAt + 2_000))[0]).toMatchObject({ event: "sync", index: 1 });
    expect(messagesOf(room.reach("host", 1, ...next.centre, skippedAt + FLYOVER_SKIP_HOLD_SECONDS * 1000))[0]).toMatchObject({ event: "reached", index: 2, score: 1 });
  });

  it("relays positions once take-off has happened, once per change", () => {
    const { room, takeoffAt } = startedRoom();
    room.updatePosition("host", 100, 200, 0, takeoffAt - 500);
    expect(room.drainPlanes()).toBeNull();
    room.updatePosition("host", 100, 200, 0.5, takeoffAt + 100);
    room.updatePosition("guest", 300, 250, -1, takeoffAt + 120);
    expect(room.drainPlanes()).toEqual({ type: "FLYOVER_PLANES", planes: [{ playerId: "host", x: 100, y: 200, heading: 0.5 }, { playerId: "guest", x: 300, y: 250, heading: -1 }] });
    expect(room.drainPlanes()).toBeNull();
  });

  it("ends on the clock with most countries first and ties to whoever got there first", () => {
    const { room, prompt, takeoffAt } = startedRoom();
    const target = byCode(prompt.route![0]!);
    room.reach("guest", 0, ...target.centre, takeoffAt + 8_000);
    room.reach("host", 0, ...target.centre, takeoffAt + 9_000);
    expect(room.pendingTransitionAt).toBe(takeoffAt + 90_000);
    const done = room.endRound(takeoffAt + 90_000);
    const completed = messagesOf(done).find((message) => message.type === "GAME_COMPLETED");
    expect(completed && completed.type === "GAME_COMPLETED" && completed.results.map((result) => [result.name, result.rank, result.score])).toEqual([["Guest", 1, 1], ["Host", 2, 1]]);
    expect(room.state).toBe("complete");
    expect(room.snapshot().round).toBeNull();
  });

  it("only offers the listed flight lengths, and a rematch starts clean", () => {
    const room = new FlyoverRoom({ code: "FLY02", hostPlayerId: "host", hostName: "Host", countries, seed: "s", now: 0 });
    expect(room.updateOptions("host", { roundDurationMs: 45_000 }, 1).ok).toBe(false);
    expect(room.updateOptions("host", { roundDurationMs: 120_000 }, 2).ok).toBe(true);
    expect(room.snapshot().settings.roundDurationMs).toBe(120_000);
    room.startGame("host", 10);
    room.endRound(200_000);
    expect(room.returnToLobby("host", 200_001).ok).toBe(true);
    expect(room.snapshot()).toMatchObject({ status: "lobby", round: null });
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
  it("runs a race end to end: positions on the tick, reaches to everyone, the podium on the clock", () => {
    const manager = new RoomManager({ flyoverCountries: () => countries });
    const host = new TestConnection();
    const guest = new TestConnection();
    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flyover"], roundDurationMs: 60_000 }, 0);
    const roomCode = host.of("SESSION_ASSIGNED")[0]!.roomCode;
    expect(manager.listRooms()[0]?.kind).toBe("flyover");
    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode, playerName: "Guest" }, 10);
    manager.handleMessage(host, { type: "START_GAME" }, 1000);
    const round = guest.of("GAME_STARTED")[0]!.round;
    const prompt = JSON.parse(round.prompt.value) as FlyoverFlightPrompt;

    manager.handleMessage(guest, { type: "FLYOVER_POSITION", x: 400, y: 250, heading: 0 }, round.startedAt + 100);
    manager.sweep(round.startedAt + 200);
    expect(host.of("FLYOVER_PLANES").at(-1)?.planes).toEqual([{ playerId: guest.of("SESSION_ASSIGNED")[0]!.playerId, x: 400, y: 250, heading: 0 }]);

    const [x, y] = byCode(prompt.route![0]!).centre;
    manager.handleMessage(guest, { type: "FLYOVER_REACHED", index: 0, x, y, clientSentAt: 0 }, round.startedAt + 10_000);
    expect(host.of("FLYOVER_PROGRESS").at(-1)).toMatchObject({ event: "reached", score: 1 });

    manager.handleMessage(guest, { type: "SUBMIT_ANSWER", answer: "Japan", clientSentAt: 0 }, round.startedAt + 11_000);
    expect(guest.of("ERROR").at(-1)?.code).toBe("wrong-mode");

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

it("rejects late touches, skips and position reports without disturbing the previous result", () => {
  const { room, prompt, takeoffAt } = startedRoom();
  const target = byCode(prompt.route![0]!);
  const endsAt = takeoffAt + 90_000;
  expect(replyOf(room.reach("guest", 0, ...target.centre, endsAt))[0]).toMatchObject({ score: 0 });
  expect(replyOf(room.skip("guest", 0, endsAt))[0]).toMatchObject({ index: 0 });
  room.updatePosition("guest", 100, 200, 0, endsAt);
  expect(room.drainPlanes()).toBeNull();
  expect(room.tick(endsAt)).toEqual([]);
});
