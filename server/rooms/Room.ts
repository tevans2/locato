import type { CountryId, CountryIndex } from "../../src/core/countries";
import { createPromptCountryIndex, DEFAULT_FLAG_POOL, normalizeFlagPool, type FlagPool } from "../../src/core/flagPools";
import { createSeededRandom, shuffle } from "../../src/core/game";
import { buildPromptSlots, getCategory, resolveCategoryIds, type PromptSlot } from "../../src/core/categories";
import type { FinalResult, PlayerId, PublicPlayerState, PublicRoomSettings, PublicRoundState, RoomCode, RoundResult, ServerMessage } from "../../src/core/multiplayer";
import { issueGameAsset, revokeGameAsset } from "../ranked/GameAssets";
import { FlagReveal, countryOutline } from "../ranked/assets";
import { matchesCountryName } from "../../src/core/categories/matching";
import { basePlayer, fail, ok, RoomBase, type RoomResult } from "./RoomBase";

export type { RoomResult, RoomStatus } from "./RoomBase";

export const DEFAULT_MAX_PLAYERS_PER_ROOM = 8;
export const DEFAULT_MULTIPLAYER_ROUND_LIMIT = 10;
export const DEFAULT_ROUND_DURATION_MS = 30_000;
export const DEFAULT_RESULT_DISPLAY_MS = 4_000;

export interface RoomOptions {
  readonly code: RoomCode;
  readonly hostPlayerId: PlayerId;
  readonly hostName: string;
  readonly hostAvatarEmoji?: string;
  readonly countryIndex: CountryIndex;
  readonly categoryIds: readonly string[];
  readonly seed: string;
  readonly now: number;
  readonly maxPlayers?: number;
  readonly roundLimit?: number;
  readonly roundDurationMs?: number;
  readonly resultDisplayMs?: number;
  readonly flagPool?: FlagPool;
}

interface PrivateRoundState {
  readonly roundNumber: number;
  readonly countryId: CountryId;
  readonly categoryId: string;
  readonly startedAt: number;
  readonly endsAt: number | null;
}

/** The quiz race: a mix of prompt modes, and the first right answer takes each round. */
export class Room extends RoomBase<PublicPlayerState> {
  readonly kind = "quiz" as const;
  categoryIds: readonly string[];
  roundLimit: number;
  roundDurationMs: number;
  readonly resultDisplayMs: number;
  readonly countryIndex: CountryIndex;
  flagPool: FlagPool;

  private promptCountryIndex: CountryIndex;
  private remainingSlots: PromptSlot[];
  private currentRound: PrivateRoundState | null = null;
  private artwork: string | null = null;
  private flagReveals = new Map<PlayerId, { reveal: FlagReveal; url: string; revision: number }>();
  private roundAnswers = new Map<PlayerId, RoundResult>();
  private completedRounds = 0;
  private resultStartedAt: number | null = null;
  private resultEndsAt: number | null = null;

  constructor(options: RoomOptions) {
    super({ ...options, maxPlayers: options.maxPlayers ?? DEFAULT_MAX_PLAYERS_PER_ROOM });
    this.categoryIds = options.categoryIds;
    this.countryIndex = options.countryIndex;
    this.flagPool = normalizeFlagPool(options.flagPool ?? DEFAULT_FLAG_POOL);
    this.promptCountryIndex = createPromptCountryIndex(this.countryIndex, options.categoryIds, this.flagPool);
    const slots = this.createRoundQueue(options.categoryIds, options.seed, this.promptCountryIndex);
    this.roundLimit = Math.min(options.roundLimit ?? DEFAULT_MULTIPLAYER_ROUND_LIMIT, slots.length);
    this.roundDurationMs = options.roundDurationMs ?? DEFAULT_ROUND_DURATION_MS;
    this.resultDisplayMs = options.resultDisplayMs ?? DEFAULT_RESULT_DISPLAY_MS;
    this.remainingSlots = slots;
  }

  protected newPlayer(id: PlayerId, name: string, avatarEmoji?: string): PublicPlayerState {
    return basePlayer(id, name, avatarEmoji);
  }

  protected snapshotCategoryIds(): readonly string[] {
    return this.categoryIds;
  }

  protected snapshotSettings(): PublicRoomSettings {
    return { roundLimit: this.roundLimit, roundDurationMs: this.roundDurationMs, flagPool: this.flagPool };
  }

  get publicRound(): PublicRoundState | null {
    const round = this.currentRound;
    if (!round) return null;
    const country = this.promptCountryIndex.byId[round.countryId];
    const category = getCategory(round.categoryId);
    if (!country || !category) return null;
    const prompt = category.prompt(country);
    return { roundNumber: round.roundNumber, prompt: this.artwork ? { ...prompt, value: this.artwork } : prompt, startedAt: round.startedAt, endsAt: round.endsAt };
  }

  // Epoch ms when the current auto-advancing phase ends: the round deadline while
  // "playing", the result-display deadline while "round-result", null otherwise.
  // Doubles as the public phaseEndsAt and the RoomManager's transition trigger.
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

  protected beginGame(now: number): RoomResult {
    const round = this.beginNextRound(now);
    if (!round) return this.completeGame(now);
    return ok([{ type: "GAME_STARTED", round }, this.snapshotMessage()]);
  }

  protected resetGame(now: number): void {
    this.roundAnswers = new Map();
    this.completedRounds = 0;
    this.currentRound = null;
    this.resultStartedAt = null;
    this.resultEndsAt = null;
    this.remainingSlots = this.createRoundQueue(this.categoryIds, `${this.seed}:${now}`, this.promptCountryIndex);
  }

  protected afterDeparture(_playerId: PlayerId, now: number): readonly ServerMessage[] | null {
    return this.status === "playing" && this.allActiveIn(this.skipVotes) ? this.closeRound(now) : null;
  }

  updateOptions(
    playerId: PlayerId,
    options: { readonly categoryIds: readonly string[]; readonly roundLimit?: number; readonly roundDurationMs?: number; readonly flagPool?: FlagPool },
    now: number,
  ): RoomResult {
    this.touch(now);
    if (playerId !== this.hostPlayerId) return fail("not-host", "Only the host can change room settings.");
    if (this.status !== "lobby") return fail("game-started", "Room settings can only change in the lobby.");

    const nextCategoryIds = resolveCategoryIds(options.categoryIds);
    const nextFlagPool = normalizeFlagPool(options.flagPool ?? this.flagPool);
    const nextPromptCountryIndex = createPromptCountryIndex(this.countryIndex, nextCategoryIds, nextFlagPool);
    const nextQueue = this.createRoundQueue(nextCategoryIds, `${this.seed}:settings:${now}`, nextPromptCountryIndex);
    if (nextQueue.length === 0) return fail("invalid-category", "Those game modes do not have any playable rounds.");

    this.categoryIds = nextCategoryIds;
    this.flagPool = nextFlagPool;
    this.promptCountryIndex = nextPromptCountryIndex;
    if (options.roundDurationMs !== undefined) this.roundDurationMs = options.roundDurationMs;
    const requestedRoundLimit = options.roundLimit ?? this.roundLimit;
    this.roundLimit = Math.min(requestedRoundLimit, nextQueue.length);
    this.remainingSlots = nextQueue;
    return ok([this.snapshotMessage()]);
  }

  submitAnswer(playerId: PlayerId, answer: string, now: number): RoomResult {
    this.touch(now);
    if (this.status !== "playing" || !this.currentRound) return fail("round-not-open", "No active round is accepting answers.");
    if (now < this.currentRound.startedAt || (this.currentRound.endsAt !== null && now >= this.currentRound.endsAt)) return fail("round-not-open", "This round has ended.");
    const player = this.activePlayer(playerId);
    if ("ok" in player) return player;

    const country = this.promptCountryIndex.byId[this.currentRound.countryId];
    const category = getCategory(this.currentRound.categoryId);
    if (!country || !category) return fail("country-not-found", "Current prompt is unavailable.");

    // Each answer replaces the last, so the reveal shows what a player was going for at the end.
    const attempts = (this.roundAnswers.get(playerId)?.attempts ?? 0) + 1;
    const elapsedMs = Math.max(0, now - this.currentRound.startedAt);
    if (!category.accepts(country, answer, false)) {
      const updatedPlayer = { ...player, wrongAnswers: player.wrongAnswers + 1, streak: 0 };
      this.players.set(playerId, updatedPlayer);
      this.roundAnswers.set(playerId, { playerId, name: player.name, correct: false, points: 0, answeredAt: now, guess: answer, attempts, elapsedMs });
      // Rejection is private to the guesser: broadcasting it would flash "Not quite" on every
      // screen. No state other than this player's private streak/wrong tally changes, so there
      // is nothing to broadcast either.
      const reply: ServerMessage[] = [{ type: "ANSWER_REJECTED", reason: "Not quite. Try again before the round ends." }];
      if (category.id === "flag-colors") {
        const guess = this.promptCountryIndex.countries.find((c) => matchesCountryName(c, answer, false, true));
        if (guess) {
          let entry = this.flagReveals.get(playerId);
          if (!entry) {
            const reveal = new FlagReveal(country.flagSrc);
            entry = { reveal, url: issueGameAsset({ reveal }), revision: 0 };
            this.flagReveals.set(playerId, entry);
          }
          entry.reveal.guess(guess.flagSrc);
          entry.revision += 1;
          reply.push({ type: "ROUND_STARTED", round: { ...this.publicRound!, prompt: { kind: "flag-colors", value: `${entry.url}?v=${entry.revision}` } } });
        }
      }
      return ok([], reply);
    }

    const points = this.calculatePoints(player, now);
    const updatedPlayer = { ...player, score: player.score + points, streak: player.streak + 1, correctAnswers: player.correctAnswers + 1 };
    this.players.set(playerId, updatedPlayer);
    this.roundAnswers.set(playerId, { playerId, name: player.name, correct: true, points, answeredAt: now, guess: answer, attempts, elapsedMs });
    // First correct answer takes the round and the points; the round closes immediately.
    return ok([{ type: "ANSWER_ACCEPTED", playerId, points }, ...this.closeRound(now)]);
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
    const sorted = [...this.participants()].sort((left, right) => right.score - left.score || right.correctAnswers - left.correctAnswers || left.name.localeCompare(right.name));
    return sorted.map((player, index) => ({ playerId: player.id, name: player.name, rank: index + 1, score: player.score, correctAnswers: player.correctAnswers, wrongAnswers: player.wrongAnswers }));
  }

  private createRoundQueue(categoryIds: readonly string[], seed: string, index: CountryIndex = this.promptCountryIndex): PromptSlot[] {
    return [...shuffle(buildPromptSlots(index, categoryIds, seed), createSeededRandom(seed))];
  }

  private beginNextRound(now: number): PublicRoundState | null {
    const slot = this.remainingSlots.shift();
    if (!slot) {
      this.currentRound = null;
      return null;
    }

    this.roundAnswers = new Map();
    this.skipVotes = new Set();
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
    this.clearArtwork();
    const country = this.promptCountryIndex.byId[slot.countryId]!;
    const prompt = getCategory(slot.categoryId)!.prompt(country);
    if (prompt.kind === "map-highlight") this.artwork = JSON.stringify({ paths: countryOutline(country.code) });
    else if (prompt.kind === "image") this.artwork = issueGameAsset({ path: prompt.value });
    else if (prompt.kind === "flag-colors") this.artwork = issueGameAsset({ reveal: new FlagReveal(country.flagSrc) });
    return this.publicRound;
  }

  private calculatePoints(player: PublicPlayerState, now: number): number {
    const timeBonus = this.currentRound?.endsAt ? Math.max(0, Math.ceil((this.currentRound.endsAt - now) / 1000)) : 0;
    return 100 + Math.min(player.streak, 10) * 10 + timeBonus;
  }

  // Closes the live round into the result-reveal phase. Reads the reveal/results while the
  // round state is still intact, then arms the result-display deadline the RoomManager uses
  // to schedule the next round.
  private closeRound(now: number): readonly ServerMessage[] {
    this.clearArtwork();
    const reveal = this.roundEndedMessage();
    this.status = "round-result";
    this.completedRounds += 1;
    this.resultStartedAt = now;
    this.resultEndsAt = this.resultDisplayMs > 0 ? now + this.resultDisplayMs : now;
    this.skipVotes = new Set();
    return [reveal, this.snapshotMessage()];
  }

  /** The winner first, then everyone who guessed (latest guess), then anyone who didn't. */
  private roundResults(): readonly RoundResult[] {
    const results = this.participants().map((player) => this.roundAnswers.get(player.id) ?? { playerId: player.id, name: player.name, correct: false, points: 0, answeredAt: null, guess: null, attempts: 0, elapsedMs: null });
    const order = (result: RoundResult): number => (result.correct ? 0 : result.attempts > 0 ? 1 : 2);
    return [...results].sort((left, right) => order(left) - order(right));
  }

  private roundEndedMessage(): ServerMessage {
    const round = this.currentRound;
    const country = round ? this.promptCountryIndex.byId[round.countryId] : null;
    const category = round ? getCategory(round.categoryId) : null;
    if (!country || !category) return { type: "ERROR", code: "country-not-found", message: "Round prompt is unavailable." };
    return { type: "ROUND_ENDED", answer: category.reveal(country), results: this.roundResults() };
  }

  private completeGame(now: number): RoomResult {
    this.clearArtwork();
    this.touch(now);
    this.status = "complete";
    this.currentRound = null;
    this.resultStartedAt = null;
    this.resultEndsAt = null;
    return ok([{ type: "GAME_COMPLETED", results: this.finalResults() }, this.snapshotMessage()]);
  }

  private clearArtwork(): void {
    if (this.artwork) revokeGameAsset(this.artwork);
    this.artwork = null;
    for (const entry of this.flagReveals.values()) revokeGameAsset(entry.url);
    this.flagReveals.clear();
  }
}
