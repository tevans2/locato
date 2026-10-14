import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexCountries, type RawCountry } from "../src/core/countries";
import { RATING_START, parseServerMessage, ratingChanges, type RoomKind, type ServerMessage } from "../src/core/multiplayer";
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

describe("multiplayer ratings (Elo)", () => {
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

describe("rating messages", () => {
  it("validates the rating update, keyed by game type", () => {
    expect(parseServerMessage({ type: "RATING_UPDATED", game: "map-tap", changes: [{ playerId: "p1", rating: 1020, delta: 20 }] })).toMatchObject({ ok: true });
    expect(parseServerMessage({ type: "RATING_UPDATED", game: "chess", changes: [] })).toMatchObject({ ok: false });
    expect(parseServerMessage({ type: "RATING_UPDATED", game: "map-tap", changes: [{ playerId: "p1", rating: "high", delta: 20 }] })).toMatchObject({ ok: false });
  });
});

describe("rated rooms", () => {
  function setup() {
    const ratings = new Map<string, number>();
    const rateGame = vi.fn((game: RoomKind, standings: readonly { userId: string; rank: number }[]) => standings.map(({ userId, rank }) => {
      const delta = rank === 1 ? 16 : -16;
      const rating = (ratings.get(`${userId}:${game}`) ?? RATING_START) + delta;
      ratings.set(`${userId}:${game}`, rating);
      return { userId, rating, delta };
    }));
    const manager = new RoomManager({ countryIndex, resultDisplayMs: 1000, getRating: (userId, game) => ratings.get(`${userId}:${game}`) ?? RATING_START, rateGame });
    const room = (code: string) => (manager as unknown as { rooms: Map<string, Room> }).rooms.get(code)!;
    return { manager, room, rateGame, ratings };
  }

  it("shows signed-in players' ratings for the room's game type, and refreshes them when it changes", () => {
    const { manager, ratings } = setup();
    ratings.set("u-ana:quiz", 1100);
    ratings.set("u-ana:map-tap", 940);
    const ana = new TestConnection("Ana", "u-ana");
    const ben = new TestConnection("Ben", "u-ben");
    const guest = new TestConnection(null, null);
    manager.handleMessage(ana, { type: "CREATE_ROOM", playerName: "Ana", categoryIds: ["flags"] }, 1000);
    const code = ana.last("SESSION_ASSIGNED")!.roomCode;
    manager.handleMessage(ben, { type: "JOIN_ROOM", roomCode: code, playerName: "Ben" }, 1100);
    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode: code, playerName: "Gus" }, 1200);
    expect(ana.last("ROOM_SNAPSHOT")!.room.players.map((player) => [player.name, player.rating])).toEqual([["Ana", 1100], ["Ben", RATING_START], ["Gus", undefined]]);
    manager.handleMessage(ana, { type: "SET_ROOM_OPTIONS", categoryIds: ["map-tap"] }, 1300);
    expect(ben.last("ROOM_SNAPSHOT")!.room.players.map((player) => player.rating)).toEqual([940, RATING_START, undefined]);
  });

  it("rates the signed-in entrants when the game ends, counting a leaver as last", () => {
    const { manager, room, rateGame, ratings } = setup();
    const ana = new TestConnection("Ana", "u-ana");
    const ben = new TestConnection("Ben", "u-ben");
    const guest = new TestConnection(null, null);
    manager.handleMessage(ana, { type: "CREATE_ROOM", playerName: "Ana", categoryIds: ["flags"] }, 1000);
    const code = ana.last("SESSION_ASSIGNED")!.roomCode;
    manager.handleMessage(ben, { type: "JOIN_ROOM", roomCode: code, playerName: "Ben" }, 1100);
    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode: code, playerName: "Gus" }, 1200);
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
    expect(rateGame.mock.calls[0]![0]).toBe("quiz");
    expect(rateGame.mock.calls[0]![1]).toEqual(expect.arrayContaining([{ userId: "u-ana", rank: 1 }, { userId: "u-ben", rank: 3 }]));
    expect(rateGame.mock.calls[0]![1]).toHaveLength(2);
    const update = ana.last("RATING_UPDATED")!;
    expect(update.game).toBe("quiz");
    expect(update.changes).toEqual(expect.arrayContaining([expect.objectContaining({ rating: RATING_START + 16, delta: 16 })]));
    expect(guest.last("RATING_UPDATED")).toBeDefined();
    expect(ratings.get("u-ben:quiz")).toBe(RATING_START - 16);

    // The host's usual rematch works, and the next game is rated again with the new ratings shown.
    manager.handleMessage(ana, { type: "PLAY_AGAIN" }, now + 10);
    expect(ana.last("ERROR")).toBeUndefined();
    expect(ana.last("ROOM_SNAPSHOT")!.room.players[0]).toMatchObject({ name: "Ana", rating: RATING_START + 16 });
  });

  it("doesn't rate a game with fewer than two signed-in players", () => {
    const { manager, rateGame } = setup();
    const ana = new TestConnection("Ana", "u-ana");
    const guest = new TestConnection(null, null);
    manager.handleMessage(ana, { type: "CREATE_ROOM", playerName: "Ana", categoryIds: ["flyover"] }, 1000);
    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode: ana.last("SESSION_ASSIGNED")!.roomCode, playerName: "Gus" }, 1100);
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
    expect(service.getRating(ana!.id, "quiz")).toBe(RATING_START);
    // One account twice in a room counts once, at its best position.
    expect(service.rateGame("quiz", [{ userId: ana!.id, rank: 1 }, { userId: ana!.id, rank: 3 }])).toEqual([]);
    const changes = service.rateGame("quiz", [{ userId: ana!.id, rank: 1 }, { userId: ben!.id, rank: 2 }, { userId: cy!.id, rank: 3 }]);
    expect(changes).toEqual([{ userId: ana!.id, rating: 1020, delta: 20 }, { userId: ben!.id, rating: 1000, delta: 0 }, { userId: cy!.id, rating: 980, delta: -20 }]);
    expect(service.getRating(ana!.id, "quiz")).toBe(1020);
    expect(service.listUserRatings(ana!.id)).toEqual([{ game: "quiz", rating: 1020, games: 1, updatedAt: 5000 }]);
    expect(service.listTopRatings("quiz", 2).map((entry) => [entry.rank, entry.user.username, entry.rating])).toEqual([[1, "ana", 1020], [2, "ben", 1000]]);
    expect(service.listTopRatings("map-tap", 5)).toEqual([]);

    const request = async (path: string, token?: string) => {
      const req = new Request(`http://localhost${path}`, token ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } } : {});
      return (await handleAuthRequest(req, new URL(req.url), service, { secure: false }, "http://localhost"))!;
    };
    expect(await (await request("/api/ratings?game=quiz&limit=1")).json()).toMatchObject({ game: "quiz", entries: [{ rank: 1, rating: 1020, user: { username: "ana" } }] });
    expect((await request("/api/ratings?game=chess")).status).toBe(400);
    expect((await request("/api/ratings/me")).status).toBe(401);
    expect(await (await request("/api/ratings/me", users[1]!.session.id)).json()).toEqual({ ratings: [{ game: "quiz", rating: 1000, games: 1, updatedAt: 5000 }] });

    expect(store.deleteUser(ana!.id)).toBe(true);
    expect(service.listTopRatings("quiz", 5).map((entry) => entry.user.username)).toEqual(["ben", "cyd"]);
  });
});
