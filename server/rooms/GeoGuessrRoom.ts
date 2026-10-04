import type { CountryIndex } from "../../src/core/countries";
import { createGeoGuessrQueue, scoreGeoGuessrGuess, type GeoGuessrLocation } from "../../src/core/geoguessr";
import { isValidLatLng, normalizeLongitude } from "../../src/core/maptap/distance";
import type { FinalResult, GeoGuessrRoundResult, PlayerId, PublicPlayerState, PublicRoomSettings, PublicRoundState, RoomCode } from "../../src/core/multiplayer/roomTypes";
import type { ServerMessage } from "../../src/core/multiplayer/protocol";
import { basePlayer, fail, ok, RoomBase, type RoomResult } from "./RoomBase";

export const DEFAULT_GEOGUESSR_ROUND_DURATION_MS = 60_000;
export const DEFAULT_GEOGUESSR_RESULT_DISPLAY_MS = 8_000;
export const DEFAULT_GEOGUESSR_ROUND_LIMIT = 5;
export const DEFAULT_GEOGUESSR_MAX_PLAYERS = 8;

interface GeoGuessrPlayerState extends PublicPlayerState {
  readonly roundsGuessed: number;
  readonly roundsMissed: number;
}

interface GeoGuessrPrivateRound {
  readonly roundNumber: number;
  readonly location: GeoGuessrLocation;
  readonly startedAt: number;
  readonly endsAt: number | null;
}

/** Everyone explores the same Street View spot and pins a guess; closest scores most. */
export class GeoGuessrRoom extends RoomBase<GeoGuessrPlayerState> {
  readonly kind = "geoguessr" as const;
  roundLimit: number;
  roundDurationMs: number;
  readonly resultDisplayMs: number;

  private readonly countryIndex: CountryIndex;
  private locationQueue: GeoGuessrLocation[] = [];
  private currentRound: GeoGuessrPrivateRound | null = null;
  private playerGuesses = new Map<PlayerId, { lat: number; lng: number }>();
  private completedRounds = 0;
  private resultStartedAt: number | null = null;
  private resultEndsAt: number | null = null;

  constructor(options: {
    code: RoomCode;
    hostPlayerId: PlayerId;
    hostName: string;
    hostAvatarEmoji?: string;
    countryIndex: CountryIndex;
    seed: string;
    now: number;
    maxPlayers?: number;
    roundLimit?: number;
    roundDurationMs?: number;
    resultDisplayMs?: number;
  }) {
    super({ ...options, maxPlayers: options.maxPlayers ?? DEFAULT_GEOGUESSR_MAX_PLAYERS });
    this.countryIndex = options.countryIndex;
    this.roundDurationMs = options.roundDurationMs ?? DEFAULT_GEOGUESSR_ROUND_DURATION_MS;
    this.resultDisplayMs = options.resultDisplayMs ?? DEFAULT_GEOGUESSR_RESULT_DISPLAY_MS;
    this.roundLimit = options.roundLimit ?? DEFAULT_GEOGUESSR_ROUND_LIMIT;
    this.locationQueue = createGeoGuessrQueue(options.seed, this.roundLimit);
  }

  protected newPlayer(id: PlayerId, name: string, avatarEmoji?: string): GeoGuessrPlayerState {
    return { ...basePlayer(id, name, avatarEmoji), roundsGuessed: 0, roundsMissed: 0 };
  }

  protected snapshotCategoryIds(): readonly string[] {
    return ["geoguessr"];
  }

  protected snapshotSettings(): PublicRoomSettings {
    return { roundLimit: this.roundLimit, roundDurationMs: this.roundDurationMs };
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
    const { location } = this.currentRound;
    return {
      roundNumber: this.currentRound.roundNumber,
      prompt: { kind: "geoguessr-streetview", value: JSON.stringify({ lat: location.lat, lng: location.lng, heading: location.heading, pitch: location.pitch ?? 0, fov: location.fov ?? 90 }) },
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
    this.locationQueue = createGeoGuessrQueue(`${this.seed}:${now}`, this.roundLimit);
  }

  protected afterDeparture(_playerId: PlayerId, now: number): readonly ServerMessage[] | null {
    return this.status === "playing" && this.allActiveIn(this.playerGuesses) ? this.closeRound(now) : null;
  }

  updateOptions(playerId: PlayerId, options: { readonly roundLimit?: number; readonly roundDurationMs?: number }, now: number): RoomResult {
    this.touch(now);
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the host can change room settings.");
    if (this.status !== "lobby") return fail("game-started", "Room settings can only change in the lobby.");
    if (options.roundLimit !== undefined) this.roundLimit = options.roundLimit;
    if (options.roundDurationMs !== undefined) this.roundDurationMs = options.roundDurationMs;
    this.locationQueue = createGeoGuessrQueue(`${this.seed}:options:${now}`, this.roundLimit);
    return ok([this.snapshotMessage()]);
  }

  submitGuess(playerId: PlayerId, lat: number, lng: number, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing" || !this.currentRound) return fail("round-not-open", "No active round is accepting guesses.");
    const player = this.activePlayer(playerId);
    if ("ok" in player) return player;
    if (this.playerGuesses.has(playerId)) return ok([], [{ type: "ERROR", code: "already-guessed", message: "You have already guessed this round." }]);
    const normalizedGuess = { lat, lng: normalizeLongitude(lng) };
    if (!isValidLatLng(normalizedGuess)) return fail("invalid-guess", "That map position is invalid.");
    this.playerGuesses.set(playerId, normalizedGuess);
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
    const sorted = [...this.participants()].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
    return sorted.map((player, index) => ({
      playerId: player.id,
      name: player.name,
      rank: index + 1,
      score: player.score,
      correctAnswers: player.roundsGuessed,
      wrongAnswers: player.roundsMissed,
    }));
  }

  private beginNextRound(now: number): PublicRoundState | null {
    const location = this.locationQueue.shift();
    if (!location) return null;
    this.playerGuesses = new Map();
    this.skipVotes = new Set();
    this.resultStartedAt = null;
    this.resultEndsAt = null;
    this.status = "playing";
    this.currentRound = { roundNumber: this.completedRounds + 1, location, startedAt: now, endsAt: this.roundDurationMs > 0 ? now + this.roundDurationMs : null };
    return this.publicRound;
  }

  private closeRound(now: number): readonly ServerMessage[] {
    const location = this.currentRound?.location ?? null;
    const results: GeoGuessrRoundResult[] = [];
    if (location) {
      for (const player of this.participants()) {
        const guess = this.playerGuesses.get(player.id) ?? null;
        const scored = guess ? scoreGeoGuessrGuess(guess, location) : null;
        const score = scored?.score ?? 0;
        this.players.set(player.id, {
          ...player,
          score: player.score + score,
          roundsGuessed: player.roundsGuessed + (guess ? 1 : 0),
          roundsMissed: player.roundsMissed + (guess ? 0 : 1),
          correctAnswers: player.correctAnswers + (guess ? 1 : 0),
          wrongAnswers: player.wrongAnswers + (guess ? 0 : 1),
        });
        results.push({
          playerId: player.id,
          name: player.name,
          guess,
          distanceKm: scored ? Math.round(scored.distanceKm * 10) / 10 : null,
          score,
        });
      }
      results.sort((left, right) => right.score - left.score);
    }
    this.status = "round-result";
    this.completedRounds += 1;
    this.resultStartedAt = now;
    this.resultEndsAt = now + this.resultDisplayMs;
    this.skipVotes = new Set();
    const message: ServerMessage = location
      ? {
          type: "GEOGUESSR_ROUND_ENDED",
          countryName: this.countryIndex.byCode.get(location.countryCode)?.name ?? location.countryCode,
          targetLat: location.lat,
          targetLng: location.lng,
          results,
        }
      : { type: "ERROR", code: "location-not-found", message: "Round location is unavailable." };
    return [message, this.snapshotMessage()];
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
