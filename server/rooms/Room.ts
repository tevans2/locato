import type { CountryId, CountryIndex } from "../../src/core/countries";
import { createSeededRandom, shuffle } from "../../src/core/game";
import { buildPromptSlots, getCategory, type PromptSlot } from "../../src/core/categories";
import type { FinalResult, PlayerId, PublicPlayerState, PublicRoomState, PublicRoundState, RoomCode, RoundResult, ServerMessage } from "../../src/core/multiplayer";

export const DEFAULT_MAX_PLAYERS_PER_ROOM = 8;
export const DEFAULT_MULTIPLAYER_ROUND_LIMIT = 10;
export const DEFAULT_ROUND_DURATION_MS = 30_000;
export const DEFAULT_RESULT_DISPLAY_MS = 2_000;

export type RoomStatus = PublicRoomState["status"];

export interface RoomOptions {
  readonly code: RoomCode;
  readonly hostPlayerId: PlayerId;
  readonly hostName: string;
  readonly countryIndex: CountryIndex;
  readonly categoryIds: readonly string[];
  readonly seed: string;
  readonly now: number;
  readonly maxPlayers?: number;
  readonly roundLimit?: number;
  readonly roundDurationMs?: number;
  readonly resultDisplayMs?: number;
}

interface PrivatePlayerState extends PublicPlayerState {}

interface PrivateRoundState {
  readonly roundNumber: number;
  readonly countryId: CountryId;
  readonly categoryId: string;
  readonly startedAt: number;
  readonly endsAt: number | null;
}

export type RoomResult =
  | { readonly ok: true; readonly messages: readonly ServerMessage[]; readonly reply?: readonly ServerMessage[] }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly messages?: readonly ServerMessage[] };

function ok(messages: readonly ServerMessage[] = [], reply: readonly ServerMessage[] = []): RoomResult {
  return reply.length > 0 ? { ok: true, messages, reply } : { ok: true, messages };
}

function fail(code: string, message: string, messages: readonly ServerMessage[] = []): RoomResult {
  return { ok: false, code, message, ...(messages.length > 0 ? { messages } : {}) };
}

function toPublicPlayer(player: PrivatePlayerState): PublicPlayerState {
  return { ...player };
}

function toPublicRound(round: PrivateRoundState | null, index: CountryIndex): PublicRoundState | null {
  if (!round) return null;
  const country = index.byId[round.countryId];
  const category = getCategory(round.categoryId);
  if (!country || !category) return null;
  return { roundNumber: round.roundNumber, prompt: category.prompt(country), startedAt: round.startedAt, endsAt: round.endsAt };
}

function createPlayer(id: PlayerId, name: string): PrivatePlayerState {
  return { id, name, connected: true, ready: false, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 };
}

export class Room {
  readonly code: RoomCode;
  readonly categoryIds: readonly string[];
  readonly seed: string;
  readonly maxPlayers: number;
  readonly roundLimit: number;
  readonly roundDurationMs: number;
  readonly resultDisplayMs: number;
  readonly countryIndex: CountryIndex;

  private hostPlayerId: PlayerId;
  private status: RoomStatus = "lobby";
  private players = new Map<PlayerId, PrivatePlayerState>();
  private remainingSlots: PromptSlot[];
  private currentRound: PrivateRoundState | null = null;
  private roundAnswers = new Map<PlayerId, RoundResult>();
  private completedRounds = 0;
  private resultStartedAt: number | null = null;
  private resultEndsAt: number | null = null;
  private touchedAt: number;

  constructor(options: RoomOptions) {
    this.code = options.code;
    this.categoryIds = options.categoryIds;
    this.seed = options.seed;
    this.maxPlayers = options.maxPlayers ?? DEFAULT_MAX_PLAYERS_PER_ROOM;
    this.countryIndex = options.countryIndex;
    this.hostPlayerId = options.hostPlayerId;
    const slots = shuffle(buildPromptSlots(options.countryIndex, options.categoryIds, options.seed), createSeededRandom(options.seed));
    this.roundLimit = Math.min(options.roundLimit ?? DEFAULT_MULTIPLAYER_ROUND_LIMIT, slots.length);
    this.roundDurationMs = options.roundDurationMs ?? DEFAULT_ROUND_DURATION_MS;
    this.resultDisplayMs = options.resultDisplayMs ?? DEFAULT_RESULT_DISPLAY_MS;
    this.remainingSlots = slots;
    this.players.set(options.hostPlayerId, createPlayer(options.hostPlayerId, options.hostName));
    this.touchedAt = options.now;
  }

  get updatedAt(): number {
    return this.touchedAt;
  }

  get isEmpty(): boolean {
    return this.players.size === 0 || [...this.players.values()].every((player) => !player.connected);
  }

  get publicRound(): PublicRoundState | null {
    return toPublicRound(this.currentRound, this.countryIndex);
  }

  get state(): RoomStatus {
    return this.status;
  }

  // Epoch ms when the current auto-advancing phase ends: the round deadline while
  // "playing", the result-display deadline while "round-result", null otherwise.
  // Doubles as the public phaseEndsAt and the RoomManager's transition trigger.
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

  snapshot(): PublicRoomState {
    return {
      roomCode: this.code,
      hostPlayerId: this.hostPlayerId,
      categoryIds: this.categoryIds,
      settings: { roundLimit: this.roundLimit, roundDurationMs: this.roundDurationMs },
      status: this.status,
      players: [...this.players.values()].map(toPublicPlayer),
      round: this.publicRound,
      phaseStartedAt: this.phaseStartedAt,
      phaseEndsAt: this.pendingTransitionAt,
    };
  }

  touch(now: number): void {
    this.touchedAt = now;
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

    const round = this.beginNextRound(now);
    if (!round) return this.completeGame(now);
    return ok([{ type: "GAME_STARTED", round }, this.snapshotMessage()]);
  }

  // Host-driven rematch: returns a finished room to the lobby with the same roster but reset
  // scores/ready, a fresh round queue, and cleared round state. Reuses the existing lobby →
  // ready → start flow rather than auto-starting, so players opt back in.
  restart(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "complete") return fail("game-not-complete", "A rematch can only start after the game ends.");
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the room host can start a rematch.");

    for (const [id, player] of this.players) {
      this.players.set(id, { ...player, ready: false, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 });
    }
    this.roundAnswers = new Map();
    this.completedRounds = 0;
    this.currentRound = null;
    this.resultStartedAt = null;
    this.resultEndsAt = null;
    this.status = "lobby";
    this.remainingSlots = shuffle(buildPromptSlots(this.countryIndex, this.categoryIds, `${this.seed}:${now}`), createSeededRandom(`${this.seed}:${now}`));
    return ok([this.snapshotMessage()]);
  }

  submitAnswer(playerId: PlayerId, answer: string, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing" || !this.currentRound) return fail("round-not-open", "No active round is accepting answers.");
    const player = this.players.get(playerId);
    if (!player || !player.connected) return fail("not-in-room", "Player is not connected to this room.");

    const country = this.countryIndex.byId[this.currentRound.countryId];
    const category = getCategory(this.currentRound.categoryId);
    if (!country || !category) return fail("country-not-found", "Current prompt is unavailable.");

    if (!category.accepts(country, answer, false)) {
      const updatedPlayer = { ...player, wrongAnswers: player.wrongAnswers + 1, streak: 0 };
      this.players.set(playerId, updatedPlayer);
      if (!this.roundAnswers.has(playerId)) this.roundAnswers.set(playerId, { playerId, name: player.name, correct: false, points: 0, answeredAt: now, guess: answer });
      // Rejection is private to the guesser: broadcasting it would flash "Not quite" on every
      // screen. No state other than this player's private streak/wrong tally changes, so there
      // is nothing to broadcast either.
      return ok([], [{ type: "ANSWER_REJECTED", reason: "Not quite. Try again before the round ends." }]);
    }

    const points = this.calculatePoints(player, now);
    const updatedPlayer = { ...player, score: player.score + points, streak: player.streak + 1, correctAnswers: player.correctAnswers + 1 };
    this.players.set(playerId, updatedPlayer);
    this.roundAnswers.set(playerId, { playerId, name: player.name, correct: true, points, answeredAt: now, guess: answer });
    // First correct answer takes the round and the points; the round closes immediately.
    return ok([{ type: "ANSWER_ACCEPTED", playerId, points }, ...this.closeRound(now)]);
  }

  endRound(now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing" || !this.currentRound) return fail("round-not-open", "No active round can be ended.");
    return ok(this.closeRound(now));
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
    const sorted = [...this.players.values()].sort((left, right) => right.score - left.score || right.correctAnswers - left.correctAnswers || left.name.localeCompare(right.name));
    return sorted.map((player, index) => ({ playerId: player.id, name: player.name, rank: index + 1, score: player.score, correctAnswers: player.correctAnswers, wrongAnswers: player.wrongAnswers }));
  }

  private transferHostIfNeeded(): void {
    const host = this.players.get(this.hostPlayerId);
    if (host?.connected) return;
    const nextHost = [...this.players.values()].find((player) => player.connected);
    if (nextHost) this.hostPlayerId = nextHost.id;
  }

  private snapshotMessage(): ServerMessage {
    return { type: "ROOM_SNAPSHOT", room: this.snapshot() };
  }

  private beginNextRound(now: number): PublicRoundState | null {
    const slot = this.remainingSlots.shift();
    if (!slot) {
      this.currentRound = null;
      return null;
    }

    this.roundAnswers = new Map();
    this.resultStartedAt = null;
    this.resultEndsAt = null;
    this.status = "playing";
    this.currentRound = {
      roundNumber: this.completedRounds + 1,
      countryId: slot.countryId,
      categoryId: slot.categoryId,
      startedAt: now,
      endsAt: this.roundDurationMs > 0 ? now + this.roundDurationMs : null,
    };
    return this.publicRound;
  }

  private calculatePoints(player: PrivatePlayerState, now: number): number {
    const timeBonus = this.currentRound?.endsAt ? Math.max(0, Math.ceil((this.currentRound.endsAt - now) / 1000)) : 0;
    return 100 + Math.min(player.streak, 10) * 10 + timeBonus;
  }

  // Closes the live round into the result-reveal phase. Reads the reveal/results while the
  // round state is still intact, then arms the result-display deadline the RoomManager uses
  // to schedule the next round.
  private closeRound(now: number): readonly ServerMessage[] {
    const reveal = this.roundEndedMessage();
    this.status = "round-result";
    this.completedRounds += 1;
    this.resultStartedAt = now;
    this.resultEndsAt = this.resultDisplayMs > 0 ? now + this.resultDisplayMs : now;
    return [reveal, this.snapshotMessage()];
  }

  private roundResults(): readonly RoundResult[] {
    return [...this.players.values()].map((player) => this.roundAnswers.get(player.id) ?? { playerId: player.id, name: player.name, correct: false, points: 0, answeredAt: null, guess: null });
  }

  private roundEndedMessage(): ServerMessage {
    const round = this.currentRound;
    const country = round ? this.countryIndex.byId[round.countryId] : null;
    const category = round ? getCategory(round.categoryId) : null;
    if (!country || !category) return { type: "ERROR", code: "country-not-found", message: "Round prompt is unavailable." };
    return { type: "ROUND_ENDED", answer: category.reveal(country), results: this.roundResults() };
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
