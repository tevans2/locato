import { createSeededRandom } from "../../src/core/game/random";
import {
  DEFAULT_FLYOVER_MULTIPLAYER_DURATION_MS,
  FLYOVER_MULTIPLAYER_DURATIONS_MS,
  FLYOVER_SKIP_HOLD_SECONDS,
  FLYOVER_TAKEOFF_COUNTDOWN_MS,
  buildFlyoverRoute,
  isPlausibleReach,
  type FlyoverCountry,
  type FlyoverRoute,
} from "../../src/core/flyover";
import type { ProjectedPoint } from "../../src/core/map";
import { filterProfanity } from "../../src/core/multiplayer/profanity";
import type { FinalResult, FlyoverFlightPrompt, FlyoverPlanePosition, FlyoverProgressEvent, PlayerId, PublicChatMessage, PublicPlayerState, PublicRoomState, PublicRoundState, RoomCode } from "../../src/core/multiplayer/roomTypes";
import type { ServerMessage } from "../../src/core/multiplayer/protocol";
import type { RoomResult } from "./Room";

export const DEFAULT_FLYOVER_MAX_PLAYERS = 8;
const MAX_CHAT_HISTORY = 50;
// The client starts its holding pattern a network trip before the server hears about the skip,
// so the server's hold ends a little early rather than turning down an honest reach.
const SKIP_HOLD_SLACK_MS = 1_000;
// A reach that lands this soon before take-off (clock skew) still counts from take-off.
const TAKEOFF_SLACK_MS = 500;

/**
 * Flyover race: one flight per game. Everyone takes off together from the same place and flies
 * the same seeded route; each country reached scores a point and the most countries when the
 * clock runs out wins (ties go to whoever got there first).
 *
 * The server never flies the planes: it can't, without every keypress. It checks each claimed
 * reach instead — the right next country, a position that touches it, and a time an honest plane
 * could have flown it in — and relays everyone's positions so racers see each other.
 */

interface FlyoverPlayerState extends PublicPlayerState {
  readonly routeIndex: number;
  readonly skipped: number;
  /** Where and when this plane was last known to be, for the next reach's time check. */
  readonly lastPoint: ProjectedPoint;
  readonly lastAt: number;
  readonly lastReachAt: number | null;
  readonly holdUntil: number;
}

interface FlyoverFlight {
  readonly route: FlyoverRoute;
  readonly takeoffAt: number;
  readonly endsAt: number;
  readonly prompt: string;
}

type RoomStatus = PublicRoomState["status"];

function ok(messages: readonly ServerMessage[] = [], reply: readonly ServerMessage[] = []): RoomResult {
  return reply.length > 0 ? { ok: true, messages, reply } : { ok: true, messages };
}

function fail(code: string, message: string): RoomResult {
  return { ok: false, code, message };
}

function createPlayer(id: PlayerId, name: string): FlyoverPlayerState {
  return { id, name, connected: true, ready: false, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0, routeIndex: 0, skipped: 0, lastPoint: [0, 0], lastAt: 0, lastReachAt: null, holdUntil: 0 };
}

function toPublicPlayer(player: FlyoverPlayerState): PublicPlayerState {
  const { skipped: _skipped, lastPoint: _point, lastAt: _at, lastReachAt: _reach, holdUntil: _hold, ...publicPlayer } = player;
  return publicPlayer;
}

export function isFlyoverDuration(value: number): boolean {
  return (FLYOVER_MULTIPLAYER_DURATIONS_MS as readonly number[]).includes(value);
}

export class FlyoverRoom {
  readonly code: RoomCode;
  readonly seed: string;
  readonly maxPlayers: number;
  flightMs: number;

  private readonly countries: readonly FlyoverCountry[];
  private hostPlayerId: PlayerId;
  private status: RoomStatus = "lobby";
  private players = new Map<PlayerId, FlyoverPlayerState>();
  private flight: FlyoverFlight | null = null;
  private gamesPlayed = 0;
  private positions = new Map<PlayerId, FlyoverPlanePosition>();
  private positionsDirty = false;
  private touchedAt: number;
  private chatMessages: PublicChatMessage[] = [];
  private chatSequence = 0;

  constructor(options: {
    code: RoomCode;
    hostPlayerId: PlayerId;
    hostName: string;
    countries: readonly FlyoverCountry[];
    seed: string;
    now: number;
    maxPlayers?: number;
    flightMs?: number;
  }) {
    this.code = options.code;
    this.seed = options.seed;
    this.countries = options.countries;
    this.maxPlayers = options.maxPlayers ?? DEFAULT_FLYOVER_MAX_PLAYERS;
    this.flightMs = options.flightMs !== undefined && isFlyoverDuration(options.flightMs) ? options.flightMs : DEFAULT_FLYOVER_MULTIPLAYER_DURATION_MS;
    this.hostPlayerId = options.hostPlayerId;
    this.players.set(options.hostPlayerId, createPlayer(options.hostPlayerId, options.hostName));
    this.touchedAt = options.now;
  }

  get state(): RoomStatus { return this.status; }
  get isEmpty(): boolean { return this.players.size === 0 || [...this.players.values()].every((player) => !player.connected); }
  get updatedAt(): number { return this.touchedAt; }
  get pendingTransitionAt(): number | null { return this.status === "playing" ? (this.flight?.endsAt ?? null) : null; }

  touch(now: number): void { this.touchedAt = now; }

  snapshot(): PublicRoomState {
    return {
      roomCode: this.code,
      hostPlayerId: this.hostPlayerId,
      categoryIds: ["flyover"],
      settings: { roundLimit: 1, roundDurationMs: this.flightMs },
      status: this.status,
      players: [...this.players.values()].map(toPublicPlayer),
      round: this.publicRound,
      skipVotes: [],
      skipRequired: 0,
      phaseStartedAt: this.status === "playing" ? (this.flight?.takeoffAt ?? null) : null,
      phaseEndsAt: this.pendingTransitionAt,
      chatMessages: this.chatMessages,
    };
  }

  addPlayer(playerId: PlayerId, name: string, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "lobby") return fail("room-in-progress", "This room has already started.");
    if (this.players.size >= this.maxPlayers) return fail("room-full", "This room is full.");
    if (this.players.has(playerId)) return fail("duplicate-player", "Player is already in this room.");
    const player = createPlayer(playerId, name);
    this.players.set(playerId, player);
    return ok([{ type: "PLAYER_JOINED", player: toPublicPlayer(player) }, this.snapshotMessage()]);
  }

  removePlayer(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    const player = this.players.get(playerId);
    if (!player) return fail("not-in-room", "Player is not in this room.");
    this.players.delete(playerId);
    this.dropPosition(playerId);
    this.transferHostIfNeeded();
    return ok([{ type: "PLAYER_LEFT", playerId, name: player.name }, this.snapshotMessage()]);
  }

  reconnectPlayer(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    const player = this.players.get(playerId);
    if (!player) return fail("session-expired", "Your seat in this room is no longer available.");
    this.players.set(playerId, { ...player, connected: true });
    return ok([this.snapshotMessage()]);
  }

  disconnectPlayer(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    const player = this.players.get(playerId);
    if (!player) return fail("not-in-room", "Player is not in this room.");
    this.players.set(playerId, { ...player, connected: false, ready: false });
    this.dropPosition(playerId);
    this.transferHostIfNeeded();
    return ok([this.snapshotMessage()]);
  }

  setReady(playerId: PlayerId, ready: boolean, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "lobby") return fail("game-started", "Ready state can only change in the lobby.");
    const player = this.players.get(playerId);
    if (!player) return fail("not-in-room", "Player is not in this room.");
    this.players.set(playerId, { ...player, ready });
    return ok([this.snapshotMessage()]);
  }

  startGame(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "lobby") return fail("game-started", "The game has already started.");
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the room host can start the game.");
    if (![...this.players.values()].every((player) => player.id === this.hostPlayerId || !player.connected || player.ready)) {
      return fail("players-not-ready", "All connected non-host players must be ready.");
    }
    this.gamesPlayed += 1;
    const route = buildFlyoverRoute(this.countries, createSeededRandom(`${this.seed}:${this.gamesPlayed}`));
    const takeoffAt = now + FLYOVER_TAKEOFF_COUNTDOWN_MS;
    const prompt: FlyoverFlightPrompt = {
      start: { x: route.start.x, y: route.start.y, heading: route.start.heading },
      route: route.route.map((country) => country.code),
    };
    this.flight = { route, takeoffAt, endsAt: takeoffAt + this.flightMs, prompt: JSON.stringify(prompt) };
    for (const [id, player] of this.players) {
      this.players.set(id, { ...player, lastPoint: [route.start.x, route.start.y], lastAt: takeoffAt });
    }
    this.positions = new Map();
    this.positionsDirty = false;
    this.status = "playing";
    return ok([{ type: "GAME_STARTED", round: this.publicRound! }, this.snapshotMessage()]);
  }

  restart(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "complete") return fail("game-not-complete", "A rematch can only start after the game ends.");
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the room host can start a rematch.");
    for (const [id, player] of this.players) {
      this.players.set(id, { ...createPlayer(id, player.name), connected: player.connected });
    }
    this.flight = null;
    this.positions = new Map();
    this.status = "lobby";
    return ok([this.snapshotMessage()]);
  }

  updateOptions(playerId: PlayerId, options: { readonly roundDurationMs?: number }, now: number): RoomResult {
    this.touch(now);
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the room host can change room settings.");
    if (this.status !== "lobby") return fail("game-started", "Room settings can only change in the lobby.");
    if (options.roundDurationMs !== undefined) {
      if (!isFlyoverDuration(options.roundDurationMs)) return fail("invalid-room-settings", "That flight length isn't offered.");
      this.flightMs = options.roundDurationMs;
    }
    for (const [id, player] of this.players) {
      if (id !== this.hostPlayerId) this.players.set(id, { ...player, ready: false });
    }
    return ok([this.snapshotMessage()]);
  }

  /** Latest plane position, relayed to the room on the next tick. Quietly ignored off-flight. */
  updatePosition(playerId: PlayerId, x: number, y: number, heading: number, now: number): RoomResult {
    const player = this.players.get(playerId);
    if (this.status !== "playing" || !this.flight || now < this.flight.takeoffAt || !player?.connected) return ok();
    this.positions.set(playerId, { playerId, x, y, heading });
    this.positionsDirty = true;
    return ok();
  }

  /** Everyone's latest position, once per change: the manager broadcasts it on its tick. */
  drainPlanes(): ServerMessage | null {
    if (!this.positionsDirty) return null;
    this.positionsDirty = false;
    return { type: "FLYOVER_PLANES", planes: [...this.positions.values()] };
  }

  reach(playerId: PlayerId, index: number, x: number, y: number, now: number): RoomResult {
    this.touch(now);
    const flight = this.flight;
    const player = this.players.get(playerId);
    if (this.status !== "playing" || !flight) return fail("round-not-open", "No flight is in progress.");
    if (!player || !player.connected) return fail("not-in-room", "Player is not connected to this room.");
    const country = flight.route.route[index];
    const at: ProjectedPoint = [x, y];
    const elapsedSeconds = (Math.max(now, flight.takeoffAt) - player.lastAt) / 1000;
    if (
      index !== player.routeIndex ||
      !country ||
      now < flight.takeoffAt - TAKEOFF_SLACK_MS ||
      now < player.holdUntil ||
      !isPlausibleReach(country, at, player.lastPoint, elapsedSeconds)
    ) {
      return ok([], [this.progressMessage(player, "sync")]);
    }
    const next: FlyoverPlayerState = {
      ...player,
      routeIndex: player.routeIndex + 1,
      score: player.score + 1,
      correctAnswers: player.correctAnswers + 1,
      streak: player.streak + 1,
      lastPoint: at,
      lastAt: Math.max(now, flight.takeoffAt),
      lastReachAt: now,
    };
    this.players.set(playerId, next);
    return ok([this.progressMessage(next, "reached")]);
  }

  skip(playerId: PlayerId, index: number, now: number): RoomResult {
    this.touch(now);
    const flight = this.flight;
    const player = this.players.get(playerId);
    if (this.status !== "playing" || !flight) return fail("round-not-open", "No flight is in progress.");
    if (!player || !player.connected) return fail("not-in-room", "Player is not connected to this room.");
    if (index !== player.routeIndex || index >= flight.route.route.length || now < flight.takeoffAt - TAKEOFF_SLACK_MS) {
      return ok([], [this.progressMessage(player, "sync")]);
    }
    const next: FlyoverPlayerState = {
      ...player,
      routeIndex: player.routeIndex + 1,
      skipped: player.skipped + 1,
      wrongAnswers: player.wrongAnswers + 1,
      streak: 0,
      holdUntil: now + FLYOVER_SKIP_HOLD_SECONDS * 1000 - SKIP_HOLD_SLACK_MS,
    };
    this.players.set(playerId, next);
    return ok([this.progressMessage(next, "skipped")]);
  }

  endRound(now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing") return fail("round-not-open", "No flight is in progress.");
    return this.completeGame(now);
  }

  /** Flyover has no results gap between rounds: one flight, then the podium. */
  advanceAfterResult(now: number): RoomResult {
    this.touch(now);
    return fail("round-result-not-open", "Room is not showing a round result.");
  }

  voteSkip(_playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    return fail("wrong-mode", "Skip a country from the plane instead.");
  }

  sendChatMessage(playerId: PlayerId, text: string, now: number): RoomResult {
    this.touch(now);
    const player = this.players.get(playerId);
    if (!player || !player.connected) return fail("not-in-room", "Player is not connected to this room.");
    this.chatSequence += 1;
    const message: PublicChatMessage = { id: `${this.code}:${now}:${this.chatSequence}`, playerId: player.id, playerName: player.name, text: filterProfanity(text), sentAt: now };
    this.chatMessages = [...this.chatMessages, message].slice(-MAX_CHAT_HISTORY);
    return ok([this.snapshotMessage()]);
  }

  /** Most countries first; on a tie, whoever reached their last country earliest. */
  finalResults(): readonly FinalResult[] {
    const sorted = [...this.players.values()].sort((left, right) =>
      right.score - left.score ||
      (left.lastReachAt ?? Infinity) - (right.lastReachAt ?? Infinity) ||
      left.name.localeCompare(right.name));
    return sorted.map((player, index) => ({
      playerId: player.id,
      name: player.name,
      rank: index + 1,
      score: player.score,
      correctAnswers: player.score,
      wrongAnswers: player.skipped,
    }));
  }

  private get publicRound(): PublicRoundState | null {
    if (!this.flight || this.status !== "playing") return null;
    return { roundNumber: 1, prompt: { kind: "flyover-flight", value: this.flight.prompt }, startedAt: this.flight.takeoffAt, endsAt: this.flight.endsAt };
  }

  private progressMessage(player: FlyoverPlayerState, event: FlyoverProgressEvent): ServerMessage {
    return { type: "FLYOVER_PROGRESS", playerId: player.id, index: player.routeIndex, score: player.score, event };
  }

  private dropPosition(playerId: PlayerId): void {
    if (this.positions.delete(playerId)) this.positionsDirty = true;
  }

  private transferHostIfNeeded(): void {
    if (this.players.get(this.hostPlayerId)?.connected) return;
    const next = [...this.players.values()].find((player) => player.connected);
    if (next) this.hostPlayerId = next.id;
  }

  private snapshotMessage(): ServerMessage {
    return { type: "ROOM_SNAPSHOT", room: this.snapshot() };
  }

  private completeGame(now: number): RoomResult {
    this.touch(now);
    this.status = "complete";
    this.flight = null;
    this.positions = new Map();
    this.positionsDirty = false;
    return ok([{ type: "GAME_COMPLETED", results: this.finalResults() }, this.snapshotMessage()]);
  }
}
