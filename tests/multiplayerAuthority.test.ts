import { expect, it, vi } from "vitest";
import { RoomManager, type MultiplayerConnection } from "../server/rooms/RoomManager";
import { Room } from "../server/rooms/Room";
import { GeoGuessrRoom } from "../server/rooms/GeoGuessrRoom";
import { MapTapRoom } from "../server/rooms/MapTapRoom";
import { indexCountries, rawCountries } from "../src/core/countries";
import type { ServerMessage } from "../src/core/multiplayer";

const countries = indexCountries(rawCountries);
function connection(userId: string | null) {
  const messages: ServerMessage[] = [];
  const socket: MultiplayerConnection = { authenticatedName: userId ? "AccountPlayer" : null, authenticatedUserId: userId, send: (text) => messages.push(JSON.parse(text)) };
  return { socket, messages };
}

it("records multiplayer results from authoritative standings once and binds reconnects to the account", () => {
  const completed = vi.fn();
  const manager = new RoomManager({ countryIndex: countries, onGameComplete: completed });
  const owner = connection("owner-account");
  manager.handleMessage(owner.socket, { type: "CREATE_ROOM", playerName: "FakeName", categoryIds: ["codes"], roundLimit: 3 }, 1000);
  const session = owner.messages.find((m) => m.type === "SESSION_ASSIGNED");
  if (session?.type !== "SESSION_ASSIGNED") throw new Error("No seat");
  const other = connection("wrong-account");
  manager.handleMessage(other.socket, { type: "REJOIN_ROOM", ...{ roomCode: session.roomCode, playerId: session.playerId, sessionToken: session.sessionToken } }, 1001);
  expect(other.messages.at(-1)).toMatchObject({ type: "ERROR", code: "session-expired" });
  manager.handleMessage(owner.socket, { type: "START_GAME" }, 1010);
  for (let i = 0; i < 3; i++) {
    const started = [...owner.messages].reverse().find((m) => m.type === "GAME_STARTED" || m.type === "ROUND_STARTED");
    if (!started || (started.type !== "GAME_STARTED" && started.type !== "ROUND_STARTED")) throw new Error("No round");
    const country = countries.byCode.get(started.round.prompt.value)!;
    const now = 1020 + i * 5000;
    manager.handleMessage(owner.socket, { type: "SUBMIT_ANSWER", answer: country.name, clientSentAt: 0 }, now);
    if (i < 2) manager.sweep(now + 5000);
  }
  manager.sweep(16_020);
  expect(completed).toHaveBeenCalledTimes(1);
  expect(completed.mock.calls[0]).toEqual(["owner-account", expect.objectContaining({ mode: "multiplayer", rank: 1, totalPlayers: 1, correctAnswers: 3 })]);
  manager.sweep(100_000);
  expect(completed).toHaveBeenCalledTimes(1);
});

it("refuses answers and pins after deadlines even before the next room sweep", () => {
  const quiz = new Room({ code: "QUIZ1", hostPlayerId: "host", hostName: "Host", countryIndex: countries, categoryIds: ["codes"], seed: "fixture", now: 0, roundDurationMs: 1000 });
  quiz.startGame("host", 1000);
  expect(quiz.submitAnswer("host", "Brazil", 2000)).toMatchObject({ ok: false, code: "round-not-open" });
  const pin = new MapTapRoom({ code: "PIN01", hostPlayerId: "host", hostName: "Host", seed: "fixture", now: 0, roundDurationMs: 1000 });
  pin.startGame("host", 1000);
  expect(pin.submitGuess("host", 0, 0, 2000)).toMatchObject({ ok: false, code: "round-not-open" });
  const street = new GeoGuessrRoom({ code: "STRT1", hostPlayerId: "host", hostName: "Host", countryIndex: countries, seed: "fixture", now: 0, roundDurationMs: 1000 });
  street.startGame("host", 1000);
  expect(street.submitGuess("host", 0, 0, 2000)).toMatchObject({ ok: false, code: "round-not-open" });
});
