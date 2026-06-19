import type { ClientMessage, ServerMessage } from "./protocol";
import type { FinalResult, MapTapRoundResult, PublicPlayerState, PublicRoomState, PublicRoundState, RoundResult } from "./roomTypes";

export const MAX_CLIENT_MESSAGE_BYTES = 2048;
export const MAX_PLAYER_NAME_LENGTH = 32;
export const MAX_ROOM_CODE_LENGTH = 12;
export const MAX_ANSWER_LENGTH = 80;
export const MAX_ROOM_CATEGORY_IDS = 8;
export const MIN_ROOM_ROUND_LIMIT = 3;
export const MAX_ROOM_ROUND_LIMIT = 20;
export const MIN_ROOM_ROUND_DURATION_MS = 10_000;
export const MAX_ROOM_ROUND_DURATION_MS = 90_000;

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

function clampInteger(value: unknown, min: number, max: number): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
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

function isCategoryIdList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_ROOM_CATEGORY_IDS && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function isPromptContent(value: unknown): boolean {
  return isRecord(value) && (value.kind === "image" || value.kind === "text" || value.kind === "map-click" || value.kind === "map-highlight" || value.kind === "flag-colors" || value.kind === "maptap-globe") && typeof value.value === "string";
}

export function parseClientMessage(value: unknown): MessageParseResult<ClientMessage> {
  if (!isRecord(value) || typeof value.type !== "string") return reject("invalid-message", "Message must be an object with a type.");

  switch (value.type) {
    case "CREATE_ROOM": {
      if (!isNonEmptyString(value.playerName, MAX_PLAYER_NAME_LENGTH)) return reject("invalid-player-name", "Player name is required.");
      if (!isCategoryIdList(value.categoryIds)) return reject("invalid-category", "At least one category is required.");
      const roundLimit = clampInteger(value.roundLimit, MIN_ROOM_ROUND_LIMIT, MAX_ROOM_ROUND_LIMIT);
      const roundDurationMs = clampInteger(value.roundDurationMs, MIN_ROOM_ROUND_DURATION_MS, MAX_ROOM_ROUND_DURATION_MS);
      if (value.roundLimit !== undefined && roundLimit === null) return reject("invalid-room-settings", "Round count is invalid.");
      if (value.roundDurationMs !== undefined && roundDurationMs === null) return reject("invalid-room-settings", "Round timer is invalid.");
      return {
        ok: true,
        message: {
          type: "CREATE_ROOM",
          playerName: normalizePlayerName(value.playerName),
          categoryIds: value.categoryIds.map((id) => id.trim()),
          ...(roundLimit !== null ? { roundLimit } : {}),
          ...(roundDurationMs !== null ? { roundDurationMs } : {}),
        },
      };
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
    case "SET_ROOM_OPTIONS": {
      if (!isCategoryIdList(value.categoryIds)) return reject("invalid-category", "At least one category is required.");
      const roundLimit = clampInteger(value.roundLimit, MIN_ROOM_ROUND_LIMIT, MAX_ROOM_ROUND_LIMIT);
      const roundDurationMs = clampInteger(value.roundDurationMs, MIN_ROOM_ROUND_DURATION_MS, MAX_ROOM_ROUND_DURATION_MS);
      if (value.roundLimit !== undefined && roundLimit === null) return reject("invalid-room-settings", "Round count is invalid.");
      if (value.roundDurationMs !== undefined && roundDurationMs === null) return reject("invalid-room-settings", "Round timer is invalid.");
      return {
        ok: true,
        message: {
          type: "SET_ROOM_OPTIONS",
          categoryIds: value.categoryIds.map((id) => id.trim()),
          ...(roundLimit !== null ? { roundLimit } : {}),
          ...(roundDurationMs !== null ? { roundDurationMs } : {}),
        },
      };
    }
    case "START_GAME":
      return { ok: true, message: { type: "START_GAME" } };
    case "PLAY_AGAIN":
      return { ok: true, message: { type: "PLAY_AGAIN" } };
    case "SUBMIT_ANSWER":
      if (!isNonEmptyString(value.answer, MAX_ANSWER_LENGTH)) return reject("invalid-answer", "Answer is required.");
      if (!isFiniteNumber(value.clientSentAt)) return reject("invalid-client-time", "Client sent timestamp is required.");
      return { ok: true, message: { type: "SUBMIT_ANSWER", answer: value.answer.trim(), clientSentAt: value.clientSentAt } };
    case "SUBMIT_MAPTAP_GUESS":
      if (!isFiniteNumber(value.lat) || (value.lat as number) < -90 || (value.lat as number) > 90) return reject("invalid-guess", "Latitude is out of range.");
      if (!isFiniteNumber(value.lng)) return reject("invalid-guess", "Longitude is required.");
      if (!isFiniteNumber(value.clientSentAt)) return reject("invalid-client-time", "Client sent timestamp is required.");
      return { ok: true, message: { type: "SUBMIT_MAPTAP_GUESS", lat: value.lat as number, lng: value.lng as number, clientSentAt: value.clientSentAt as number } };
    case "VOTE_SKIP":
      return { ok: true, message: { type: "VOTE_SKIP" } };
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
    hasOnlyKeys(value, ["roundNumber", "prompt", "startedAt", "endsAt"]) &&
    isFiniteNumber(value.roundNumber) &&
    isPromptContent(value.prompt) &&
    isFiniteNumber(value.startedAt) &&
    (value.endsAt === null || isFiniteNumber(value.endsAt))
  );
}

function isRoom(value: unknown): value is PublicRoomState {
  return (
    isRecord(value) &&
    typeof value.roomCode === "string" &&
    typeof value.hostPlayerId === "string" &&
    isCategoryIdList(value.categoryIds) &&
    isRecord(value.settings) &&
    isFiniteNumber(value.settings.roundLimit) &&
    isFiniteNumber(value.settings.roundDurationMs) &&
    (value.status === "lobby" || value.status === "playing" || value.status === "round-result" || value.status === "complete") &&
    Array.isArray(value.players) &&
    value.players.every(isPlayer) &&
    (value.round === null || isRound(value.round)) &&
    Array.isArray(value.skipVotes) &&
    value.skipVotes.every((id) => typeof id === "string") &&
    isFiniteNumber(value.skipRequired) &&
    (value.phaseStartedAt === null || isFiniteNumber(value.phaseStartedAt)) &&
    (value.phaseEndsAt === null || isFiniteNumber(value.phaseEndsAt))
  );
}

function isRoundResult(value: unknown): value is RoundResult {
  return (
    isRecord(value) &&
    typeof value.playerId === "string" &&
    typeof value.name === "string" &&
    typeof value.correct === "boolean" &&
    isFiniteNumber(value.points) &&
    (value.answeredAt === null || isFiniteNumber(value.answeredAt)) &&
    (value.guess === null || typeof value.guess === "string")
  );
}

function isMapTapRoundResult(value: unknown): value is MapTapRoundResult {
  if (!isRecord(value)) return false;
  if (typeof value.playerId !== "string" || typeof value.name !== "string") return false;
  if (!isFiniteNumber(value.score)) return false;
  if (value.guess !== null && !(isRecord(value.guess) && isFiniteNumber(value.guess.lat) && isFiniteNumber(value.guess.lng))) return false;
  if (value.distanceKm !== null && !isFiniteNumber(value.distanceKm)) return false;
  return true;
}

function isFinalResult(value: unknown): value is FinalResult {
  return isRecord(value) && typeof value.playerId === "string" && typeof value.name === "string" && isFiniteNumber(value.rank) && isFiniteNumber(value.score) && isFiniteNumber(value.correctAnswers) && isFiniteNumber(value.wrongAnswers);
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
      if (typeof value.answer !== "string" || !Array.isArray(value.results) || !value.results.every(isRoundResult)) {
        return reject("invalid-round-result", "Round result is invalid.");
      }
      return { ok: true, message: { type: "ROUND_ENDED", answer: value.answer, results: value.results } };
    case "MAPTAP_ROUND_ENDED": {
      if (typeof value.targetName !== "string" || !isFiniteNumber(value.targetLat) || !isFiniteNumber(value.targetLng) || typeof value.wikiSlug !== "string") {
        return reject("invalid-maptap-result", "MapTap round result target is invalid.");
      }
      if (!Array.isArray(value.results) || !value.results.every(isMapTapRoundResult)) {
        return reject("invalid-maptap-result", "MapTap round results are invalid.");
      }
      return { ok: true, message: { type: "MAPTAP_ROUND_ENDED", targetName: value.targetName as string, targetLat: value.targetLat as number, targetLng: value.targetLng as number, wikiSlug: value.wikiSlug as string, results: value.results as MapTapRoundResult[] } };
    }
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
