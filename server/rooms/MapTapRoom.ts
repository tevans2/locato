import { createSeededRandom, shuffle } from "../../src/core/game";
import { MAP_TAP_LOCATIONS, resolveMapTapCategories } from "../../src/core/maptap/locations";
import type { MapTapCategory } from "../../src/core/maptap/types";
import { scoreMapTapGuess, MAP_TAP_DEFAULT_DECAY_KM } from "../../src/core/maptap/distance";
import type { FinalResult, MapTapRoundResult, PlayerId, PublicPlayerState, PublicRoomSettings, PublicRoundState, RoomCode } from "../../src/core/multiplayer/roomTypes";
import type { ServerMessage } from "../../src/core/multiplayer/protocol";
import { basePlayer, fail, ok, RoomBase, type RoomResult } from "./RoomBase";

export const DEFAULT_MAPTAP_ROUND_DURATION_MS = 45_000;
export const DEFAULT_MAPTAP_RESULT_DISPLAY_MS = 8_000;
export const DEFAULT_MAPTAP_ROUND_LIMIT = 10;
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

/** Everyone gets the same named place and taps the globe; closest guesses score most. */
export class MapTapRoom extends RoomBase<MapTapPlayerState> {
  readonly kind = "map-tap" as const;
  roundLimit: number;
  roundDurationMs: number;
  readonly resultDisplayMs: number;
  private mapTapCategories: readonly MapTapCategory[];

  private locationQueue: number[] = [];
  private currentRound: MapTapPrivateRound | null = null;
  private playerGuesses = new Map<PlayerId, { lat: number; lng: number }>();
  private completedRounds = 0;
  private resultStartedAt: number | null = null;
  private resultEndsAt: number | null = null;

  constructor(options: {
    code: RoomCode;
    hostPlayerId: PlayerId;
    hostName: string;
    hostAvatarEmoji?: string;
    seed: string;
    now: number;
    maxPlayers?: number;
    roundLimit?: number;
    roundDurationMs?: number;
    resultDisplayMs?: number;
    mapTapCategories?: readonly MapTapCategory[];
  }) {
    super({ ...options, maxPlayers: options.maxPlayers ?? DEFAULT_MAPTAP_MAX_PLAYERS });
    this.roundDurationMs = options.roundDurationMs ?? DEFAULT_MAPTAP_ROUND_DURATION_MS;
    this.resultDisplayMs = options.resultDisplayMs ?? DEFAULT_MAPTAP_RESULT_DISPLAY_MS;
    this.mapTapCategories = resolveMapTapCategories(options.mapTapCategories);
    this.roundLimit = Math.min(options.roundLimit ?? DEFAULT_MAPTAP_ROUND_LIMIT, this.eligibleLocationCount());
    this.locationQueue = this.buildQueue(options.seed);
  }

  protected newPlayer(id: PlayerId, name: string, avatarEmoji?: string): MapTapPlayerState {
    return { ...basePlayer(id, name, avatarEmoji), roundsGuessed: 0, roundsMissed: 0 };
  }

  protected snapshotCategoryIds(): readonly string[] {
    return ["map-tap"];
  }

  protected snapshotSettings(): PublicRoomSettings {
    return { roundLimit: this.roundLimit, roundDurationMs: this.roundDurationMs, mapTapCategories: this.mapTapCategories };
  }

  get pendingTransitionAt(): number | null {
    if (this.status === "playing") return this.currentRound?.endsAt ?? null;
    if (this.status === "round-result") return this.resultEndsAt;
    return null;
  }

  protected get phaseStartedAt(): number | null {
    if (this.status === "playing") return this.currentRound?.startedAt ?? null;
    if (this.status === "round-result") return this.resultStartedAt;
    return null;
  }

  get publicRound(): PublicRoundState | null {
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

  protected beginGame(now: number): RoomResult {
    const round = this.beginNextRound(now);
    if (!round) return this.completeGame(now);
    return ok([{ type: "GAME_STARTED", round }, this.snapshotMessage()]);
  }

  protected resetGame(now: number): void {
    this.playerGuesses = new Map();
    this.completedRounds = 0;
    this.currentRound = null;
    this.resultStartedAt = null;
    this.resultEndsAt = null;
    this.locationQueue = this.buildQueue(`${this.seed}:${now}`);
  }

  protected afterDeparture(_playerId: PlayerId, now: number): readonly ServerMessage[] | null {
    return this.status === "playing" && this.allActiveIn(this.playerGuesses) ? this.closeRound(now) : null;
  }

  updateOptions(playerId: PlayerId, options: { readonly roundLimit?: number; readonly roundDurationMs?: number; readonly mapTapCategories?: readonly MapTapCategory[] }, now: number): RoomResult {
    this.touch(now);
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the host can change room settings.");
    if (this.status !== "lobby") return fail("game-started", "Room settings can only change in the lobby.");
    if (options.mapTapCategories !== undefined) this.mapTapCategories = resolveMapTapCategories(options.mapTapCategories);
    if (options.roundLimit !== undefined) this.roundLimit = options.roundLimit;
    this.roundLimit = Math.min(this.roundLimit, this.eligibleLocationCount());
    if (options.roundDurationMs !== undefined) this.roundDurationMs = options.roundDurationMs;
    this.locationQueue = this.buildQueue(`${this.seed}:settings:${now}`);
    return ok([this.snapshotMessage()]);
  }

  submitGuess(playerId: PlayerId, lat: number, lng: number, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing" || !this.currentRound) return fail("round-not-open", "No active round is accepting guesses.");
    if (now < this.currentRound.startedAt || (this.currentRound.endsAt !== null && now >= this.currentRound.endsAt)) return fail("round-not-open", "This round has ended.");
    const player = this.activePlayer(playerId);
    if ("ok" in player) return player;
    if (this.playerGuesses.has(playerId)) return ok([], [{ type: "ERROR", code: "already-guessed", message: "You have already guessed this round." }]);
    this.playerGuesses.set(playerId, { lat, lng });
    if (this.allActiveIn(this.playerGuesses)) return ok(this.closeRound(now));
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
    const player = this.activePlayer(playerId);
    if ("ok" in player) return player;
    this.skipVotes.add(playerId);
    if (this.allActiveIn(this.skipVotes)) return ok(this.closeRound(now));
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
    const sorted = [...this.participants()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return sorted.map((player, index) => ({
      playerId: player.id,
      name: player.name,
      rank: index + 1,
      score: player.score,
      correctAnswers: player.roundsGuessed,
      wrongAnswers: player.roundsMissed,
    }));
  }

  private buildQueue(seed: string): number[] {
    const selected = new Set(this.mapTapCategories);
    const indices = MAP_TAP_LOCATIONS.map((location, i) => selected.has(location.category) ? i : -1).filter((index) => index >= 0);
    return shuffle(indices, createSeededRandom(seed));
  }

  private eligibleLocationCount(): number {
    const selected = new Set(this.mapTapCategories);
    return MAP_TAP_LOCATIONS.filter((location) => selected.has(location.category)).length;
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
      for (const player of this.participants()) {
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
