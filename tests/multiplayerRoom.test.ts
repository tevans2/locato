import { describe, expect, it } from "vitest";
import { indexCountries, type RawCountry } from "../src/core/countries";
import type { PublicRoundState, ServerMessage } from "../src/core/multiplayer";
import { Room } from "../server/rooms/Room";
import { RoomManager, type MultiplayerConnection } from "../server/rooms/RoomManager";

const fixtureCountries = [
  { name: "Japan", code: "JP", aliases: ["Nippon"], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Brazil", code: "BR", aliases: ["Brasil"], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: ["Brasilia"] },
  { name: "Canada", code: "CA", aliases: [], continent: "North America", flagSrc: "assets/flags/ca.svg", capital: "Ottawa", capitalAliases: [] },
] as const satisfies readonly RawCountry[];

const countryIndex = indexCountries(fixtureCountries);

class TestConnection implements MultiplayerConnection {
  readonly authenticatedName: string | null = null;
  readonly messages: ServerMessage[] = [];

  send(message: string): void {
    this.messages.push(JSON.parse(message) as ServerMessage);
  }
}

function latestRoomMessage(connection: TestConnection) {
  return [...connection.messages].reverse().find((message) => message.type === "ROOM_SNAPSHOT");
}

function countryNameForRound(round: PublicRoundState): string {
  const country = countryIndex.countries.find((candidate) => {
    if (round.prompt.kind === "image") return candidate.flagSrc === round.prompt.value;
    if (round.prompt.kind === "map-highlight") return candidate.code === round.prompt.value;
    return candidate.code === round.prompt.value;
  });
  if (!country) throw new Error(`No fixture country for ${round.prompt.value}`);
  return country.name;
}

describe("multiplayer room", () => {
  it("races typed country names for map-highlight spot-country rounds without leaking the answer", () => {
    const room = new Room({
      code: "ABCDE",
      hostPlayerId: "host",
      hostName: "Host",
      countryIndex,
      categoryIds: ["spot-country"],
      seed: "spot-country-seed",
      now: 1000,
      roundLimit: 1,
      roundDurationMs: 30_000,
    });

    const start = room.startGame("host", 1010);
    expect(start.ok).toBe(true);
    const startedRound = start.ok ? start.messages.find((message) => message.type === "GAME_STARTED")?.round : null;
    expect(startedRound?.prompt.kind).toBe("map-highlight");
    expect(startedRound?.prompt.value).toMatch(/^[A-Z]{2}$/);
    expect(startedRound?.prompt.value).not.toBe(countryNameForRound(startedRound!));

    const correctAnswer = countryNameForRound(startedRound!);
    const correct = room.submitAnswer("host", correctAnswer, 1020);
    expect(correct.ok).toBe(true);
    const reveal = correct.ok ? correct.messages.find((message) => message.type === "ROUND_ENDED") : null;
    expect(reveal?.type).toBe("ROUND_ENDED");
    if (reveal?.type !== "ROUND_ENDED") throw new Error("Expected round reveal.");
    expect(reveal.answer).toBe(correctAnswer);
  });

  it("keeps answers private until a round is ended by the authoritative room", () => {
    const room = new Room({
      code: "ABCDE",
      hostPlayerId: "host",
      hostName: "Host",
      countryIndex,
      categoryIds: ["flags"],
      seed: "shared-seed",
      now: 1000,
      roundLimit: 2,
      roundDurationMs: 30_000,
    });

    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.startGame("host", 1020).ok).toBe(false);
    expect(room.setReady("guest", true, 1030).ok).toBe(true);

    const start = room.startGame("host", 1040);
    expect(start.ok).toBe(true);
    const startedRound = start.ok ? start.messages.find((message) => message.type === "GAME_STARTED")?.round : null;
    expect(startedRound).not.toBeNull();
    expect(Object.keys(startedRound!).sort()).toEqual(["endsAt", "prompt", "roundNumber", "startedAt"]);

    const wrong = room.submitAnswer("guest", "wrong answer", 1050);
    expect(wrong.ok).toBe(true);
    expect(wrong.ok ? wrong.messages.some((message) => message.type === "ROUND_ENDED") : false).toBe(false);

    const correctAnswer = countryNameForRound(startedRound!);
    const correct = room.submitAnswer("host", correctAnswer, 1060);
    expect(correct.ok).toBe(true);
    const reveal = correct.ok ? correct.messages.find((message) => message.type === "ROUND_ENDED") : null;
    expect(reveal?.type).toBe("ROUND_ENDED");
    if (reveal?.type !== "ROUND_ENDED") throw new Error("Expected round reveal.");
    expect(reveal.answer).toBe(correctAnswer);
    expect(reveal.results.some((result) => result.playerId === "host" && result.correct && result.points > 0)).toBe(true);
    expect(room.snapshot().status).toBe("round-result");
  });

  it("generates server-owned final standings", () => {
    const room = new Room({
      code: "ABCDE",
      hostPlayerId: "host",
      hostName: "Host",
      countryIndex,
      categoryIds: ["flags"],
      seed: "shared-seed",
      now: 1000,
      roundLimit: 1,
      roundDurationMs: 30_000,
    });

    expect(room.startGame("host", 1010).ok).toBe(true);
    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    expect(room.submitAnswer("host", countryNameForRound(round), 1020).ok).toBe(true);
    const complete = room.advanceAfterResult(6000);
    expect(complete.ok).toBe(true);
    expect(complete.ok ? complete.messages.some((message) => message.type === "GAME_COMPLETED") : false).toBe(true);
    expect(room.snapshot().status).toBe("complete");
    expect(room.finalResults()[0]?.playerId).toBe("host");
  });

  it("keeps a wrong answer private to the guesser", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundDurationMs: 30_000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.setReady("guest", true, 1020).ok).toBe(true);
    expect(room.startGame("host", 1030).ok).toBe(true);

    const wrong = room.submitAnswer("guest", "definitely-not-a-country", 1040);
    expect(wrong.ok).toBe(true);
    if (!wrong.ok) throw new Error("Expected wrong answer to be accepted by the room.");
    expect(wrong.messages).toHaveLength(0);
    expect(wrong.reply?.some((message) => message.type === "ANSWER_REJECTED")).toBe(true);
    expect(room.snapshot().status).toBe("playing");
  });

  it("exposes phase deadlines for the live round and the result gap", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundDurationMs: 30_000, resultDisplayMs: 2_000 });
    expect(room.startGame("host", 1000).ok).toBe(true);

    const playing = room.snapshot();
    expect(playing.status).toBe("playing");
    expect(playing.phaseStartedAt).toBe(1000);
    expect(playing.phaseEndsAt).toBe(31_000);

    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    expect(room.submitAnswer("host", countryNameForRound(round), 5000).ok).toBe(true);
    const result = room.snapshot();
    expect(result.status).toBe("round-result");
    expect(result.phaseStartedAt).toBe(5000);
    expect(result.phaseEndsAt).toBe(7000);
  });

  it("restores a disconnected player on reconnect", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    room.disconnectPlayer("guest", 1100);
    expect(room.snapshot().players.find((player) => player.id === "guest")?.connected).toBe(false);

    const reconnect = room.reconnectPlayer("guest", 1200);
    expect(reconnect.ok).toBe(true);
    expect(room.snapshot().players.find((player) => player.id === "guest")?.connected).toBe(true);
    expect(room.reconnectPlayer("ghost", 1300).ok).toBe(false);
  });

  it("restarts a finished game back to the lobby with reset scores", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 1, roundDurationMs: 30_000 });
    expect(room.startGame("host", 1000).ok).toBe(true);
    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    expect(room.submitAnswer("host", countryNameForRound(round), 1100).ok).toBe(true);
    expect(room.advanceAfterResult(2000).ok).toBe(true);
    expect(room.snapshot().status).toBe("complete");
    expect(room.snapshot().players[0]?.score).toBeGreaterThan(0);

    const restart = room.restart("host", 3000);
    expect(restart.ok).toBe(true);
    const snapshot = room.snapshot();
    expect(snapshot.status).toBe("lobby");
    expect(snapshot.round).toBeNull();
    expect(snapshot.players.every((player) => player.score === 0 && !player.ready)).toBe(true);
    expect(room.startGame("host", 3100).ok).toBe(true);
  });

  it("rejects a rematch from a non-host or before the game ends", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 1, roundDurationMs: 30_000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.restart("host", 1020).ok).toBe(false);

    expect(room.setReady("guest", true, 1030).ok).toBe(true);
    expect(room.startGame("host", 1040).ok).toBe(true);
    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    expect(room.submitAnswer("host", countryNameForRound(round), 1050).ok).toBe(true);
    expect(room.advanceAfterResult(2000).ok).toBe(true);
    expect(room.snapshot().status).toBe("complete");

    expect(room.restart("guest", 3000).ok).toBe(false);
    expect(room.restart("host", 3000).ok).toBe(true);
  });

  it("embeds player names in round and final results so a later leave cannot blank them", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 1, roundDurationMs: 30_000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.setReady("guest", true, 1020).ok).toBe(true);
    expect(room.startGame("host", 1030).ok).toBe(true);

    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    const correct = room.submitAnswer("host", countryNameForRound(round), 1040);
    const ended = correct.ok ? correct.messages.find((message) => message.type === "ROUND_ENDED") : undefined;
    if (ended?.type !== "ROUND_ENDED") throw new Error("Expected ROUND_ENDED.");
    expect(ended.results.every((result) => typeof result.name === "string" && result.name.length > 0)).toBe(true);
    expect(ended.results.find((result) => result.playerId === "host")?.name).toBe("Host");

    const complete = room.advanceAfterResult(2000);
    const completed = complete.ok ? complete.messages.find((message) => message.type === "GAME_COMPLETED") : undefined;
    if (completed?.type !== "GAME_COMPLETED") throw new Error("Expected GAME_COMPLETED.");
    expect(completed.results.find((result) => result.playerId === "guest")?.name).toBe("Guest");

    // The guest leaves after the game ends; the already-emitted standings keep their names,
    // which is exactly what each client renders from.
    expect(room.removePlayer("guest", 3000).ok).toBe(true);
    expect(completed.results.find((result) => result.playerId === "guest")?.name).toBe("Guest");
  });
});

describe("room manager", () => {
  it("lets two connections join the same room and receive the same public round", () => {
    const manager = new RoomManager({ countryIndex, resultDisplayMs: 1000 });
    const host = new TestConnection();
    const guest = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, 1000);
    const assigned = host.messages.find((message) => message.type === "SESSION_ASSIGNED");
    expect(assigned?.type).toBe("SESSION_ASSIGNED");
    if (assigned?.type !== "SESSION_ASSIGNED") throw new Error("Expected assigned host session.");

    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode: assigned.roomCode, playerName: "Guest" }, 1010);
    const hostSnapshot = latestRoomMessage(host);
    const guestSnapshot = latestRoomMessage(guest);
    expect(hostSnapshot?.type).toBe("ROOM_SNAPSHOT");
    expect(guestSnapshot?.type).toBe("ROOM_SNAPSHOT");
    if (hostSnapshot?.type !== "ROOM_SNAPSHOT" || guestSnapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshots.");
    expect(hostSnapshot.room.players).toHaveLength(2);
    expect(guestSnapshot.room.players).toHaveLength(2);

    manager.handleMessage(host, { type: "START_GAME" }, 1020);
    expect(host.messages.at(-1)).toMatchObject({ type: "ERROR", code: "players-not-ready" });

    manager.handleMessage(guest, { type: "SET_READY", ready: true }, 1030);
    manager.handleMessage(host, { type: "START_GAME" }, 1040);
    const hostStarted = host.messages.find((message) => message.type === "GAME_STARTED");
    const guestStarted = guest.messages.find((message) => message.type === "GAME_STARTED");
    expect(hostStarted?.type).toBe("GAME_STARTED");
    expect(guestStarted?.type).toBe("GAME_STARTED");
    if (hostStarted?.type !== "GAME_STARTED" || guestStarted?.type !== "GAME_STARTED") throw new Error("Expected game start messages.");
    expect(hostStarted.round.prompt.value).toBe(guestStarted.round.prompt.value);
    expect(Object.keys(hostStarted.round).sort()).toEqual(["endsAt", "prompt", "roundNumber", "startedAt"]);
  });

  it("rate limits answer bursts per connection", () => {
    const manager = new RoomManager({ countryIndex, answerRateLimitPerSecond: 1 });
    const host = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, 1000);
    manager.handleMessage(host, { type: "START_GAME" }, 1010);
    manager.handleMessage(host, { type: "SUBMIT_ANSWER", answer: "wrong", clientSentAt: 1020 }, 1020);
    manager.handleMessage(host, { type: "SUBMIT_ANSWER", answer: "wrong", clientSentAt: 1030 }, 1030);

    expect(host.messages.at(-1)).toMatchObject({ type: "ERROR", code: "answer-rate-limited" });
  });

  it("delivers answer rejections only to the guesser", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();
    const guest = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, 1000);
    const assigned = host.messages.find((message) => message.type === "SESSION_ASSIGNED");
    if (assigned?.type !== "SESSION_ASSIGNED") throw new Error("Expected assigned host session.");

    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode: assigned.roomCode, playerName: "Guest" }, 1010);
    manager.handleMessage(guest, { type: "SET_READY", ready: true }, 1020);
    manager.handleMessage(host, { type: "START_GAME" }, 1030);
    manager.handleMessage(host, { type: "SUBMIT_ANSWER", answer: "definitely-not-a-country", clientSentAt: 1040 }, 1040);

    expect(host.messages.some((message) => message.type === "ANSWER_REJECTED")).toBe(true);
    expect(guest.messages.some((message) => message.type === "ANSWER_REJECTED")).toBe(false);
  });

  it("lets a dropped player reclaim their seat and score with the session token", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, 1000);
    const assigned = host.messages.find((message) => message.type === "SESSION_ASSIGNED");
    if (assigned?.type !== "SESSION_ASSIGNED") throw new Error("Expected assigned host session.");

    manager.detach(host, 1100);

    const reconnected = new TestConnection();
    manager.handleMessage(reconnected, { type: "REJOIN_ROOM", roomCode: assigned.roomCode, playerId: assigned.playerId, sessionToken: assigned.sessionToken }, 1200);
    const reassigned = reconnected.messages.find((message) => message.type === "SESSION_ASSIGNED");
    if (reassigned?.type !== "SESSION_ASSIGNED") throw new Error("Expected a reassigned session.");
    expect(reassigned.playerId).toBe(assigned.playerId);

    const snapshot = latestRoomMessage(reconnected);
    expect(snapshot?.room.players.find((player) => player.id === assigned.playerId)?.connected).toBe(true);
  });

  it("rejects a rejoin with an unknown session token", () => {
    const manager = new RoomManager({ countryIndex });
    const connection = new TestConnection();

    manager.handleMessage(connection, { type: "REJOIN_ROOM", roomCode: "ABCDE", playerId: "player_x", sessionToken: "bogus" }, 1000);
    expect(connection.messages.at(-1)).toMatchObject({ type: "ERROR", code: "session-expired" });
  });

  it("advances rounds on the result-display deadline, not before", () => {
    const manager = new RoomManager({ countryIndex, resultDisplayMs: 1000 });
    const host = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, 1000);
    manager.handleMessage(host, { type: "START_GAME" }, 1000);
    const started = host.messages.find((message) => message.type === "GAME_STARTED");
    if (started?.type !== "GAME_STARTED") throw new Error("Expected game start.");

    manager.handleMessage(host, { type: "SUBMIT_ANSWER", answer: countryNameForRound(started.round), clientSentAt: 1100 }, 1100);
    expect(host.messages.some((message) => message.type === "ROUND_ENDED")).toBe(true);

    manager.sweep(2000);
    expect(host.messages.some((message) => message.type === "ROUND_STARTED")).toBe(false);

    manager.sweep(2100);
    expect(host.messages.some((message) => message.type === "ROUND_STARTED")).toBe(true);
  });

  it("routes PLAY_AGAIN to the room and surfaces the not-complete guard", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, 1000);
    manager.handleMessage(host, { type: "PLAY_AGAIN" }, 1010);
    expect(host.messages.at(-1)).toMatchObject({ type: "ERROR", code: "game-not-complete" });
  });
});
