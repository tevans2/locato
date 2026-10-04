import { describe, expect, it } from "vitest";
import { indexCountries, type RawCountry } from "../src/core/countries";
import type { PublicRoundState, ServerMessage } from "../src/core/multiplayer";
import { Room } from "../server/rooms/Room";
import { RoomManager, type MultiplayerConnection } from "../server/rooms/RoomManager";
import { MapTapRoom } from "../server/rooms/MapTapRoom";
import { territoryFlags } from "../src/core/territoryFlags";


const fixtureCountries = [
  { name: "Japan", code: "JP", aliases: ["Nippon"], continent: "Asia", flagSrc: "assets/flags/jp.svg", capital: "Tokyo", capitalAliases: [] },
  { name: "Brazil", code: "BR", aliases: ["Brasil"], continent: "South America", flagSrc: "assets/flags/br.svg", capital: "Brasília", capitalAliases: ["Brasilia"] },
  { name: "Canada", code: "CA", aliases: [], continent: "North America", flagSrc: "assets/flags/ca.svg", capital: "Ottawa", capitalAliases: [] },
] as const satisfies readonly RawCountry[];

const countryIndex = indexCountries(fixtureCountries);

describe("multiplayer MapTap room", () => {
  it("builds authoritative rounds only from the host's selected location categories", () => {
    const room = new MapTapRoom({
      code: "TAP01",
      hostPlayerId: "host",
      hostName: "Host",
      seed: "ocean-only",
      now: 1000,
      roundLimit: 5,
      mapTapCategories: ["ocean"],
    });

    expect(room.snapshot().settings.mapTapCategories).toEqual(["ocean"]);
    const started = room.startGame("host", 1010);
    expect(started.ok).toBe(true);
    const round = started.ok ? started.messages.find((message) => message.type === "GAME_STARTED")?.round : null;
    expect(round?.prompt.kind).toBe("maptap-globe");
    expect(JSON.parse(round?.prompt.value ?? "{}")).toMatchObject({ category: "ocean" });
  });

  it("lets only the host update MapTap categories", () => {
    const room = new MapTapRoom({ code: "TAP02", hostPlayerId: "host", hostName: "Host", seed: "settings", now: 1000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.updateOptions("guest", { mapTapCategories: ["city"] }, 1030).ok).toBe(false);

    const updated = room.updateOptions("host", { mapTapCategories: ["city", "region"] }, 1040);
    expect(updated.ok).toBe(true);
    expect(room.snapshot().settings.mapTapCategories).toEqual(["city", "region"]);
  });
});

class TestConnection implements MultiplayerConnection {
  readonly authenticatedName: string | null = null;
  authenticatedAvatar: string | null = null;
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
    if (round.prompt.kind === "image" || round.prompt.kind === "flag-colors") return candidate.flagSrc === round.prompt.value;
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

  it("reveals the answer when all connected players vote to skip", () => {
    const room = new Room({
      code: "SKIP1",
      hostPlayerId: "host",
      hostName: "Host",
      countryIndex,
      categoryIds: ["flags"],
      seed: "skip-seed",
      now: 1000,
      roundLimit: 1,
    });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    const start = room.startGame("host", 1030);
    expect(start.ok).toBe(true);

    const first = room.voteSkip("host", 1040);
    expect(first.ok).toBe(true);
    expect(first.ok ? first.messages.some((message) => message.type === "ROUND_ENDED") : false).toBe(false);
    const firstSnapshot = first.ok ? first.messages.find((message) => message.type === "ROOM_SNAPSHOT") : null;
    expect(firstSnapshot?.type).toBe("ROOM_SNAPSHOT");
    if (firstSnapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshot.");
    expect(firstSnapshot.room.skipVotes).toEqual(["host"]);
    expect(firstSnapshot.room.skipRequired).toBe(2);

    const second = room.voteSkip("guest", 1050);
    expect(second.ok).toBe(true);
    const reveal = second.ok ? second.messages.find((message) => message.type === "ROUND_ENDED") : null;
    expect(reveal?.type).toBe("ROUND_ENDED");
    if (reveal?.type !== "ROUND_ENDED") throw new Error("Expected round reveal.");
    expect(reveal.results.every((result) => result.answeredAt === null && result.guess === null && !result.correct)).toBe(true);
    const resultSnapshot = second.ok ? second.messages.find((message) => message.type === "ROOM_SNAPSHOT") : null;
    expect(resultSnapshot?.type).toBe("ROOM_SNAPSHOT");
    if (resultSnapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshot.");
    expect(resultSnapshot.room.status).toBe("round-result");
    expect(resultSnapshot.room.skipVotes).toEqual([]);
    expect(resultSnapshot.room.skipRequired).toBe(0);
  });

  it("stores room chat messages with filtered profanity", () => {
    const room = new Room({ code: "CHAT1", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "chat-seed", now: 1000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);

    const sent = room.sendChatMessage("guest", "hello shit room", 1020);
    expect(sent.ok).toBe(true);
    const snapshot = sent.ok ? sent.messages.find((message) => message.type === "ROOM_SNAPSHOT") : null;
    expect(snapshot?.type).toBe("ROOM_SNAPSHOT");
    if (snapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshot.");
    expect(snapshot.room.chatMessages).toMatchObject([{ playerId: "guest", playerName: "Guest", text: "hello **** room", sentAt: 1020 }]);
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
    expect(reveal.results.find((result) => result.playerId === "guest")?.guess).toBe("wrong answer");
    expect(reveal.results.find((result) => result.playerId === "host")?.guess).toBe(correctAnswer);
    expect(room.snapshot().status).toBe("round-result");
  });

  it("serves flag-colour rounds as a hidden target flag race", () => {
    const room = new Room({
      code: "ABCDE",
      hostPlayerId: "host",
      hostName: "Host",
      countryIndex,
      categoryIds: ["flag-colors"],
      seed: "flag-colours-seed",
      now: 1000,
      roundLimit: 1,
      roundDurationMs: 30_000,
    });

    const start = room.startGame("host", 1010);
    expect(start.ok).toBe(true);
    const startedRound = start.ok ? start.messages.find((message) => message.type === "GAME_STARTED")?.round : null;
    expect(startedRound?.prompt.kind).toBe("flag-colors");
    expect(startedRound?.prompt.value).toMatch(/^assets\/flags\/[a-z]{2}\.svg$/);

    const correctAnswer = countryNameForRound(startedRound!);
    const correct = room.submitAnswer("host", correctAnswer, 1020);
    expect(correct.ok).toBe(true);
    const reveal = correct.ok ? correct.messages.find((message) => message.type === "ROUND_ENDED") : null;
    expect(reveal?.type).toBe("ROUND_ENDED");
    if (reveal?.type !== "ROUND_ENDED") throw new Error("Expected round reveal.");
    expect(reveal.answer).toBe(correctAnswer);
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

  it("returns a finished game to the lobby with reset scores", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 1, roundDurationMs: 30_000 });
    expect(room.startGame("host", 1000).ok).toBe(true);
    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    expect(room.submitAnswer("host", countryNameForRound(round), 1100).ok).toBe(true);
    expect(room.advanceAfterResult(2000).ok).toBe(true);
    expect(room.snapshot().status).toBe("complete");
    expect(room.snapshot().players[0]?.score).toBeGreaterThan(0);

    const back = room.returnToLobby("host", 3000);
    expect(back.ok).toBe(true);
    const snapshot = room.snapshot();
    expect(snapshot.status).toBe("lobby");
    expect(snapshot.round).toBeNull();
    expect(snapshot.players.every((player) => player.score === 0)).toBe(true);
    expect(room.startGame("host", 3100).ok).toBe(true);
  });

  it("plays again straight away with the same players and fresh scores", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 1, roundDurationMs: 30_000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.startGame("host", 1020).ok).toBe(true);
    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    expect(room.submitAnswer("guest", countryNameForRound(round), 1100).ok).toBe(true);
    expect(room.advanceAfterResult(2000).ok).toBe(true);

    const again = room.playAgain("host", 3000);
    expect(again.ok && again.messages.some((message) => message.type === "GAME_STARTED")).toBe(true);
    const snapshot = room.snapshot();
    expect(snapshot.status).toBe("playing");
    expect(snapshot.players.map((player) => [player.id, player.score])).toEqual([["host", 0], ["guest", 0]]);
  });

  it("reveals the winner's time and everyone's latest guess, winner first", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 2, roundDurationMs: 30_000 });
    expect(room.addPlayer("guest", "Guest", 1001).ok).toBe(true);
    expect(room.addPlayer("quiet", "Quiet", 1002).ok).toBe(true);
    expect(room.startGame("host", 2000).ok).toBe(true);
    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    expect(room.submitAnswer("guest", "atlantis", 2500).ok).toBe(true);
    expect(room.submitAnswer("guest", "lemuria", 3000).ok).toBe(true);
    expect(room.submitAnswer("host", "nowhere", 3500).ok).toBe(true);
    const taken = room.submitAnswer("host", countryNameForRound(round), 6200);
    const reveal = taken.ok ? taken.messages.find((message) => message.type === "ROUND_ENDED") : undefined;
    if (reveal?.type !== "ROUND_ENDED") throw new Error("Expected a reveal.");
    expect(reveal.results.map((result) => [result.playerId, result.correct, result.attempts, result.elapsedMs])).toEqual([
      ["host", true, 2, 4200],
      ["guest", false, 2, 1000],
      ["quiet", false, 0, null],
    ]);
    expect(reveal.results[1]!.guess).toBe("lemuria");
  });

  it("starts without a ready check, even with guests who haven't done anything", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.startGame("guest", 1020)).toMatchObject({ ok: false, code: "not-host" });
    expect(room.startGame("host", 1030).ok).toBe(true);
  });

  it("seats a mid-game joiner as a spectator who can't play until the next game", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 1, roundDurationMs: 30_000 });
    expect(room.startGame("host", 1010).ok).toBe(true);
    expect(room.addPlayer("late", "Late", 1020).ok).toBe(true);
    expect(room.snapshot().players.find((player) => player.id === "late")?.spectator).toBe(true);

    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    expect(room.submitAnswer("late", countryNameForRound(round), 1030)).toMatchObject({ ok: false, code: "spectating" });
    // The spectator doesn't hold the skip vote up: the host alone skipping closes the round.
    expect(room.voteSkip("host", 1040).ok).toBe(true);
    expect(room.snapshot().status).toBe("round-result");
    expect(room.advanceAfterResult(2000).ok).toBe(true);
    expect(room.finalResults().map((result) => result.playerId)).toEqual(["host"]);

    expect(room.playAgain("host", 3000).ok).toBe(true);
    expect(room.snapshot().players.find((player) => player.id === "late")?.spectator).toBeUndefined();
  });

  it("rejects a rematch from a non-host or before the game ends", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 1, roundDurationMs: 30_000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.playAgain("host", 1020).ok).toBe(false);

    expect(room.startGame("host", 1040).ok).toBe(true);
    const round = room.publicRound;
    if (!round) throw new Error("Expected active round.");
    expect(room.submitAnswer("host", countryNameForRound(round), 1050).ok).toBe(true);
    expect(room.advanceAfterResult(2000).ok).toBe(true);
    expect(room.snapshot().status).toBe("complete");

    expect(room.playAgain("guest", 3000).ok).toBe(false);
    expect(room.returnToLobby("guest", 3000).ok).toBe(false);
    expect(room.returnToLobby("host", 3000).ok).toBe(true);
  });

  it("embeds player names in round and final results so a later leave cannot blank them", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 1, roundDurationMs: 30_000 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
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

  it("uses the territory flag pool for multiplayer flag rounds", () => {
    const room = new Room({
      code: "TERR1",
      hostPlayerId: "host",
      hostName: "Host",
      countryIndex,
      categoryIds: ["flags"],
      flagPool: "territories",
      seed: "territory-multiplayer",
      now: 1000,
      roundLimit: 1,
    });

    expect(room.snapshot().settings.flagPool).toBe("territories");
    expect(room.startGame("host", 1010).ok).toBe(true);
    const round = room.publicRound;
    if (!round || round.prompt.kind !== "image") throw new Error("Expected territory flag round.");
    expect(round.prompt.value).toMatch(/^assets\/flags\/territories\/.+\.svg$/);

    const territory = territoryFlags.find((flag) => flag.flagSrc === round.prompt.value);
    if (!territory) throw new Error(`No territory for ${round.prompt.value}`);
    const answer = room.submitAnswer("host", territory.name, 1020);
    expect(answer.ok).toBe(true);
    const reveal = answer.ok ? answer.messages.find((message) => message.type === "ROUND_ENDED") : null;
    expect(reveal?.type).toBe("ROUND_ENDED");
    if (reveal?.type !== "ROUND_ENDED") throw new Error("Expected territory reveal.");
    expect(reveal.answer).toBe(territory.name);
  });
});

describe("room manager", () => {
  it("carries MapTap categories from room creation into server-owned rounds", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["map-tap"], mapTapCategories: ["region"], roundLimit: 5 }, 1000);
    const snapshot = latestRoomMessage(host);
    expect(snapshot?.type).toBe("ROOM_SNAPSHOT");
    if (snapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshot.");
    expect(snapshot.room.settings.mapTapCategories).toEqual(["region"]);

    manager.handleMessage(host, { type: "START_GAME" }, 1010);
    const started = host.messages.find((message) => message.type === "GAME_STARTED");
    expect(started?.type).toBe("GAME_STARTED");
    if (started?.type !== "GAME_STARTED") throw new Error("Expected MapTap game start.");
    expect(JSON.parse(started.round.prompt.value)).toMatchObject({ category: "region" });
  });

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


    manager.handleMessage(host, { type: "START_GAME" }, 1040);
    const hostStarted = host.messages.find((message) => message.type === "GAME_STARTED");
    const guestStarted = guest.messages.find((message) => message.type === "GAME_STARTED");
    expect(hostStarted?.type).toBe("GAME_STARTED");
    expect(guestStarted?.type).toBe("GAME_STARTED");
    if (hostStarted?.type !== "GAME_STARTED" || guestStarted?.type !== "GAME_STARTED") throw new Error("Expected game start messages.");
    expect(hostStarted.round.prompt.value).toBe(guestStarted.round.prompt.value);
    expect(Object.keys(hostStarted.round).sort()).toEqual(["endsAt", "prompt", "roundNumber", "startedAt"]);
  });

  it("relays each player's chosen avatar to everyone in the room", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();
    const guest = new TestConnection();
    guest.authenticatedAvatar = "🐬";
    const late = new TestConnection();
    late.authenticatedAvatar = "🐬";

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", avatarEmoji: "🦊", categoryIds: ["flags"] }, 1000);
    const assigned = host.messages.find((message) => message.type === "SESSION_ASSIGNED");
    if (assigned?.type !== "SESSION_ASSIGNED") throw new Error("Expected assigned host session.");
    // The client's current pick wins over the account avatar captured at socket open.
    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode: assigned.roomCode, playerName: "Guest", avatarEmoji: "🌵" }, 1010);
    // Without a client pick, the account avatar is used.
    manager.handleMessage(late, { type: "JOIN_ROOM", roomCode: assigned.roomCode, playerName: "Late" }, 1020);

    const snapshot = latestRoomMessage(host);
    if (snapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshot.");
    expect(snapshot.room.players.map((player) => [player.name, player.avatarEmoji])).toEqual([["Host", "🦊"], ["Guest", "🌵"], ["Late", "🐬"]]);
  });

  it("applies host room settings to created rooms", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"], roundLimit: 5, roundDurationMs: 45_000 }, 1000);
    const snapshot = latestRoomMessage(host);

    expect(snapshot?.type).toBe("ROOM_SNAPSHOT");
    if (snapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshot.");
    expect(snapshot.room.settings).toEqual({ roundLimit: 3, roundDurationMs: 45_000, flagPool: "countries" });
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
    manager.handleMessage(host, { type: "START_GAME" }, 1030);
    manager.handleMessage(host, { type: "SUBMIT_ANSWER", answer: "definitely-not-a-country", clientSentAt: 1040 }, 1040);

    expect(host.messages.some((message) => message.type === "ANSWER_REJECTED")).toBe(true);
    expect(guest.messages.some((message) => message.type === "ANSWER_REJECTED")).toBe(false);
  });


  it("broadcasts filtered chat messages to every player in a room", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();
    const guest = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, 1000);
    const assigned = host.messages.find((message) => message.type === "SESSION_ASSIGNED");
    if (assigned?.type !== "SESSION_ASSIGNED") throw new Error("Expected assigned host session.");
    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode: assigned.roomCode, playerName: "Guest" }, 1010);
    manager.handleMessage(guest, { type: "SEND_CHAT_MESSAGE", text: "that was damn close" }, 1020);

    const hostSnapshot = latestRoomMessage(host);
    const guestSnapshot = latestRoomMessage(guest);
    expect(hostSnapshot?.type).toBe("ROOM_SNAPSHOT");
    expect(guestSnapshot?.type).toBe("ROOM_SNAPSHOT");
    if (hostSnapshot?.type !== "ROOM_SNAPSHOT" || guestSnapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshots.");
    expect(hostSnapshot.room.chatMessages.at(-1)?.text).toBe("that was **** close");
    expect(guestSnapshot.room.chatMessages.at(-1)?.text).toBe("that was **** close");
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

  it("lets the host change room modes in the lobby", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 3 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);

    const update = room.updateOptions("host", { categoryIds: ["flags", "spot-country"], flagPool: "both", roundLimit: 2 }, 1030);
    expect(update.ok).toBe(true);
    const snapshot = room.snapshot();
    expect(snapshot.categoryIds).toEqual(["flags", "spot-country"]);
    expect(snapshot.settings.roundLimit).toBe(2);
    expect(snapshot.settings.flagPool).toBe("both");
  });

  it("rejects non-host or in-progress room mode changes", () => {
    const room = new Room({ code: "ABCDE", hostPlayerId: "host", hostName: "Host", countryIndex, categoryIds: ["flags"], seed: "shared-seed", now: 1000, roundLimit: 3 });
    expect(room.addPlayer("guest", "Guest", 1010).ok).toBe(true);
    expect(room.updateOptions("guest", { categoryIds: ["codes"] }, 1020).ok).toBe(false);
    expect(room.startGame("host", 1040).ok).toBe(true);
    expect(room.updateOptions("host", { categoryIds: ["codes"] }, 1050).ok).toBe(false);
  });

  it("routes PLAY_AGAIN to the room and surfaces the not-complete guard", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();

    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, 1000);
    manager.handleMessage(host, { type: "PLAY_AGAIN" }, 1010);
    expect(host.messages.at(-1)).toMatchObject({ type: "ERROR", code: "game-not-complete" });
    manager.handleMessage(host, { type: "RETURN_TO_LOBBY" }, 1020);
    expect(host.messages.at(-1)).toMatchObject({ type: "ERROR", code: "game-not-complete" });
  });

  it("switches the game type in the lobby, keeping everyone's seat", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();
    const guest = new TestConnection();
    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", avatarEmoji: "🦊", categoryIds: ["flags"] }, 1000);
    const assigned = host.messages.find((message) => message.type === "SESSION_ASSIGNED");
    if (assigned?.type !== "SESSION_ASSIGNED") throw new Error("Expected assigned host session.");
    manager.handleMessage(guest, { type: "JOIN_ROOM", roomCode: assigned.roomCode, playerName: "Guest" }, 1010);
    manager.handleMessage(guest, { type: "SEND_CHAT_MESSAGE", text: "hi" }, 1015);

    manager.handleMessage(guest, { type: "SET_ROOM_OPTIONS", categoryIds: ["map-tap"] }, 1020);
    expect(guest.messages.at(-1)).toMatchObject({ type: "ERROR", code: "not-host" });

    manager.handleMessage(host, { type: "SET_ROOM_OPTIONS", categoryIds: ["map-tap"] }, 1030);
    const snapshot = latestRoomMessage(guest);
    if (snapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshot.");
    expect(snapshot.room).toMatchObject({ roomCode: assigned.roomCode, kind: "map-tap", hostPlayerId: assigned.playerId, categoryIds: ["map-tap"] });
    // MapTap's own defaults, not the quiz's 30-second timer.
    expect(snapshot.room.settings.roundDurationMs).toBe(45_000);
    expect(snapshot.room.players.map((player) => [player.name, player.avatarEmoji])).toEqual([["Host", "🦊"], ["Guest", undefined]]);
    expect(snapshot.room.chatMessages).toHaveLength(1);

    manager.handleMessage(host, { type: "START_GAME" }, 1040);
    expect(host.messages.some((message) => message.type === "GAME_STARTED" && message.round.prompt.kind === "maptap-globe")).toBe(true);
  });

  it("lets a late joiner watch a running game instead of turning them away", () => {
    const manager = new RoomManager({ countryIndex });
    const host = new TestConnection();
    const late = new TestConnection();
    manager.handleMessage(host, { type: "CREATE_ROOM", playerName: "Host", categoryIds: ["flags"] }, 1000);
    const assigned = host.messages.find((message) => message.type === "SESSION_ASSIGNED");
    if (assigned?.type !== "SESSION_ASSIGNED") throw new Error("Expected assigned host session.");
    manager.handleMessage(host, { type: "START_GAME" }, 1010);
    manager.handleMessage(late, { type: "JOIN_ROOM", roomCode: assigned.roomCode, playerName: "Late" }, 1020);
    expect(late.messages.some((message) => message.type === "SESSION_ASSIGNED")).toBe(true);
    const snapshot = latestRoomMessage(late);
    if (snapshot?.type !== "ROOM_SNAPSHOT") throw new Error("Expected room snapshot.");
    expect(snapshot.room.status).toBe("playing");
    expect(snapshot.room.players.find((player) => player.name === "Late")?.spectator).toBe(true);
  });
});
