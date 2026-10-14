import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexCountries, type RawCountry } from "../src/core/countries";
import {
  QUICK_MATCH_COUNTDOWN_MS,
  QUICK_MATCH_FULL_COUNTDOWN_MS,
  RATING_START,
  parseClientMessage,
  parseServerMessage,
  ratingChanges,
  type QuickMatchGame,
  type ServerMessage,
} from "../src/core/multiplayer";
import { RoomManager, type MultiplayerConnection } from "../server/rooms/RoomManager";
import type { Room } from "../server/rooms/Room";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { SESSION_COOKIE_NAME } from "../server/auth/cookies";
import { openDatabase, SqliteUserStore } from "../server/db/database";

const countryIndex = indexCountries([
  { name: "Japan", code: "JP", aliases: [], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Brazil", code: "BR", aliases: [], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: ["Brasilia"] },
  { name: "Canada", code: "CA", aliases: [], continent: "North America", flagSrc: "assets/flags/ca.svg", capital: "Ottawa", capitalAliases: [] },
] as const satisfies readonly RawCountry[]);

class TestConnection implements MultiplayerConnection {
  readonly messages: ServerMessage[] = [];
  constructor(readonly authenticatedName: string | null = null, readonly authenticatedUserId: string | null = null) {}
  send(message: string): void {
    this.messages.push(JSON.parse(message) as ServerMessage);
  }
  last<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    return [...this.messages].reverse().find((message): message is Extract<ServerMessage, { type: T }> => message.type === type);
  }
}

describe("quick-match ratings (Elo)", () => {
  it("moves evenly matched new players by half their K, in opposite directions", () => {
    const changes = ratingChanges([{ id: "a", rating: 1000, games: 0, rank: 1 }, { id: "b", rating: 1000, games: 0, rank: 2 }]);
    expect(changes.get("a")).toBe(20);
    expect(changes.get("b")).toBe(-20);
  });

  it("moves established players less, and an upset more than an expected win", () => {
    const expected = ratingChanges([{ id: "fav", rating: 1400, games: 30, rank: 1 }, { id: "dog", rating: 1000, games: 30, rank: 2 }]);
    const upset = ratingChanges([{ id: "fav", rating: 1400, games: 30, rank: 2 }, { id: "dog", rating: 1000, games: 30, rank: 1 }]);
    expect(expected.get("fav")).toBe(2);
    expect(upset.get("dog")).toBe(22);
    expect(ratingChanges([{ id: "a", rating: 1000, games: 30, rank: 1 }, { id: "b", rating: 1000, games: 30, rank: 1 }]).get("a")).toBe(0);
  });

  it("scores every pairing in a bigger room, averaged so a game counts the same", () => {
    const changes = ratingChanges([1, 2, 3, 4].map((rank) => ({ id: `p${rank}`, rating: 1000, games: 0, rank })));
    expect([...changes.values()]).toEqual([20, 7, -7, -20]);
    expect(ratingChanges([{ id: "alone", rating: 1000, games: 0, rank: 1 }]).size).toBe(0);
  });
});

describe("quick-match messages", () => {
  it("validates a quick-match request and the rating update", () => {
    expect(parseClientMessage({ type: "QUICK_MATCH", playerName: "  Sam ", game: "flags" })).toEqual({ ok: true, message: { type: "QUICK_MATCH", playerName: "Sam", game: "flags" } });
    expect(parseClientMessage({ type: "QUICK_MATCH", playerName: "Sam", game: "geoguessr" })).toMatchObject({ ok: false, code: "invalid-game" });
    expect(parseClientMessage({ type: "QUICK_MATCH", playerName: "", game: "flags" })).toMatchObject({ ok: false });
    expect(parseServerMessage({ type: "RATING_UPDATED", game: "map-tap", changes: [{ playerId: "p1", rating: 1020, delta: 20 }] })).toMatchObject({ ok: true });
    expect(parseServerMessage({ type: "RATING_UPDATED", game: "map-tap", changes: [{ playerId: "p1", rating: "high", delta: 20 }] })).toMatchObject({ ok: false });
  });
});

describe("quick-match rooms", () => {
  function setup() {
    const ratings = new Map<string, number>();
    const rateGame = vi.fn((game: QuickMatchGame, standings: readonly { userId: string; rank: number }[]) => standings.map(({ userId, rank }) => {
      const delta = rank === 1 ? 16 : -16;
      const rating = (ratings.get(`${userId}:${game}`) ?? RATING_START) + delta;
      ratings.set(`${userId}:${game}`, rating);
      return { userId, rating, delta };
    }));
    const manager = new RoomManager({ countryIndex, resultDisplayMs: 1000, getRating: (userId, game) => ratings.get(`${userId}:${game}`) ?? RATING_START, rateGame });
    const match = (connection: TestConnection, game: QuickMatchGame, now: number) => manager.handleMessage(connection, { type: "QUICK_MATCH", playerName: connection.authenticatedName ?? "Guest", game }, now);
    const room = (code: string) => (manager as unknown as { rooms: Map<string, Room> }).rooms.get(code)!;
    return { manager, match, room, rateGame, ratings };
  }

  it("puts players asking for the same game in one public room and counts down once two are in", () => {
    const { manager, match } = setup();
    const ana = new TestConnection("Ana", "u-ana");
    const ben = new TestConnection("Ben", "u-ben");
    const cy = new TestConnection("Cy", "u-cy");
    match(ana, "flags", 1000);
    const first = ana.last("ROOM_SNAPSHOT")!.room;
    expect(first.quickMatch).toEqual({ game: "flags", startsAt: null });
    expect(first.players[0]).toMatchObject({ name: "Ana", rating: RATING_START });
    match(ben, "flags", 2000);
    match(cy, "capitals", 2500);
    const together = ben.last("ROOM_SNAPSHOT")!.room;
    expect(together.roomCode).toBe(first.roomCode);
    expect(together.players.map((player) => player.name)).toEqual(["Ana", "Ben"]);
    expect(together.quickMatch).toEqual({ game: "flags", startsAt: 2000 + QUICK_MATCH_COUNTDOWN_MS });
    expect(cy.last("ROOM_SNAPSHOT")!.room.roomCode).not.toBe(first.roomCode);

    // Fixed settings, and nobody but the countdown (or the host, early) starts it.
    manager.handleMessage(ana, { type: "SET_ROOM_OPTIONS", categoryIds: ["capitals"] }, 2100);
    expect(ana.last("ERROR")).toMatchObject({ code: "quick-match" });
    manager.sweep(2000 + QUICK_MATCH_COUNTDOWN_MS - 1);
    expect(ana.last("GAME_STARTED")).toBeUndefined();
    manager.sweep(2000 + QUICK_MATCH_COUNTDOWN_MS);
    expect(ana.last("GAME_STARTED")).toBeDefined();
    expect(ben.last("GAME_STARTED")).toBeDefined();
  });

  it("stops the countdown when a player leaves, and shortens it once the room is full", () => {
    const { manager, match } = setup();
    const ana = new TestConnection("Ana", "u-ana");
    const ben = new TestConnection("Ben", "u-ben");
    match(ana, "map-tap", 1000);
    match(ben, "map-tap", 1500);
    manager.handleMessage(ben, { type: "LEAVE_ROOM" }, 2000);
    expect(ana.last("ROOM_SNAPSHOT")!.room.quickMatch?.startsAt).toBeNull();
    manager.handleMessage(ana, { type: "START_GAME" }, 2100);
    expect(ana.last("ERROR")).toMatchObject({ code: "not-enough-players" });
    const others = Array.from({ length: 7 }, (_, index) => new TestConnection(`P${index}`, `u-${index}`));
    others.forEach((connection, index) => match(connection, "map-tap", 3000 + index));
    expect(ana.last("ROOM_SNAPSHOT")!.room.players).toHaveLength(8);
    expect(ana.last("ROOM_SNAPSHOT")!.room.quickMatch?.startsAt).toBe(3006 + QUICK_MATCH_FULL_COUNTDOWN_MS);
  });

  it("rates the signed-in entrants when the game ends, counting a leaver as last", () => {
    const { manager, match, room, rateGame, ratings } = setup();
    const ana = new TestConnection("Ana", "u-ana");
    const ben = new TestConnection("Ben", "u-ben");
    const guest = new TestConnection(null, null);
    match(ana, "flags", 1000);
    match(ben, "flags", 1100);
    match(guest, "flags", 1200);
    const code = ana.last("ROOM_SNAPSHOT")!.room.roomCode;
    manager.handleMessage(ana, { type: "START_GAME" }, 1300);
    expect(ana.last("GAME_STARTED")).toBeDefined();
    manager.handleMessage(ben, { type: "LEAVE_ROOM" }, 1400);
    let now = 1400;
    for (let step = 0; step < 40 && !ana.last("GAME_COMPLETED"); step += 1) {
      const live = room(code) as unknown as { currentRound: { countryId: number } | null; promptCountryIndex: typeof countryIndex };
      if (live.currentRound && room(code).state === "playing") manager.handleMessage(ana, { type: "SUBMIT_ANSWER", answer: live.promptCountryIndex.byId[live.currentRound.countryId]!.name, clientSentAt: now }, now);
      now += 31_000;
      manager.sweep(now);
    }
    expect(ana.last("GAME_COMPLETED")).toBeDefined();
    expect(rateGame).toHaveBeenCalledOnce();
    expect(rateGame.mock.calls[0]![0]).toBe("flags");
    expect(rateGame.mock.calls[0]![1]).toEqual(expect.arrayContaining([{ userId: "u-ana", rank: 1 }, { userId: "u-ben", rank: 3 }]));
    expect(rateGame.mock.calls[0]![1]).toHaveLength(2);
    const update = ana.last("RATING_UPDATED")!;
    expect(update.game).toBe("flags");
    expect(update.changes).toEqual(expect.arrayContaining([expect.objectContaining({ rating: RATING_START + 16, delta: 16 })]));
    expect(guest.last("RATING_UPDATED")).toBeDefined();
    expect(ratings.get("u-ben:flags")).toBe(RATING_START - 16);

    // No rematch: everyone finds another match, and a finished room is never matched into.
    manager.handleMessage(ana, { type: "PLAY_AGAIN" }, now + 10);
    expect(ana.last("ERROR")).toMatchObject({ code: "quick-match" });
    match(ana, "flags", now + 20);
    const next = ana.last("ROOM_SNAPSHOT")!.room;
    expect(next.roomCode).not.toBe(code);
    expect(next.players[0]).toMatchObject({ name: "Ana", rating: RATING_START + 16 });
  });

  it("doesn't rate a game with fewer than two signed-in players", () => {
    const { manager, match, rateGame } = setup();
    const ana = new TestConnection("Ana", "u-ana");
    const guest = new TestConnection(null, null);
    match(ana, "flyover", 1000);
    match(guest, "flyover", 1100);
    manager.handleMessage(ana, { type: "START_GAME" }, 1200);
    let now = 1200;
    for (let step = 0; step < 20 && !ana.last("GAME_COMPLETED"); step += 1) manager.sweep((now += 30_000));
    expect(ana.last("GAME_COMPLETED")).toBeDefined();
    expect(rateGame).not.toHaveBeenCalled();
    expect(ana.last("RATING_UPDATED")).toBeUndefined();
  });
});

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("stored ratings", () => {
  const hasher = { hash: async (p: string) => p, verify: async (p: string, h: string) => p === h };

  it.each(["memory", "sqlite"] as const)("saves, ranks and deletes ratings with the account (%s)", async (kind) => {
    let store;
    if (kind === "memory") store = createMemoryUserStore();
    else {
      const directory = mkdtempSync(join(tmpdir(), "locato-ratings-"));
      directories.push(directory);
      store = new SqliteUserStore(openDatabase(join(directory, "test.db")));
    }
    const service = new AuthService(store, hasher, { sessionTtlMs: 3_600_000, clock: () => 5000 });
    const users = [];
    for (const name of ["ana", "ben", "cyd"]) {
      const registration = await service.register({ email: `${name}@test.local`, password: "a-long-password", displayName: name });
      if (!registration.ok) throw new Error(registration.error);
      users.push(registration);
    }
    const [ana, ben, cy] = users.map((registration) => registration.user);
    expect(service.getRating(ana!.id, "flags")).toBe(RATING_START);
    // One account twice in a room counts once, at its best position.
    expect(service.rateQuickMatch("flags", [{ userId: ana!.id, rank: 1 }, { userId: ana!.id, rank: 3 }])).toEqual([]);
    const changes = service.rateQuickMatch("flags", [{ userId: ana!.id, rank: 1 }, { userId: ben!.id, rank: 2 }, { userId: cy!.id, rank: 3 }]);
    expect(changes).toEqual([{ userId: ana!.id, rating: 1020, delta: 20 }, { userId: ben!.id, rating: 1000, delta: 0 }, { userId: cy!.id, rating: 980, delta: -20 }]);
    expect(service.getRating(ana!.id, "flags")).toBe(1020);
    expect(service.listUserRatings(ana!.id)).toEqual([{ game: "flags", rating: 1020, games: 1, updatedAt: 5000 }]);
    expect(service.listTopRatings("flags", 2).map((entry) => [entry.rank, entry.user.username, entry.rating])).toEqual([[1, "ana", 1020], [2, "ben", 1000]]);
    expect(service.listTopRatings("capitals", 5)).toEqual([]);

    const request = async (path: string, token?: string) => {
      const req = new Request(`http://localhost${path}`, token ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } } : {});
      return (await handleAuthRequest(req, new URL(req.url), service, { secure: false }, "http://localhost"))!;
    };
    expect(await (await request("/api/ratings?game=flags&limit=1")).json()).toMatchObject({ game: "flags", entries: [{ rank: 1, rating: 1020, user: { username: "ana" } }] });
    expect((await request("/api/ratings?game=chess")).status).toBe(400);
    expect((await request("/api/ratings/me")).status).toBe(401);
    expect(await (await request("/api/ratings/me", users[1]!.session.id)).json()).toEqual({ ratings: [{ game: "flags", rating: 1000, games: 1, updatedAt: 5000 }] });

    expect(store.deleteUser(ana!.id)).toBe(true);
    expect(service.listTopRatings("flags", 5).map((entry) => entry.user.username)).toEqual(["ben", "cyd"]);
  });
});
