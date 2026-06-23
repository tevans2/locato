import { createSeededRandom, shuffle } from "../../src/core/game";
import { MAP_TAP_LOCATIONS } from "../../src/core/maptap/locations";
import { scoreMapTapGuess, MAP_TAP_DEFAULT_DECAY_KM } from "../../src/core/maptap/distance";
import { filterProfanity } from "../../src/core/multiplayer/profanity";
import type { FinalResult, MapTapRoundResult, PlayerId, PublicChatMessage, PublicPlayerState, PublicRoomState, PublicRoundState, RoomCode } from "../../src/core/multiplayer/roomTypes";
import type { ServerMessage } from "../../src/core/multiplayer/protocol";
import type { RoomResult } from "./Room";

export const DEFAULT_MAPTAP_ROUND_DURATION_MS = 45_000;
export const DEFAULT_MAPTAP_RESULT_DISPLAY_MS = 8_000;
export const DEFAULT_MAPTAP_ROUND_LIMIT = 10;
const MAX_CHAT_HISTORY = 50;
export const DEFAULT_MAPTAP_MAX_PLAYERS = 8;

interface MapTapPlayerState extends PublicPlayerState {
  readonly roundsGuessed: number;
  readonly roundsMissed: number;
}

interface MapTapPrivateRound {
  readonly roundNumber: number;
  readonly locationIndex: number;
  readonly startedAt: number;
  readonly endsAt: number | null;
}

type RoomStatus = PublicRoomState["status"];

function ok(messages: readonly ServerMessage[] = [], reply: readonly ServerMessage[] = []): RoomResult {
  return reply.length > 0 ? { ok: true, messages, reply } : { ok: true, messages };
}

function fail(code: string, message: string): RoomResult {
  return { ok: false, code, message };
}

function createPlayer(id: PlayerId, name: string): MapTapPlayerState {
  return { id, name, connected: true, ready: false, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0, roundsGuessed: 0, roundsMissed: 0 };
}

function toPublicPlayer(player: MapTapPlayerState): PublicPlayerState {
  const { roundsGuessed: _g, roundsMissed: _m, ...pub } = player;
  return pub;
}

export class MapTapRoom {
  readonly code: RoomCode;
  readonly seed: string;
  readonly maxPlayers: number;
  roundLimit: number;
  roundDurationMs: number;
  readonly resultDisplayMs: number;

  private hostPlayerId: PlayerId;
  private status: RoomStatus = "lobby";
  private players = new Map<PlayerId, MapTapPlayerState>();
  private locationQueue: number[] = [];
  private currentRound: MapTapPrivateRound | null = null;
  private playerGuesses = new Map<PlayerId, { lat: number; lng: number }>();
  private skipVotes = new Set<PlayerId>();
  private completedRounds = 0;
  private resultStartedAt: number | null = null;
  private resultEndsAt: number | null = null;
  private touchedAt: number;
  private chatMessages: PublicChatMessage[] = [];
  private chatSequence = 0;

  constructor(options: {
    code: RoomCode;
    hostPlayerId: PlayerId;
    hostName: string;
    seed: string;
    now: number;
    maxPlayers?: number;
    roundLimit?: number;
    roundDurationMs?: number;
    resultDisplayMs?: number;
  }) {
    this.code = options.code;
    this.seed = options.seed;
    this.maxPlayers = options.maxPlayers ?? DEFAULT_MAPTAP_MAX_PLAYERS;
    this.roundDurationMs = options.roundDurationMs ?? DEFAULT_MAPTAP_ROUND_DURATION_MS;
    this.resultDisplayMs = options.resultDisplayMs ?? DEFAULT_MAPTAP_RESULT_DISPLAY_MS;
    this.roundLimit = Math.min(options.roundLimit ?? DEFAULT_MAPTAP_ROUND_LIMIT, MAP_TAP_LOCATIONS.length);
    this.hostPlayerId = options.hostPlayerId;
    this.locationQueue = this.buildQueue(options.seed);
    this.players.set(options.hostPlayerId, createPlayer(options.hostPlayerId, options.hostName));
    this.touchedAt = options.now;
  }

  get state(): RoomStatus { return this.status; }
  get isEmpty(): boolean { return this.players.size === 0 || [...this.players.values()].every((p) => !p.connected); }
  get updatedAt(): number { return this.touchedAt; }

  get pendingTransitionAt(): number | null {
    if (this.status === "playing") return this.currentRound?.endsAt ?? null;
    if (this.status === "round-result") return this.resultEndsAt;
    return null;
  }

  private get phaseStartedAt(): number | null {
    if (this.status === "playing") return this.currentRound?.startedAt ?? null;
    if (this.status === "round-result") return this.resultStartedAt;
    return null;
  }

  touch(now: number): void { this.touchedAt = now; }

  snapshot(): PublicRoomState {
    return {
      roomCode: this.code,
      hostPlayerId: this.hostPlayerId,
      categoryIds: ["map-tap"],
      settings: { roundLimit: this.roundLimit, roundDurationMs: this.roundDurationMs },
      status: this.status,
      players: [...this.players.values()].map(toPublicPlayer),
      round: this.publicRound,
      skipVotes: this.activeSkipVotes(),
      skipRequired: this.skipRequired(),
      phaseStartedAt: this.phaseStartedAt,
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
    this.players.set(playerId, { ...player, connected: false, ready: false, streak: 0 });
    this.transferHostIfNeeded();
    if (this.status === "playing" && this.allConnectedPlayersGuessed()) return ok(this.closeRound(now));
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
    if (![...this.players.values()].every((p) => p.id === this.hostPlayerId || !p.connected || p.ready)) {
      return fail("players-not-ready", "All connected non-host players must be ready.");
    }
    const round = this.beginNextRound(now);
    if (!round) return this.completeGame(now);
    return ok([{ type: "GAME_STARTED", round }, this.snapshotMessage()]);
  }

  restart(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "complete") return fail("game-not-complete", "A rematch can only start after the game ends.");
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the room host can start a rematch.");
    for (const [id, player] of this.players) {
      this.players.set(id, { ...player, ready: false, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0, roundsGuessed: 0, roundsMissed: 0 });
    }
    this.playerGuesses = new Map();
    this.completedRounds = 0;
    this.currentRound = null;
    this.resultStartedAt = null;
    this.resultEndsAt = null;
    this.status = "lobby";
    this.locationQueue = this.buildQueue(`${this.seed}:${now}`);
    return ok([this.snapshotMessage()]);
  }

  updateOptions(playerId: PlayerId, options: { readonly roundLimit?: number; readonly roundDurationMs?: number }, now: number): RoomResult {
    this.touch(now);
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the room host can change room settings.");
    if (this.status !== "lobby") return fail("game-started", "Room settings can only change in the lobby.");
    if (options.roundLimit !== undefined) this.roundLimit = Math.min(options.roundLimit, MAP_TAP_LOCATIONS.length);
    if (options.roundDurationMs !== undefined) this.roundDurationMs = options.roundDurationMs;
    for (const [id, player] of this.players) {
      if (id !== this.hostPlayerId) this.players.set(id, { ...player, ready: false });
    }
    return ok([this.snapshotMessage()]);
  }

  submitGuess(playerId: PlayerId, lat: number, lng: number, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing" || !this.currentRound) return fail("round-not-open", "No active round is accepting guesses.");
    const player = this.players.get(playerId);
    if (!player || !player.connected) return fail("not-in-room", "Player is not connected to this room.");
    if (this.playerGuesses.has(playerId)) return ok([], [{ type: "ERROR", code: "already-guessed", message: "You have already guessed this round." }]);
    this.playerGuesses.set(playerId, { lat, lng });
    if (this.allConnectedPlayersGuessed()) return ok(this.closeRound(now));
    return ok([this.snapshotMessage()]);
  }

  endRound(now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing" || !this.currentRound) return fail("round-not-open", "No active round can be ended.");
    return ok(this.closeRound(now));
  }

  voteSkip(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing" || !this.currentRound) return fail("round-not-open", "No active round can be skipped.");
    const player = this.players.get(playerId);
    if (!player || !player.connected) return fail("not-in-room", "Player is not connected to this room.");
    this.skipVotes.add(playerId);
    if (this.allConnectedPlayersSkipped()) return ok(this.closeRound(now));
    return ok([this.snapshotMessage()]);
  }

  sendChatMessage(playerId: PlayerId, text: string, now: number): RoomResult {
    this.touch(now);
    const player = this.players.get(playerId);
    if (!player || !player.connected) return fail("not-in-room", "Player is not connected to this room.");
    const message = this.createChatMessage(player, text, now);
    this.chatMessages = [...this.chatMessages, message].slice(-MAX_CHAT_HISTORY);
    return ok([this.snapshotMessage()]);
  }

  advanceAfterResult(now: number): RoomResult {
    this.touch(now);
    if (this.status !== "round-result") return fail("round-result-not-open", "Room is not showing a round result.");
    if (this.completedRounds >= this.roundLimit) return this.completeGame(now);
    const round = this.beginNextRound(now);
    if (!round) return this.completeGame(now);
    return ok([{ type: "ROUND_STARTED", round }, this.snapshotMessage()]);
  }

  finalResults(): readonly FinalResult[] {
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return sorted.map((player, index) => ({
      playerId: player.id,
      name: player.name,
      rank: index + 1,
      score: player.score,
      correctAnswers: player.roundsGuessed,
      wrongAnswers: player.roundsMissed,
    }));
  }

  private get publicRound(): PublicRoundState | null {
    if (!this.currentRound) return null;
    const location = MAP_TAP_LOCATIONS[this.currentRound.locationIndex];
    if (!location) return null;
    return {
      roundNumber: this.currentRound.roundNumber,
      prompt: { kind: "maptap-globe", value: JSON.stringify({ name: location.name, category: location.category, difficulty: location.difficulty }) },
      startedAt: this.currentRound.startedAt,
      endsAt: this.currentRound.endsAt,
    };
  }

  private buildQueue(seed: string): number[] {
    const indices = MAP_TAP_LOCATIONS.map((_, i) => i);
    return shuffle(indices, createSeededRandom(seed));
  }

  private connectedPlayerIds(): readonly PlayerId[] {
    return [...this.players.values()].filter((p) => p.connected).map((p) => p.id);
  }

  private allConnectedPlayersGuessed(): boolean {
    const connected = this.connectedPlayerIds();
    return connected.length > 0 && connected.every((id) => this.playerGuesses.has(id));
  }

  private allConnectedPlayersSkipped(): boolean {
    const connected = this.connectedPlayerIds();
    return connected.length > 0 && connected.every((id) => this.skipVotes.has(id));
  }

  private activeSkipVotes(): readonly PlayerId[] {
    const connected = new Set(this.connectedPlayerIds());
    return [...this.skipVotes].filter((id) => connected.has(id));
  }

  private skipRequired(): number {
    return this.status === "playing" ? this.connectedPlayerIds().length : 0;
  }

  private transferHostIfNeeded(): void {
    const host = this.players.get(this.hostPlayerId);
    if (host?.connected) return;
    const next = [...this.players.values()].find((p) => p.connected);
    if (next) this.hostPlayerId = next.id;
  }

  private snapshotMessage(): ServerMessage {
    return { type: "ROOM_SNAPSHOT", room: this.snapshot() };
  }

  private createChatMessage(player: MapTapPlayerState, text: string, now: number): PublicChatMessage {
    this.chatSequence += 1;
    return {
      id: `${this.code}:${now}:${this.chatSequence}`,
      playerId: player.id,
      playerName: player.name,
      text: filterProfanity(text),
      sentAt: now,
    };
  }

  private beginNextRound(now: number): PublicRoundState | null {
    const locationIndex = this.locationQueue.shift();
    if (locationIndex === undefined) return null;
    this.playerGuesses = new Map();
    this.skipVotes = new Set();
    this.resultStartedAt = null;
    this.resultEndsAt = null;
    this.status = "playing";
    this.currentRound = {
      roundNumber: this.completedRounds + 1,
      locationIndex,
      startedAt: now,
      endsAt: this.roundDurationMs > 0 ? now + this.roundDurationMs : null,
    };
    return this.publicRound;
  }

  private closeRound(now: number): readonly ServerMessage[] {
    const location = this.currentRound !== null ? MAP_TAP_LOCATIONS[this.currentRound.locationIndex] : null;
    const results: MapTapRoundResult[] = [];
    if (location) {
      for (const player of this.players.values()) {
        const guess = this.playerGuesses.get(player.id) ?? null;
        let score = 0;
        let distanceKm: number | null = null;
        if (guess) {
          const scored = scoreMapTapGuess(guess, location, MAP_TAP_DEFAULT_DECAY_KM);
          score = scored.score;
          distanceKm = Math.round(scored.distanceKm * 10) / 10;
        }
        const updatedPlayer = {
          ...player,
          score: player.score + score,
          roundsGuessed: player.roundsGuessed + (guess ? 1 : 0),
          roundsMissed: player.roundsMissed + (guess ? 0 : 1),
          correctAnswers: player.correctAnswers + (guess ? 1 : 0),
          wrongAnswers: player.wrongAnswers + (guess ? 0 : 1),
        };
        this.players.set(player.id, updatedPlayer);
        results.push({ playerId: player.id, name: player.name, guess, distanceKm, score });
      }
      results.sort((a, b) => b.score - a.score);
    }
    this.status = "round-result";
    this.completedRounds += 1;
    this.resultStartedAt = now;
    this.resultEndsAt = now + this.resultDisplayMs;
    this.skipVotes = new Set();
    const roundEndedMsg: ServerMessage = location
      ? { type: "MAPTAP_ROUND_ENDED", targetName: location.name, targetLat: location.lat, targetLng: location.lng, wikiSlug: location.wikiSlug, results }
      : { type: "ERROR", code: "location-not-found", message: "Round location is unavailable." };
    return [roundEndedMsg, this.snapshotMessage()];
  }

  private completeGame(now: number): RoomResult {
    this.touch(now);
    this.status = "complete";
    this.currentRound = null;
    this.resultStartedAt = null;
    this.resultEndsAt = null;
    return ok([{ type: "GAME_COMPLETED", results: this.finalResults() }, this.snapshotMessage()]);
  }
}
