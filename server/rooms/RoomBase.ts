import { filterProfanity } from "../../src/core/multiplayer/profanity";
import type { ServerMessage } from "../../src/core/multiplayer/protocol";
import { QUICK_MATCH_COUNTDOWN_MS, QUICK_MATCH_FULL_COUNTDOWN_MS, QUICK_MATCH_MIN_PLAYERS, type QuickMatchGame } from "../../src/core/multiplayer/quickMatch";
import type { PlayerId, PublicChatMessage, PublicPlayerState, PublicRoomSettings, PublicRoomState, PublicRoundState, RoomCode, RoomKind } from "../../src/core/multiplayer/roomTypes";

export type RoomStatus = PublicRoomState["status"];

export type RoomResult =
  | { readonly ok: true; readonly messages: readonly ServerMessage[]; readonly reply?: readonly ServerMessage[] }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly messages?: readonly ServerMessage[] };

export function ok(messages: readonly ServerMessage[] = [], reply: readonly ServerMessage[] = []): RoomResult {
  return reply.length > 0 ? { ok: true, messages, reply } : { ok: true, messages };
}

export function fail(code: string, message: string, messages: readonly ServerMessage[] = []): RoomResult {
  return { ok: false, code, message, ...(messages.length > 0 ? { messages } : {}) };
}

const MAX_CHAT_HISTORY = 50;

export interface RoomBaseOptions {
  readonly code: RoomCode;
  readonly hostPlayerId: PlayerId;
  readonly hostName: string;
  readonly hostAvatarEmoji?: string;
  readonly seed: string;
  readonly now: number;
  readonly maxPlayers: number;
}

/** The fresh, zero-score player every room kind starts from; kinds add their own private stats. */
export function basePlayer(id: PlayerId, name: string, avatarEmoji?: string): PublicPlayerState {
  return { id, name, ...(avatarEmoji ? { avatarEmoji } : {}), connected: true, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 };
}

/**
 * Everything every room kind shares: the roster (joining, spectating, leaving, reconnecting,
 * host hand-off), chat, and the lobby → game → results → lobby lifecycle. Kinds supply how a game
 * starts, how it resets, and what their snapshot carries; their rounds stay their own.
 *
 * There is no ready check: the host starts whenever. Anyone joining mid-game spectates and is
 * seated for the next game.
 */
export abstract class RoomBase<P extends PublicPlayerState> {
  abstract readonly kind: RoomKind;
  readonly code: RoomCode;
  readonly seed: string;
  readonly maxPlayers: number;

  protected hostPlayerId: PlayerId;
  protected status: RoomStatus = "lobby";
  protected readonly players = new Map<PlayerId, P>();
  protected skipVotes = new Set<PlayerId>();
  private chatMessages: readonly PublicChatMessage[] = [];
  private chatSequence = 0;
  private touchedAt: number;
  /** Quick matches: the game, when the room starts by itself, and the signed-in players' ratings. */
  private quickMatchGame: QuickMatchGame | null = null;
  private quickMatchAt: number | null = null;
  private readonly ratings = new Map<PlayerId, number>();

  constructor(options: RoomBaseOptions) {
    this.code = options.code;
    this.seed = options.seed;
    this.maxPlayers = options.maxPlayers;
    this.hostPlayerId = options.hostPlayerId;
    this.touchedAt = options.now;
    this.players.set(options.hostPlayerId, this.newPlayer(options.hostPlayerId, options.hostName, options.hostAvatarEmoji));
  }

  /** A fresh player with zero stats. Must not read instance fields (it runs during construction). */
  protected abstract newPlayer(id: PlayerId, name: string, avatarEmoji?: string): P;
  /** Only the public fields go on the wire; per-kind private stats stay on the server. */
  protected publicPlayer(player: P): PublicPlayerState {
    const { id, name, avatarEmoji, connected, spectator, score, streak, correctAnswers, wrongAnswers, routeIndex } = player;
    const rating = this.ratings.get(id);
    return {
      id,
      name,
      ...(avatarEmoji ? { avatarEmoji } : {}),
      ...(rating !== undefined ? { rating } : {}),
      connected,
      ...(spectator ? { spectator } : {}),
      score,
      streak,
      correctAnswers,
      wrongAnswers,
      ...(routeIndex !== undefined ? { routeIndex } : {}),
    };
  }
  protected abstract snapshotCategoryIds(): readonly string[];
  protected abstract snapshotSettings(): PublicRoomSettings;
  protected abstract get publicRound(): PublicRoundState | null;
  /** When the current timed phase ends (round deadline, results gap); the manager's tick trigger. */
  abstract get pendingTransitionAt(): number | null;
  protected abstract get phaseStartedAt(): number | null;
  /** Start a game from the lobby (status and host already checked). */
  protected abstract beginGame(now: number): RoomResult;
  /** Clear game state for a fresh game: queues, rounds, flight. Scores are reset by the base. */
  protected abstract resetGame(now: number): void;
  /** A player went away (left or dropped) mid-game; close the round if nobody is left to wait for. */
  protected afterDeparture(_playerId: PlayerId, _now: number): readonly ServerMessage[] | null {
    return null;
  }
  /** Skip votes on the wire; Flyover has none (racers skip on their own). */
  protected skipState(): { readonly skipVotes: readonly PlayerId[]; readonly skipRequired: number } {
    const active = new Set(this.activePlayerIds());
    return {
      skipVotes: [...this.skipVotes].filter((id) => active.has(id)),
      skipRequired: this.status === "playing" ? active.size : 0,
    };
  }

  get state(): RoomStatus {
    return this.status;
  }

  get updatedAt(): number {
    return this.touchedAt;
  }

  get isEmpty(): boolean {
    return [...this.players.values()].every((player) => !player.connected);
  }

  get host(): PlayerId {
    return this.hostPlayerId;
  }

  touch(now: number): void {
    this.touchedAt = now;
  }

  snapshot(): PublicRoomState {
    return {
      roomCode: this.code,
      kind: this.kind,
      hostPlayerId: this.hostPlayerId,
      categoryIds: this.snapshotCategoryIds(),
      settings: this.snapshotSettings(),
      status: this.status,
      players: [...this.players.values()].map((player) => this.publicPlayer(player)),
      round: this.publicRound,
      ...this.skipState(),
      phaseStartedAt: this.phaseStartedAt,
      phaseEndsAt: this.pendingTransitionAt,
      chatMessages: this.chatMessages,
      ...(this.quickMatchGame ? { quickMatch: { game: this.quickMatchGame, startsAt: this.quickMatchAt } } : {}),
    };
  }

  // ---------- quick matches ----------

  /** Make this a public quick-match room for `game`: standard settings, starting by itself. */
  markQuickMatch(game: QuickMatchGame, now: number): void {
    this.quickMatchGame = game;
    this.refreshQuickMatch(now);
  }

  get quickMatch(): QuickMatchGame | null {
    return this.quickMatchGame;
  }

  /** When a quick match in the lobby starts by itself (null while it waits for players). */
  get quickMatchStartsAt(): number | null {
    return this.quickMatchAt;
  }

  setRating(playerId: PlayerId, rating: number): void {
    this.ratings.set(playerId, rating);
  }

  /**
   * The countdown follows who's in: it starts once two players are, shortens when the room fills,
   * and stops if it drops below two again.
   */
  private refreshQuickMatch(now: number): void {
    if (!this.quickMatchGame || this.status !== "lobby") {
      this.quickMatchAt = null;
      return;
    }
    const active = this.activePlayerIds().length;
    if (active < QUICK_MATCH_MIN_PLAYERS) this.quickMatchAt = null;
    else if (this.players.size >= this.maxPlayers) this.quickMatchAt = Math.min(this.quickMatchAt ?? Infinity, now + QUICK_MATCH_FULL_COUNTDOWN_MS);
    else this.quickMatchAt ??= now + QUICK_MATCH_COUNTDOWN_MS;
  }

  /** Joins as a player in the lobby, or as a spectator while a game is running. */
  addPlayer(playerId: PlayerId, name: string, now: number, avatarEmoji?: string, rating?: number): RoomResult {
    this.touch(now);
    if (this.players.size >= this.maxPlayers) return fail("room-full", "This room is full.");
    if (this.players.has(playerId)) return fail("duplicate-player", "Player is already in this room.");
    const fresh = this.newPlayer(playerId, name, avatarEmoji);
    const player: P = this.status === "lobby" ? fresh : { ...fresh, spectator: true };
    this.players.set(playerId, player);
    if (rating !== undefined) this.ratings.set(playerId, rating);
    this.refreshQuickMatch(now);
    return ok([{ type: "PLAYER_JOINED", player: this.publicPlayer(player) }, this.snapshotMessage()]);
  }

  removePlayer(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    const player = this.players.get(playerId);
    if (!player) return fail("not-in-room", "Player is not in this room.");
    this.players.delete(playerId);
    this.onPlayerGone(playerId);
    this.transferHostIfNeeded();
    this.refreshQuickMatch(now);
    const closed = this.afterDeparture(playerId, now);
    return ok([{ type: "PLAYER_LEFT", playerId, name: player.name }, ...(closed ?? [this.snapshotMessage()])]);
  }

  reconnectPlayer(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    const player = this.players.get(playerId);
    if (!player) return fail("session-expired", "Your seat in this room is no longer available.");
    this.players.set(playerId, { ...player, connected: true });
    // Someone reclaiming a seat in an empty room takes the host role back.
    this.transferHostIfNeeded();
    this.refreshQuickMatch(now);
    return ok([this.snapshotMessage()]);
  }

  disconnectPlayer(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    const player = this.players.get(playerId);
    if (!player) return fail("not-in-room", "Player is not in this room.");
    this.players.set(playerId, { ...player, connected: false, streak: 0 });
    this.onPlayerGone(playerId);
    this.transferHostIfNeeded();
    this.refreshQuickMatch(now);
    return ok(this.afterDeparture(playerId, now) ?? [this.snapshotMessage()]);
  }

  startGame(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "lobby") return fail("game-started", "The game has already started.");
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the host can start the game.");
    if (this.quickMatchGame && this.activePlayerIds().length < QUICK_MATCH_MIN_PLAYERS) return fail("not-enough-players", "A quick match needs at least two players.");
    this.quickMatchAt = null;
    return this.beginGame(now);
  }

  /** Host, after a game: same players, same settings, straight into the next game. */
  playAgain(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "complete") return fail("game-not-complete", "A rematch can only start after the game ends.");
    if (this.quickMatchGame) return fail("quick-match", "Quick matches don't rematch. Find another match instead.");
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the host can start the next game.");
    this.resetToLobby(now);
    return this.beginGame(now);
  }

  /** Host, after a game: back to the lobby to change settings first. */
  returnToLobby(playerId: PlayerId, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "complete") return fail("game-not-complete", "The game hasn't finished yet.");
    if (this.quickMatchGame) return fail("quick-match", "Quick matches use standard settings. Find another match instead.");
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the host can change the settings.");
    this.resetToLobby(now);
    return ok([this.snapshotMessage()]);
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

  /**
   * Take over another room's people (the host switched game type in the lobby): same ids, so
   * sessions and reconnect tokens stay valid, with fresh stats for this kind.
   */
  adoptRoster(from: RoomBase<PublicPlayerState>): void {
    this.players.clear();
    for (const seat of from.players.values()) {
      this.players.set(seat.id, { ...this.newPlayer(seat.id, seat.name, seat.avatarEmoji), connected: seat.connected });
    }
    this.hostPlayerId = from.hostPlayerId;
    this.chatMessages = from.chatMessages;
    this.chatSequence = from.chatSequence;
  }

  // ---------- helpers for kinds ----------

  protected snapshotMessage(): ServerMessage {
    return { type: "ROOM_SNAPSHOT", room: this.snapshot() };
  }

  /** Connected players who are in this game (not spectating). */
  protected activePlayerIds(): readonly PlayerId[] {
    return [...this.players.values()].filter((player) => player.connected && !player.spectator).map((player) => player.id);
  }

  /** Everyone in this game, connected or not (spectators are left out of results). */
  protected participants(): readonly P[] {
    return [...this.players.values()].filter((player) => !player.spectator);
  }

  protected allActiveIn(ids: ReadonlySet<PlayerId> | ReadonlyMap<PlayerId, unknown>): boolean {
    const active = this.activePlayerIds();
    return active.length > 0 && active.every((id) => ids.has(id));
  }

  /** The player for an in-game action, or why they can't act. */
  protected activePlayer(playerId: PlayerId): P | RoomResult {
    const player = this.players.get(playerId);
    if (!player || !player.connected) return fail("not-in-room", "Player is not connected to this room.");
    if (player.spectator) return fail("spectating", "You're watching this game. You'll play in the next one.");
    return player;
  }

  /** Hook for kinds holding per-player live state (Flyover's plane positions). */
  protected onPlayerGone(_playerId: PlayerId): void {}

  private resetToLobby(now: number): void {
    // Fresh stats for everyone; spectators take a seat for the next game.
    for (const [id, player] of this.players) {
      this.players.set(id, { ...this.newPlayer(id, player.name, player.avatarEmoji), connected: player.connected });
    }
    this.skipVotes = new Set();
    this.status = "lobby";
    this.resetGame(now);
  }

  private transferHostIfNeeded(): void {
    if (this.players.get(this.hostPlayerId)?.connected) return;
    const next = [...this.players.values()].find((player) => player.connected && !player.spectator) ?? [...this.players.values()].find((player) => player.connected);
    if (next) this.hostPlayerId = next.id;
  }
}
