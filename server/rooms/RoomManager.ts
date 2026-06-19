import { rawCountries, indexCountries, type CountryIndex } from "../../src/core/countries";
import { MAX_ANSWER_LENGTH, parseClientMessage, type ClientMessage, type MessageParseResult, type RoomCode, type ServerMessage } from "../../src/core/multiplayer";
import { parseRawClientMessage } from "../protocol/parseMessage";
import { DEFAULT_MAX_PLAYERS_PER_ROOM, DEFAULT_RESULT_DISPLAY_MS, Room, type RoomResult } from "./Room";
import { MapTapRoom } from "./MapTapRoom";
import { getCategory, resolveCategoryIds } from "../../src/core/categories";

export interface MultiplayerConnection {
  readonly send: (message: string) => unknown;
  readonly close?: (code?: number, reason?: string) => void;
  // Set from the session cookie at WebSocket upgrade time; null for guests.
  // Guests supply a name via CREATE_ROOM/JOIN_ROOM; authenticated users have
  // their account display name used instead so it can't be spoofed by the client.
  readonly authenticatedName: string | null;
}

export interface PlayerSession {
  readonly playerId: string;
  readonly roomCode: RoomCode;
  readonly sessionToken: string;
  readonly answerWindowStartedAt: number;
  readonly answerCount: number;
}

export interface RoomManagerOptions {
  readonly countryIndex?: CountryIndex;
  readonly maxRooms?: number;
  readonly maxPlayersPerRoom?: number;
  readonly roomTtlMs?: number;
  readonly emptyRoomTtlMs?: number;
  readonly answerRateLimitPerSecond?: number;
  readonly resultDisplayMs?: number;
}

export interface RoomManagerStats {
  readonly rooms: number;
  readonly connections: number;
}

const DEFAULT_MAX_ROOMS = 500;
const DEFAULT_ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_EMPTY_ROOM_TTL_MS = 30_000;
const DEFAULT_ANSWER_RATE_LIMIT_PER_SECOND = 5;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function createRoomCode(existingCodes: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    let code = "";
    for (let index = 0; index < 5; index += 1) code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)] ?? "X";
    if (!existingCodes.has(code)) return code;
  }
  return createId("ROOM").slice(-8).toUpperCase();
}

function send(connection: MultiplayerConnection, message: ServerMessage): void {
  connection.send(JSON.stringify(message));
}

function sendError(connection: MultiplayerConnection, code: string, message: string): void {
  send(connection, { type: "ERROR", code, message });
}

function defaultCountryIndex(): CountryIndex {
  return indexCountries(rawCountries);
}

function hasSupportedCategory(categoryIds: readonly string[]): boolean {
  if (categoryIds.length === 1 && categoryIds[0] === "map-tap") return true;
  return categoryIds.some((id) => getCategory(id) !== undefined);
}

function isMapTapRoom(room: Room | MapTapRoom): room is MapTapRoom {
  return room instanceof MapTapRoom;
}

export class RoomManager {
  private readonly countryIndex: CountryIndex;
  private readonly maxRooms: number;
  private readonly maxPlayersPerRoom: number;
  private readonly roomTtlMs: number;
  private readonly emptyRoomTtlMs: number;
  private readonly answerRateLimitPerSecond: number;
  private readonly resultDisplayMs: number;
  private readonly rooms = new Map<RoomCode, Room | MapTapRoom>();
  private readonly sessionByConnection = new WeakMap<MultiplayerConnection, PlayerSession>();
  private readonly connectionByPlayerId = new Map<string, MultiplayerConnection>();
  // Survives disconnects so a reconnecting client can reclaim its player slot/score within the
  // empty-room TTL window. Keyed by the opaque token handed out in SESSION_ASSIGNED.
  private readonly sessionsByToken = new Map<string, { readonly playerId: string; readonly roomCode: RoomCode }>();

  constructor(options: RoomManagerOptions = {}) {
    this.countryIndex = options.countryIndex ?? defaultCountryIndex();
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.maxPlayersPerRoom = options.maxPlayersPerRoom ?? DEFAULT_MAX_PLAYERS_PER_ROOM;
    this.roomTtlMs = options.roomTtlMs ?? DEFAULT_ROOM_TTL_MS;
    this.emptyRoomTtlMs = options.emptyRoomTtlMs ?? DEFAULT_EMPTY_ROOM_TTL_MS;
    this.answerRateLimitPerSecond = options.answerRateLimitPerSecond ?? DEFAULT_ANSWER_RATE_LIMIT_PER_SECOND;
    this.resultDisplayMs = options.resultDisplayMs ?? DEFAULT_RESULT_DISPLAY_MS;
  }

  stats(): RoomManagerStats {
    return { rooms: this.rooms.size, connections: this.connectionByPlayerId.size };
  }

  attach(_connection: MultiplayerConnection): void {}

  detach(connection: MultiplayerConnection, now = Date.now()): void {
    const session = this.sessionByConnection.get(connection);
    if (!session) return;
    this.connectionByPlayerId.delete(session.playerId);
    this.sessionByConnection.delete(connection);
    const room = this.rooms.get(session.roomCode);
    if (room) {
      // Keep the room and the token alive: a dropped connection may be a brief blip, and the
      // player can REJOIN_ROOM to reclaim their slot. Empty rooms are reaped by the TTL sweep.
      this.broadcastResult(room, room.disconnectPlayer(session.playerId, now));
    }
  }

  handleRawMessage(connection: MultiplayerConnection, rawMessage: string | ArrayBuffer | Uint8Array, now = Date.now()): void {
    const parsed = parseRawClientMessage(rawMessage);
    if (!parsed.ok) {
      sendError(connection, parsed.code, parsed.message);
      return;
    }
    this.handleClientMessage(connection, parsed.message, now);
  }

  handleMessage(connection: MultiplayerConnection, value: unknown, now = Date.now()): void {
    const parsed = parseClientMessage(value);
    if (!parsed.ok) {
      sendError(connection, parsed.code, parsed.message);
      return;
    }
    this.handleClientMessage(connection, parsed.message, now);
  }

  sweep(now = Date.now()): void {
    for (const room of this.rooms.values()) {
      // A single deadline drives both the round timeout and the result-display gap, so a fast
      // tick lands transitions within the tick interval instead of the old multi-second jitter.
      const dueAt = room.pendingTransitionAt;
      if (dueAt !== null && dueAt <= now) {
        if (room.state === "playing") this.broadcastResult(room, room.endRound(now));
        else if (room.state === "round-result") this.broadcastResult(room, room.advanceAfterResult(now));
      }

      const ttl = room.isEmpty ? this.emptyRoomTtlMs : this.roomTtlMs;
      if (room.updatedAt + ttl <= now) this.deleteRoom(room.code);
    }
  }

  private handleClientMessage(connection: MultiplayerConnection, message: ClientMessage, now: number): void {
    switch (message.type) {
      case "CREATE_ROOM":
        this.createRoom(connection, message.playerName, message.categoryIds, now, {
          ...(message.roundLimit !== undefined ? { roundLimit: message.roundLimit } : {}),
          ...(message.roundDurationMs !== undefined ? { roundDurationMs: message.roundDurationMs } : {}),
        });
        return;
      case "JOIN_ROOM":
        this.joinRoom(connection, message.roomCode, message.playerName, now);
        return;
      case "REJOIN_ROOM":
        this.rejoinRoom(connection, message.roomCode, message.playerId, message.sessionToken, now);
        return;
      case "LEAVE_ROOM":
        this.leaveRoom(connection, now);
        return;
      case "SET_READY":
        this.withSessionRoom(connection, (room, session) => this.sendRoomResult(connection, room, room.setReady(session.playerId, message.ready, now)));
        return;
      case "SET_ROOM_OPTIONS":
        if (!hasSupportedCategory(message.categoryIds)) {
          sendError(connection, "invalid-category", "Unsupported category selection.");
          return;
        }
        this.withSessionRoom(connection, (room, session) => {
          if (isMapTapRoom(room)) {
            this.sendRoomResult(connection, room, room.updateOptions(session.playerId, { ...(message.roundLimit !== undefined ? { roundLimit: message.roundLimit } : {}), ...(message.roundDurationMs !== undefined ? { roundDurationMs: message.roundDurationMs } : {}) }, now));
          } else {
            this.sendRoomResult(connection, room, room.updateOptions(session.playerId, { categoryIds: resolveCategoryIds(message.categoryIds), ...(message.roundLimit !== undefined ? { roundLimit: message.roundLimit } : {}), ...(message.roundDurationMs !== undefined ? { roundDurationMs: message.roundDurationMs } : {}) }, now));
          }
        });
        return;
      case "START_GAME":
        this.withSessionRoom(connection, (room, session) => this.sendRoomResult(connection, room, room.startGame(session.playerId, now)));
        return;
      case "PLAY_AGAIN":
        this.withSessionRoom(connection, (room, session) => this.sendRoomResult(connection, room, room.restart(session.playerId, now)));
        return;
      case "SUBMIT_ANSWER":
        if (message.answer.length > MAX_ANSWER_LENGTH) {
          sendError(connection, "invalid-answer", "Answer is too long.");
          return;
        }
        this.withSessionRoom(connection, (room, session) => {
          if (isMapTapRoom(room)) { sendError(connection, "wrong-mode", "Use SUBMIT_MAPTAP_GUESS in a MapTap room."); return; }
          const limited = this.rateLimitAnswer(connection, session, now);
          if (!limited.ok) { sendError(connection, limited.code, limited.message); return; }
          this.sendRoomResult(connection, room, room.submitAnswer(session.playerId, message.answer, now));
        });
        return;
      case "SUBMIT_MAPTAP_GUESS":
        this.withSessionRoom(connection, (room, session) => {
          if (!isMapTapRoom(room)) { sendError(connection, "wrong-mode", "This is not a MapTap room."); return; }
          this.sendRoomResult(connection, room, room.submitGuess(session.playerId, message.lat, message.lng, now));
        });
        return;
      case "VOTE_SKIP":
        this.withSessionRoom(connection, (room, session) => this.sendRoomResult(connection, room, room.voteSkip(session.playerId, now)));
        return;
      case "REQUEST_HINT":
        sendError(connection, "hints-disabled", "Multiplayer hints are not enabled.");
        return;
    }
  }

  private createRoom(connection: MultiplayerConnection, playerName: string, categoryIds: readonly string[], now: number, settings: { readonly roundLimit?: number; readonly roundDurationMs?: number }): void {
    if (this.rooms.size >= this.maxRooms) {
      sendError(connection, "too-many-rooms", "The server is at room capacity.");
      return;
    }

    if (!hasSupportedCategory(categoryIds)) {
      sendError(connection, "invalid-category", "Unsupported category selection.");
      return;
    }

    this.detach(connection, now);
    const roomCode = createRoomCode(new Set(this.rooms.keys()));
    const playerId = createId("player");
    const isMapTap = categoryIds.length === 1 && categoryIds[0] === "map-tap";
    const room = isMapTap
      ? new MapTapRoom({
          code: roomCode,
          hostPlayerId: playerId,
          hostName: connection.authenticatedName ?? playerName,
          seed: createId("seed"),
          now,
          maxPlayers: this.maxPlayersPerRoom,
          ...(settings.roundLimit !== undefined ? { roundLimit: settings.roundLimit } : {}),
          ...(settings.roundDurationMs !== undefined ? { roundDurationMs: settings.roundDurationMs } : {}),
        })
      : new Room({
          code: roomCode,
          hostPlayerId: playerId,
          hostName: connection.authenticatedName ?? playerName,
          countryIndex: this.countryIndex,
          categoryIds: resolveCategoryIds(categoryIds),
          seed: createId("seed"),
          now,
          maxPlayers: this.maxPlayersPerRoom,
          ...(settings.roundLimit !== undefined ? { roundLimit: settings.roundLimit } : {}),
          ...(settings.roundDurationMs !== undefined ? { roundDurationMs: settings.roundDurationMs } : {}),
          resultDisplayMs: this.resultDisplayMs,
        });
    this.rooms.set(roomCode, room);
    const sessionToken = this.issueToken(playerId, roomCode);
    this.assignSession(connection, { playerId, roomCode, sessionToken, answerWindowStartedAt: now, answerCount: 0 });
    send(connection, { type: "SESSION_ASSIGNED", playerId, roomCode, sessionToken });
    send(connection, { type: "ROOM_SNAPSHOT", room: room.snapshot() });
  }

  private joinRoom(connection: MultiplayerConnection, roomCode: RoomCode, playerName: string, now: number): void {
    const room = this.rooms.get(roomCode);
    if (!room) {
      sendError(connection, "room-not-found", "No room exists with that code.");
      return;
    }

    this.detach(connection, now);
    const playerId = createId("player");
    const result = room.addPlayer(playerId, connection.authenticatedName ?? playerName, now);
    if (!result.ok) {
      sendError(connection, result.code, result.message);
      return;
    }

    const sessionToken = this.issueToken(playerId, roomCode);
    this.assignSession(connection, { playerId, roomCode, sessionToken, answerWindowStartedAt: now, answerCount: 0 });
    send(connection, { type: "SESSION_ASSIGNED", playerId, roomCode, sessionToken });
    this.broadcastMessages(room, result.messages);
  }

  private rejoinRoom(connection: MultiplayerConnection, roomCode: RoomCode, playerId: string, sessionToken: string, now: number): void {
    const claim = this.sessionsByToken.get(sessionToken);
    if (!claim || claim.playerId !== playerId || claim.roomCode !== roomCode) {
      sendError(connection, "session-expired", "Your previous session has expired. Rejoin with the room code.");
      return;
    }

    const room = this.rooms.get(roomCode);
    if (!room) {
      this.sessionsByToken.delete(sessionToken);
      sendError(connection, "room-not-found", "The room no longer exists.");
      return;
    }

    const result = room.reconnectPlayer(playerId, now);
    if (!result.ok) {
      this.sessionsByToken.delete(sessionToken);
      sendError(connection, result.code, result.message);
      return;
    }

    this.detach(connection, now);
    this.assignSession(connection, { playerId, roomCode, sessionToken, answerWindowStartedAt: now, answerCount: 0 });
    send(connection, { type: "SESSION_ASSIGNED", playerId, roomCode, sessionToken });
    this.broadcastMessages(room, result.messages);
  }

  private leaveRoom(connection: MultiplayerConnection, now: number): void {
    const session = this.sessionByConnection.get(connection);
    if (!session) return;
    const room = this.rooms.get(session.roomCode);
    this.connectionByPlayerId.delete(session.playerId);
    this.sessionByConnection.delete(connection);
    this.sessionsByToken.delete(session.sessionToken);
    if (room) {
      this.broadcastResult(room, room.removePlayer(session.playerId, now));
      if (room.isEmpty) this.deleteRoom(room.code);
    }
  }

  private assignSession(connection: MultiplayerConnection, session: PlayerSession): void {
    this.sessionByConnection.set(connection, session);
    this.connectionByPlayerId.set(session.playerId, connection);
  }

  private issueToken(playerId: string, roomCode: RoomCode): string {
    const token = createId("session");
    this.sessionsByToken.set(token, { playerId, roomCode });
    return token;
  }

  private withSessionRoom(connection: MultiplayerConnection, action: (room: Room | MapTapRoom, session: PlayerSession) => void): void {
    const session = this.sessionByConnection.get(connection);
    if (!session) {
      sendError(connection, "not-in-room", "Join or create a room first.");
      return;
    }

    const room = this.rooms.get(session.roomCode);
    if (!room) {
      sendError(connection, "room-not-found", "The room no longer exists.");
      return;
    }

    action(room, session);
  }

  private rateLimitAnswer(connection: MultiplayerConnection, session: PlayerSession, now: number): MessageParseResult<PlayerSession> {
    const elapsed = now - session.answerWindowStartedAt;
    const nextSession = elapsed >= 1000
      ? { ...session, answerWindowStartedAt: now, answerCount: 1 }
      : { ...session, answerCount: session.answerCount + 1 };
    this.assignSession(connection, nextSession);

    if (nextSession.answerCount > this.answerRateLimitPerSecond) return { ok: false, code: "answer-rate-limited", message: "Too many answers. Slow down." };
    return { ok: true, message: nextSession };
  }

  private sendRoomResult(connection: MultiplayerConnection, room: Room | MapTapRoom, result: RoomResult): void {
    if (!result.ok) {
      sendError(connection, result.code, result.message);
      return;
    }
    if (result.reply) for (const message of result.reply) send(connection, message);
    this.broadcastMessages(room, result.messages);
  }

  private broadcastResult(room: Room | MapTapRoom, result: RoomResult): void {
    if (!result.ok) return;
    this.broadcastMessages(room, result.messages);
  }

  private broadcastMessages(room: Room | MapTapRoom, messages: readonly ServerMessage[]): void {
    for (const message of messages) {
      for (const player of room.snapshot().players) {
        const connection = this.connectionByPlayerId.get(player.id);
        if (connection) send(connection, message);
      }
    }
  }

  private deleteRoom(roomCode: RoomCode): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    for (const player of room.snapshot().players) this.connectionByPlayerId.delete(player.id);
    for (const [token, claim] of this.sessionsByToken) if (claim.roomCode === roomCode) this.sessionsByToken.delete(token);
    this.rooms.delete(roomCode);
  }
}
