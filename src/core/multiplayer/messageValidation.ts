import type { ClientMessage, ServerMessage } from "./protocol";
import type { FinalResult, PublicPlayerState, PublicRoomState, PublicRoundState, RoundResult } from "./roomTypes";

export const MAX_CLIENT_MESSAGE_BYTES = 2048;
export const MAX_PLAYER_NAME_LENGTH = 32;
export const MAX_ROOM_CODE_LENGTH = 12;
export const MAX_ANSWER_LENGTH = 80;

export type MessageParseResult<T> =
  | { readonly ok: true; readonly message: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

function reject<T>(code: string, message: string): MessageParseResult<T> {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function normalizePlayerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_PLAYER_NAME_LENGTH);
}

export function normalizeRoomCode(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function parseJsonMessage(raw: string): MessageParseResult<unknown> {
  try {
    return { ok: true, message: JSON.parse(raw) as unknown };
  } catch {
    return reject("invalid-json", "Message must be valid JSON.");
  }
}

export function parseClientMessage(value: unknown): MessageParseResult<ClientMessage> {
  if (!isRecord(value) || typeof value.type !== "string") return reject("invalid-message", "Message must be an object with a type.");

  switch (value.type) {
    case "CREATE_ROOM": {
      if (!isNonEmptyString(value.playerName, MAX_PLAYER_NAME_LENGTH)) return reject("invalid-player-name", "Player name is required.");
      if (!isNonEmptyString(value.modeId, 32)) return reject("invalid-mode", "Mode is required.");
      return { ok: true, message: { type: "CREATE_ROOM", playerName: normalizePlayerName(value.playerName), modeId: value.modeId.trim() } };
    }
    case "JOIN_ROOM": {
      if (!isNonEmptyString(value.roomCode, MAX_ROOM_CODE_LENGTH)) return reject("invalid-room-code", "Room code is required.");
      if (!isNonEmptyString(value.playerName, MAX_PLAYER_NAME_LENGTH)) return reject("invalid-player-name", "Player name is required.");
      return { ok: true, message: { type: "JOIN_ROOM", roomCode: normalizeRoomCode(value.roomCode), playerName: normalizePlayerName(value.playerName) } };
    }
    case "REJOIN_ROOM": {
      if (!isNonEmptyString(value.roomCode, MAX_ROOM_CODE_LENGTH)) return reject("invalid-room-code", "Room code is required.");
      if (!isNonEmptyString(value.playerId, 64)) return reject("invalid-session", "Player id is required.");
      if (!isNonEmptyString(value.sessionToken, 128)) return reject("invalid-session", "Session token is required.");
      return { ok: true, message: { type: "REJOIN_ROOM", roomCode: normalizeRoomCode(value.roomCode), playerId: value.playerId, sessionToken: value.sessionToken } };
    }
    case "LEAVE_ROOM":
      return { ok: true, message: { type: "LEAVE_ROOM" } };
    case "SET_READY":
      if (!isBoolean(value.ready)) return reject("invalid-ready", "Ready must be a boolean.");
      return { ok: true, message: { type: "SET_READY", ready: value.ready } };
    case "START_GAME":
      return { ok: true, message: { type: "START_GAME" } };
    case "SUBMIT_ANSWER":
      if (!isNonEmptyString(value.answer, MAX_ANSWER_LENGTH)) return reject("invalid-answer", "Answer is required.");
      if (!isFiniteNumber(value.clientSentAt)) return reject("invalid-client-time", "Client sent timestamp is required.");
      return { ok: true, message: { type: "SUBMIT_ANSWER", answer: value.answer.trim(), clientSentAt: value.clientSentAt } };
    case "REQUEST_HINT":
      return { ok: true, message: { type: "REQUEST_HINT" } };
    default:
      return reject("unknown-message", "Unknown message type.");
  }
}

function isPlayer(value: unknown): value is PublicPlayerState {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.connected === "boolean" &&
    typeof value.ready === "boolean" &&
    isFiniteNumber(value.score) &&
    isFiniteNumber(value.streak) &&
    isFiniteNumber(value.correctAnswers) &&
    isFiniteNumber(value.wrongAnswers)
  );
}

function isRound(value: unknown): value is PublicRoundState {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["roundNumber", "flagSrc", "startedAt", "endsAt"]) &&
    isFiniteNumber(value.roundNumber) &&
    typeof value.flagSrc === "string" &&
    isFiniteNumber(value.startedAt) &&
    (value.endsAt === null || isFiniteNumber(value.endsAt))
  );
}

function isRoom(value: unknown): value is PublicRoomState {
  return (
    isRecord(value) &&
    typeof value.roomCode === "string" &&
    typeof value.hostPlayerId === "string" &&
    typeof value.modeId === "string" &&
    (value.status === "lobby" || value.status === "playing" || value.status === "round-result" || value.status === "complete") &&
    Array.isArray(value.players) &&
    value.players.every(isPlayer) &&
    (value.round === null || isRound(value.round)) &&
    (value.phaseStartedAt === null || isFiniteNumber(value.phaseStartedAt)) &&
    (value.phaseEndsAt === null || isFiniteNumber(value.phaseEndsAt))
  );
}

function isRoundResult(value: unknown): value is RoundResult {
  return isRecord(value) && typeof value.playerId === "string" && typeof value.correct === "boolean" && isFiniteNumber(value.points) && (value.answeredAt === null || isFiniteNumber(value.answeredAt));
}

function isFinalResult(value: unknown): value is FinalResult {
  return isRecord(value) && typeof value.playerId === "string" && isFiniteNumber(value.rank) && isFiniteNumber(value.score) && isFiniteNumber(value.correctAnswers);
}

export function parseServerMessage(value: unknown): MessageParseResult<ServerMessage> {
  if (!isRecord(value) || typeof value.type !== "string") return reject("invalid-message", "Message must be an object with a type.");

  switch (value.type) {
    case "SESSION_ASSIGNED":
      if (typeof value.playerId !== "string" || typeof value.roomCode !== "string" || typeof value.sessionToken !== "string") return reject("invalid-session", "Session assignment is invalid.");
      return { ok: true, message: { type: "SESSION_ASSIGNED", playerId: value.playerId, roomCode: value.roomCode, sessionToken: value.sessionToken } };
    case "ROOM_SNAPSHOT":
      if (!isRoom(value.room)) return reject("invalid-room", "Room snapshot is invalid.");
      return { ok: true, message: { type: "ROOM_SNAPSHOT", room: value.room } };
    case "PLAYER_JOINED":
      if (!isPlayer(value.player)) return reject("invalid-player", "Joined player is invalid.");
      return { ok: true, message: { type: "PLAYER_JOINED", player: value.player } };
    case "PLAYER_LEFT":
      if (typeof value.playerId !== "string" || typeof value.name !== "string") return reject("invalid-player", "Player id is invalid.");
      return { ok: true, message: { type: "PLAYER_LEFT", playerId: value.playerId, name: value.name } };
    case "GAME_STARTED":
    case "ROUND_STARTED":
      if (!isRound(value.round)) return reject("invalid-round", "Round state is invalid.");
      return { ok: true, message: { type: value.type, round: value.round } };
    case "ANSWER_ACCEPTED":
      if (typeof value.playerId !== "string" || !isFiniteNumber(value.points)) return reject("invalid-answer", "Accepted answer is invalid.");
      return { ok: true, message: { type: "ANSWER_ACCEPTED", playerId: value.playerId, points: value.points } };
    case "ANSWER_REJECTED":
      if (typeof value.reason !== "string") return reject("invalid-answer", "Rejected answer is invalid.");
      return { ok: true, message: { type: "ANSWER_REJECTED", reason: value.reason } };
    case "ROUND_ENDED":
      if (typeof value.countryCode !== "string" || typeof value.countryName !== "string" || !Array.isArray(value.results) || !value.results.every(isRoundResult)) {
        return reject("invalid-round-result", "Round result is invalid.");
      }
      return { ok: true, message: { type: "ROUND_ENDED", countryCode: value.countryCode, countryName: value.countryName, results: value.results } };
    case "GAME_COMPLETED":
      if (!Array.isArray(value.results) || !value.results.every(isFinalResult)) return reject("invalid-final-result", "Final result is invalid.");
      return { ok: true, message: { type: "GAME_COMPLETED", results: value.results } };
    case "ERROR":
      if (typeof value.code !== "string" || typeof value.message !== "string") return reject("invalid-error", "Error message is invalid.");
      return { ok: true, message: { type: "ERROR", code: value.code, message: value.message } };
    default:
      return reject("unknown-message", "Unknown message type.");
  }
}
