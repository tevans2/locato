import { createSeededRandom } from "../../src/core/game/random";
import {
  DEFAULT_FLYOVER_MULTIPLAYER_DURATION_MS,
  FLYOVER_MULTIPLAYER_DURATIONS_MS,
  FLYOVER_TAKEOFF_COUNTDOWN_MS,
  buildFlyoverRoute,
  type PlaneInput,
  type FlyoverCountry,
  type FlyoverRoute,
} from "../../src/core/flyover";
import type { ProjectedPoint } from "../../src/core/map";
import type { FinalResult, FlyoverFlightPrompt, FlyoverPlanePosition, FlyoverProgressEvent, PlayerId, PublicPlayerState, PublicRoomSettings, PublicRoundState, RoomCode } from "../../src/core/multiplayer/roomTypes";
import type { ServerMessage } from "../../src/core/multiplayer/protocol";
import { AuthoritativeFlight, parsePlaneInput } from "../ranked/AuthoritativeFlight";
import { basePlayer, fail, ok, RoomBase, type RoomResult } from "./RoomBase";

export const DEFAULT_FLYOVER_MAX_PLAYERS = 8;

/**
 * Flyover race: one flight per game. Everyone takes off together from the same place and flies
 * the same seeded route; each country reached scores a point and the most countries when the
 * clock runs out wins (ties go to whoever got there first).
 *
 * The server simulates controls and awards touches with fixed physics. Client positions and
 * reach claims are ignored; future targets remain private until the current one ends.
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

export function isFlyoverDuration(value: number): boolean {
  return (FLYOVER_MULTIPLAYER_DURATIONS_MS as readonly number[]).includes(value);
}

export class FlyoverRoom extends RoomBase<FlyoverPlayerState> {
  readonly kind = "flyover" as const;
  flightMs: number;

  private readonly countries: readonly FlyoverCountry[];
  private flight: FlyoverFlight | null = null;
  private gamesPlayed = 0;
  private engines = new Map<PlayerId, AuthoritativeFlight>();
  private positions = new Map<PlayerId, FlyoverPlanePosition>();
  private positionsDirty = false;

  constructor(options: {
    code: RoomCode;
    hostPlayerId: PlayerId;
    hostName: string;
    hostAvatarEmoji?: string;
    countries: readonly FlyoverCountry[];
    seed: string;
    now: number;
    maxPlayers?: number;
    flightMs?: number;
  }) {
    super({ ...options, maxPlayers: options.maxPlayers ?? DEFAULT_FLYOVER_MAX_PLAYERS });
    this.countries = options.countries;
    this.flightMs = options.flightMs !== undefined && isFlyoverDuration(options.flightMs) ? options.flightMs : DEFAULT_FLYOVER_MULTIPLAYER_DURATION_MS;
  }

  protected newPlayer(id: PlayerId, name: string, avatarEmoji?: string): FlyoverPlayerState {
    return { ...basePlayer(id, name, avatarEmoji), routeIndex: 0, skipped: 0, lastPoint: [0, 0], lastAt: 0, lastReachAt: null, holdUntil: 0 };
  }

  protected snapshotCategoryIds(): readonly string[] {
    return ["flyover"];
  }

  protected snapshotSettings(): PublicRoomSettings {
    return { roundLimit: 1, roundDurationMs: this.flightMs };
  }

  protected skipState(): { readonly skipVotes: readonly PlayerId[]; readonly skipRequired: number } {
    return { skipVotes: [], skipRequired: 0 };
  }

  reconnectPlayer(playerId: PlayerId, now: number): RoomResult {
    const result = super.reconnectPlayer(playerId, now);
    const player = this.players.get(playerId);
    // Hand the plane back its current target: progress broadcasts keep it private.
    return result.ok && player && !player.spectator ? ok([...result.messages, this.progressMessage(player, "sync")]) : result;
  }

  get pendingTransitionAt(): number | null {
    return this.status === "playing" ? (this.flight?.endsAt ?? null) : null;
  }

  protected get phaseStartedAt(): number | null {
    return this.status === "playing" ? (this.flight?.takeoffAt ?? null) : null;
  }

  get publicRound(): PublicRoundState | null {
    if (!this.flight || this.status !== "playing") return null;
    return { roundNumber: 1, prompt: { kind: "flyover-flight", value: this.flight.prompt }, startedAt: this.flight.takeoffAt, endsAt: this.flight.endsAt };
  }

  protected beginGame(now: number): RoomResult {
    this.gamesPlayed += 1;
    const route = buildFlyoverRoute(this.countries, createSeededRandom(`${this.seed}:${this.gamesPlayed}`));
    const takeoffAt = now + FLYOVER_TAKEOFF_COUNTDOWN_MS;
    const prompt: FlyoverFlightPrompt = {
      start: { x: route.start.x, y: route.start.y, heading: route.start.heading },
      target: route.route[0]?.code ?? null,
    };
    this.flight = { route, takeoffAt, endsAt: takeoffAt + this.flightMs, prompt: JSON.stringify(prompt) };
    for (const [id, player] of this.players) {
      this.players.set(id, { ...player, lastPoint: [route.start.x, route.start.y], lastAt: takeoffAt });
      if (!player.spectator) this.engines.set(id, new AuthoritativeFlight(this.countries, createSeededRandom(this.seed), takeoffAt, takeoffAt + this.flightMs, route.start, route.route));
    }
    this.positions = new Map();
    this.positionsDirty = false;
    this.status = "playing";
    return ok([{ type: "GAME_STARTED", round: this.publicRound! }, this.snapshotMessage()]);
  }

  protected resetGame(): void {
    this.flight = null;
    this.engines.clear();
    this.positions = new Map();
    this.positionsDirty = false;
  }

  protected onPlayerGone(playerId: PlayerId): void {
    if (this.positions.delete(playerId)) this.positionsDirty = true;
  }

  updateOptions(playerId: PlayerId, options: { readonly roundDurationMs?: number }, now: number): RoomResult {
    this.touch(now);
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the host can change room settings.");
    if (this.status !== "lobby") return fail("game-started", "Room settings can only change in the lobby.");
    if (options.roundDurationMs !== undefined) {
      if (!isFlyoverDuration(options.roundDurationMs)) return fail("invalid-room-settings", "That flight length isn't offered.");
      this.flightMs = options.roundDurationMs;
    }
    return ok([this.snapshotMessage()]);
  }

  /** Latest plane position, relayed to the room on the next tick. Quietly ignored off-flight. */
  updatePosition(playerId: PlayerId, x: number, y: number, heading: number, now: number): RoomResult {
    // Old clients and console scripts cannot set authoritative positions.
    return ok();
  }

  steer(playerId: PlayerId, input: PlaneInput, now: number): RoomResult {
    const engine = this.engines.get(playerId);
    if (this.status !== "playing" || !this.flight || now < this.flight.takeoffAt || now >= this.flight.endsAt || !this.players.get(playerId)?.connected) return ok();
    if (!engine || !parsePlaneInput(input)) return fail("invalid-controls", "Invalid flight controls.");
    engine.steer(input, now);
    return ok(this.tick(now));
  }

  tick(now: number): readonly ServerMessage[] {
    if (this.status !== "playing" || !this.flight || now < this.flight.takeoffAt) return [];
    const messages: ServerMessage[] = [];
    for (const [id, engine] of this.engines) {
      const player = this.players.get(id);
      if (!player?.connected) continue;
      engine.advance(now);
      const changed = player.routeIndex !== engine.index;
      const next = { ...player, routeIndex: engine.index, score: engine.score, correctAnswers: engine.score, lastReachAt: engine.lastReachAt };
      this.players.set(id, next);
      this.positions.set(id, { playerId: id, ...engine.plane });
      this.positionsDirty = true;
      if (changed) messages.push(this.progressMessage(next, "reached"));
    }
    return messages;
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
    if (this.status !== "playing" || !flight) return fail("round-not-open", "No flight is in progress.");
    const player = this.activePlayer(playerId);
    if ("ok" in player) return player;
    // A claimed reach is never evidence of movement. Only tick() can award points.
    return ok([], [this.progressMessage(player, "sync")]);
  }

  skip(playerId: PlayerId, index: number, now: number): RoomResult {
    this.touch(now);
    const flight = this.flight;
    const progress = this.tick(now);
    if (this.status !== "playing" || !flight) return fail("round-not-open", "No flight is in progress.");
    const player = this.activePlayer(playerId);
    if ("ok" in player) return player;
    const engine = this.engines.get(playerId);
    if (!engine || index !== engine.index || index >= flight.route.route.length || now < flight.takeoffAt || now >= flight.endsAt || now < engine.holdUntil) {
      return ok(progress, [this.progressMessage(player, "sync")]);
    }
    engine.skip(now, true);
    const next: FlyoverPlayerState = {
      ...player,
      routeIndex: engine.index,
      score: engine.score,
      correctAnswers: engine.score,
      lastReachAt: engine.lastReachAt,
      skipped: player.skipped + 1,
      wrongAnswers: player.wrongAnswers + 1,
      streak: 0,
      holdUntil: engine.holdUntil,
    };
    this.players.set(playerId, next);
    return ok([...progress, this.progressMessage(next, "skipped")]);
  }

  endRound(now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing") return fail("round-not-open", "No flight is in progress.");
    const progress = this.tick(now);
    const result = this.completeGame(now);
    return result.ok ? ok([...progress, ...result.messages]) : result;
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

  /** Most countries first; on a tie, whoever reached their last country earliest. */
  finalResults(): readonly FinalResult[] {
    const sorted = [...this.participants()].sort((left, right) =>
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

  private progressMessage(player: FlyoverPlayerState, event: FlyoverProgressEvent): ServerMessage {
    return { type: "FLYOVER_PROGRESS", playerId: player.id, index: player.routeIndex, score: player.score, event, target: this.engines.get(player.id)?.target?.code ?? null };
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
