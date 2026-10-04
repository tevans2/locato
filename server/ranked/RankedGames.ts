import { randomBytes } from "node:crypto";
import { indexCountries, rawCountries, type Country, type CountryIndex } from "../../src/core/countries";
import { getCategory, matchesCountryName } from "../../src/core/categories";
import { matchesCapitalName } from "../../src/core/categories/matching";
import { createPromptCountryIndex } from "../../src/core/flagPools";
import { createSeededRandom, shuffle } from "../../src/core/game";
import { createHint } from "../../src/core/game/GameEngine";
import { leaderboardConfig, streetViewCountryPoints } from "../../src/core/leaderboards";
import { buildFlyoverCountries, countryContainsPoint, type FlyoverCountry } from "../../src/core/flyover";
import { MAP_TAP_LOCATIONS } from "../../src/core/maptap/locations";
import { isValidLatLng, scoreMapTapGuess } from "../../src/core/maptap/distance";
import type { MapTapLocation } from "../../src/core/maptap/types";
import { createGeoGuessrQueue, scoreGeoGuessrGuess, type GeoGuessrLocation } from "../../src/core/geoguessr";
import { streetViewCountryRounds, type StreetViewCountryRound, type StreetViewFrame } from "../../src/core/streetview";
import { buildWorldSplitCountries, scoreWorldSplit, splitLineLength, WORLD_SPLIT_ROUNDS, type WorldSplitRound } from "../../src/core/worldsplit";
import type { RankedAction, RankedQuestion, RankedState, RankedMoveResult } from "../../src/core/ranked";
import type { GameModeId } from "../../src/core/gameModes";
import type { WorldCountryFeature } from "../../src/core/map";
import type { DailyChallengeResult, DailyRoundMark, GameResult } from "../auth/types";
import { AuthoritativeFlight, parsePlaneInput } from "./AuthoritativeFlight";
import { gameArtwork, FlagReveal, rankedWorld } from "./assets";
import { streetImage } from "./GameAssets";
import { createServerDailyChallenge, createDailyShareText, scoreDailyRound, type DailyRoundResult } from "../../src/core/dailyChallenge";

const id = () => randomBytes(24).toString("hex");
const LIFETIME_MS = 2 * 60 * 60 * 1000;
const RECEIPT_LIFETIME_MS = 5 * 60 * 1000;
const MAX_RUNS = 2000;
const MIN_ACTION_GAP_MS = 150;
const INDEX = indexCountries(rawCountries);

interface Challenge {
  readonly mode: string;
  readonly country?: Country;
  readonly mapCountry?: FlyoverCountry;
  readonly location?: MapTapLocation;
  readonly geo?: GeoGuessrLocation;
  readonly street?: StreetViewCountryRound;
  readonly split?: WorldSplitRound;
}
interface Run {
  readonly id: string;
  readonly userId: string;
  readonly mode: GameModeId | "daily";
  readonly variant: string;
  readonly startedAt: number;
  readonly queue: Challenge[];
  questionId: string;
  questionAt: number;
  index: number;
  score: number;
  wrong: number;
  wrongTotal: number;
  revision: number;
  finishedAt: number | null;
  busy: boolean;
  feedback?: string;
  flight?: AuthoritativeFlight;
  reveal?: FlagReveal;
  privateFrames?: readonly StreetViewFrame[];
  readonly found: Set<string>;
  readonly marks: DailyRoundMark[];
  readonly rounds: DailyRoundResult[];
  hints: number;
  result?: RankedMoveResult;
  readonly placements: Map<string, { dx: number; dy: number }>;
}
export interface VerifiedResult { readonly mode: string; readonly variant: string; readonly value: number; }
export interface RankedGamesOptions {
  readonly clock?: () => number;
  readonly countries?: CountryIndex;
  readonly world?: readonly WorldCountryFeature[];
  readonly streetRounds?: () => Promise<readonly StreetViewCountryRound[]>;
  /** Resolve on the server so the client cannot replace the scoring origin with a snapped coordinate. */
  readonly resolvePanorama?: (frame: StreetViewFrame) => Promise<{ readonly panoId: string; readonly lat: number; readonly lng: number }>;
  readonly challengeSecret?: string;
}

export class RankedGames {
  private readonly runs = new Map<string, Run>();
  private readonly rates = new Map<string, number[]>();
  private readonly starting = new Set<string>();
  private readonly clock: () => number;
  private readonly countries: CountryIndex;
  private worldCache: readonly WorldCountryFeature[] | null = null;
  private mapCache: readonly FlyoverCountry[] | null = null;
  private readonly dailySecret: string;
  constructor(private readonly options: RankedGamesOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.countries = options.countries ?? INDEX;
    this.dailySecret = options.challengeSecret ?? id();
  }
  private get world() { return this.worldCache ??= this.options.world ?? rankedWorld(); }
  private get map() { return this.mapCache ??= buildFlyoverCountries(this.world); }

  hasDaily(userId: string, date: string): boolean {
    return [...this.runs.values()].some((run) => run.userId === userId && run.mode === "daily" && run.variant === date && this.find(userId, run.id) !== null);
  }

  async start(userId: string, input: { gameMode?: unknown; variant?: unknown }): Promise<RankedState | { error: string }> {
    if (this.starting.has(userId)) return { error: "Your game is still starting." };
    this.starting.add(userId);
    try { return await this.startGame(userId, input); }
    finally { this.starting.delete(userId); }
  }

  private async startGame(userId: string, input: { gameMode?: unknown; variant?: unknown }): Promise<RankedState | { error: string }> {
    this.sweep();
    const mode = typeof input.gameMode === "string" ? input.gameMode : "";
    const variant = typeof input.variant === "string" ? input.variant : "";
    const config = leaderboardConfig(mode);
    if (mode !== "daily" && (!config || !config.variants.includes(variant))) return { error: "Invalid ranked game or variant." };
    if (mode === "daily") {
      const date = Date.parse(`${variant}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(variant) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== variant || Math.abs(date - this.clock()) > 36 * 60 * 60 * 1000) return { error: "Invalid daily challenge date." };
    }
    if (this.runs.size >= MAX_RUNS) return { error: "Games are busy. Try again shortly." };
    if (mode === "daily") {
      const existing = [...this.runs.values()].find((run) => run.userId === userId && run.mode === mode && run.variant === variant);
      if (existing) return this.view(existing);
    }
    for (const [key, run] of this.runs) if (run.userId === userId && run.mode !== "daily" && run.finishedAt === null) this.runs.delete(key);
    const seed = mode === "daily" ? `${this.dailySecret}:${variant}` : id(); // Never sent to the browser.
    const rng = createSeededRandom(seed);
    const queue: Challenge[] = [];
    const pool = mode === "flags" ? createPromptCountryIndex(this.countries, [mode], variant === "" ? "countries" : variant as "territories" | "both") : this.countries;
    if (config?.metric === "time") {
      const category = getCategory(mode);
      const countries = shuffle(pool.countries.filter((c) => category ? category.eligible(c) : mode === "puzzle" ? c.continent === variant : true), rng);
      for (const country of countries) {
        const mapCountry = this.map.find((c) => c.code === country.code);
        queue.push({ mode, country, ...(mapCountry ? { mapCountry } : {}) });
      }
    } else if (mode === "map-tap") {
      queue.push(...shuffle(MAP_TAP_LOCATIONS, rng).slice(0, 10).map((location) => ({ mode, location })));
    } else if (mode === "worldsplit") {
      queue.push(...WORLD_SPLIT_ROUNDS.map((split) => ({ mode, split })));
    } else if (mode === "geoguessr" || mode === "streetview-country") {
      const rounds = this.options.streetRounds ? await this.options.streetRounds() : streetViewCountryRounds;
      if (mode === "geoguessr") queue.push(...createGeoGuessrQueue(seed, 5, rounds).map((geo) => ({ mode, geo })));
      else queue.push(...shuffle(rounds, rng).slice(0, 5).map((street) => ({ mode, street })));
    } else if (mode === "daily") {
      const daily = createServerDailyChallenge(this.countries, variant, seed);
      for (const slot of daily.promptSlots!) {
        const country = this.countries.byId[slot.countryId]!;
        queue.push({ mode: slot.categoryId === "pick-country" ? "click-country" : slot.categoryId, country, mapCountry: this.map.find((c) => c.code === country.code)! });
      }
      queue.push({ mode: "map-tap", location: MAP_TAP_LOCATIONS.find((l) => l.id === daily.mapTapTargetId)! });
      queue.push({ mode: "streetview-country", street: streetViewCountryRounds.find((r) => r.countryCode === daily.streetViewCountryCode)! });
    } else if (mode !== "flyover") return { error: "Invalid ranked game." };
    if (mode !== "flyover" && queue.length === 0) return { error: "No challenges are available." };
    if (mode === "daily") {
      // Check Street View before reserving the one daily attempt, so configuration/coverage
      // failures cannot strand someone after eight otherwise successful rounds.
      if (!this.options.resolvePanorama) return { error: "Street View is unavailable. Please try again later." };
      try { await Promise.all(queue.flatMap((q) => q.street?.frames ?? []).map(this.options.resolvePanorama)); }
      catch { return { error: "Street View is unavailable. Please try again later." }; }
    }
    const now = this.clock();
    const run: Run = { id: id(), userId, mode: mode as Run["mode"], variant, startedAt: now, queue, questionId: id(), questionAt: now, index: 0, score: 0, wrong: 0, wrongTotal: 0, revision: 0, finishedAt: null, busy: false, found: new Set(), marks: [], rounds: [], hints: 0, placements: new Map() };
    if (mode === "flyover") run.flight = new AuthoritativeFlight(this.map, rng, now, now + 90_000);
    this.runs.set(run.id, run);
    try { await this.prepare(run); } catch { this.runs.delete(run.id); return { error: "Street View is unavailable. Please try again later." }; }
    return this.view(run);
  }

  async action(userId: string, raw: Record<string, unknown>): Promise<RankedState | { error: string }> {
    const run = this.find(userId, raw.runId);
    if (!run) return { error: "This game expired. Start a new game." };
    if (run.busy) return { error: "Your previous move is still being checked." };
    const now = this.clock();
    const recent = (this.rates.get(userId) ?? []).filter((t) => now - t < 1000);
    if (recent.length >= 25) return { error: "Too many moves. Try again shortly." };
    this.rates.set(userId, [...recent, now]);
    if (run.finishedAt !== null) return this.view(run);
    if (run.flight) {
      const before = run.flight.index;
      if (raw.type === "input") {
        const input = parsePlaneInput(raw.input);
        if (!input) return { error: "Invalid flight controls." };
        run.flight.steer(input, now);
      } else if (raw.type === "skip") {
        run.flight.advance(now);
        if (before !== run.flight.index) { run.questionId = id(); run.questionAt = now; }
        if (raw.questionId !== run.questionId) return { error: "That target is no longer active." };
        run.flight.skip(now);
      } else if (raw.type === "poll") run.flight.advance(now);
      else return { error: "Only steering controls are accepted during flight." };
      if (before !== run.flight.index) { run.questionId = id(); run.questionAt = now; }
      run.index = run.flight.index;
      run.score = run.flight.score;
      if (now >= run.flight.endsAt || !run.flight.target) run.finishedAt = Math.min(now, run.flight.endsAt);
      return this.view(run);
    }
    if (raw.type === "poll") return this.view(run);
    if (raw.questionId !== run.questionId) return { error: "That challenge is no longer active." };
    if (now - run.questionAt < MIN_ACTION_GAP_MS) return { error: "Please try your move again." };
    run.busy = true;
    try {
      const result = await this.check(run, raw as unknown as RankedAction);
      if (result.error) return { error: result.error };
      if (result.advance) {
        if (run.mode === "daily") {
          const current = run.queue[run.index]!;
          run.rounds.push({ categoryId: current.mode === "click-country" ? "pick-country" : current.mode, points: result.points, hintsUsed: 0, wrongGuesses: run.wrong, missed: result.points === 0,
            ...(current.location ? { targetId: current.location.id } : { countryCode: current.country?.code ?? current.street!.countryCode }) });
        }
        run.score += result.points;
        run.marks.push(result.points > 0 ? "correct" : "miss");
        run.index += 1;
        run.wrong = 0;
        run.hints = 0;
        delete run.privateFrames;
        delete run.reveal;
        run.questionId = id();
        if (run.index >= run.queue.length) run.finishedAt = this.clock();
        else {
          try { await this.prepare(run); }
          catch { this.runs.delete(run.id); return { error: "Street View is unavailable. This run was cancelled; please start again later." }; }
        }
      }
      run.questionAt = this.clock();
      return this.view(run);
    } catch { return { error: "This move could not be checked. Please try again." }; }
    finally { run.busy = false; }
  }

  private async check(run: Run, action: RankedAction): Promise<{ advance: boolean; points: number; error?: string }> {
    const current = run.queue[run.index]!;
    const no = (error: string) => ({ advance: false, points: 0, error });
    const daily = run.mode === "daily";
    const correct = (points = 1) => ({ advance: true, points: daily ? scoreDailyRound(0, false, run.wrong) : points });
    const detail = (kind: RankedMoveResult["kind"], value: Partial<RankedMoveResult> = {}) => {
      run.result = { questionId: run.questionId, kind, ...value };
    };
    if (!daily && leaderboardConfig(run.mode)?.metric === "time" && getCategory(current.mode) && current.country) {
      if (action.type === "hint") {
        if (run.hints >= 3) return no("No hints left. Use Reveal answer to continue.");
        const hint = createHint(current.country, run.hints++, current.mode);
        detail("hint", { hint }); run.feedback = `${hint.title}: ${hint.message}`;
        return { advance: false, points: 0 };
      }
      if (action.type === "skip") {
        detail("skipped", { countryCode: current.country.code });
        run.feedback = `Skipped — that was ${current.mode === "capital-recall" ? current.country.capital : current.country.name}. It can return later.`;
        run.queue.splice(run.index, 1); run.queue.push(current);
        run.hints = 0; run.wrong = 0; run.questionId = id();
        delete run.reveal; await this.prepare(run);
        return { advance: false, points: 0 };
      }
      if (action.type === "reveal") {
        if (run.hints < 3) return no("Use the available hints before revealing the answer.");
        detail("revealed", { countryCode: current.country.code }); run.found.add(current.country.code);
        run.feedback = `Answer: ${current.mode === "capital-recall" ? current.country.capital : current.country.name}.`;
        return { advance: true, points: 0 };
      }
    }
    if (current.mode === "puzzle" && action.type === "puzzle-piece") {
      if (typeof action.countryCode !== "string" || !run.queue.some((q) => q.country?.code === action.countryCode) || !Number.isFinite(action.dx) || !Number.isFinite(action.dy) || Math.abs(action.dx!) > 2000 || Math.abs(action.dy!) > 2000) return no("Invalid puzzle placement.");
      run.placements.set(action.countryCode, { dx: action.dx!, dy: action.dy! });
      detail("placement"); return { advance: false, points: 0 };
    }
    if (current.mode === "puzzle" && action.type === "puzzle-check") {
      if (run.queue.some((q) => !run.placements.has(q.country!.code))) return no("Place every country before checking accuracy.");
      if ([...run.placements.values()].some((p) => Math.hypot(p.dx, p.dy) > 6)) return no("Some pieces are outside the correct position. Adjust them before posting a timed run.");
      for (const q of run.queue) run.found.add(q.country!.code);
      run.score = run.queue.length; run.index = run.queue.length; run.finishedAt = this.clock(); detail("correct");
      run.feedback = "Every country is correctly placed.";
      return { advance: false, points: 0 };
    }
    if (current.mode === "map-tap" || current.mode === "geoguessr") {
      const guess = { lat: action.lat!, lng: action.lng! };
      if (action.type !== "pin" || !isValidLatLng(guess)) return no("Invalid map pin.");
      const mapTap = current.location ? { ...scoreMapTapGuess(guess, current.location), target: current.location, guess, maxScore: 5000 } : undefined;
      const geo = current.geo ? scoreGeoGuessrGuess(guess, current.geo) : undefined;
      const points = mapTap?.score ?? geo!.score;
      detail("pin", mapTap ? { mapTap } : { geo: geo! });
      run.feedback = `${points.toLocaleString()} / 5,000 points`;
      return { advance: true, points: daily ? Math.round(points / 500) : points };
    }
    if (current.mode === "worldsplit") {
      const line = action.line;
      if (action.type !== "line" || !line || line.length !== 2 || !line.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[0] <= 1000 && p[1] >= 0 && p[1] <= 500) || splitLineLength(line) < 2) return no("Invalid split line.");
      const result = scoreWorldSplit(buildWorldSplitCountries(this.world), current.split!, line);
      detail("line", { split: result });
      run.feedback = `${result.sideAPercent.toFixed(1)}% / ${result.sideBPercent.toFixed(1)}% · ${result.score} points`;
      return correct(result.score);
    }
    if (current.mode === "puzzle" || current.mode === "click-country") {
      const selected = current.mode === "click-country" && typeof action.countryCode === "string";
      if (action.type !== "place" || (!selected && (!Number.isFinite(action.x) || !Number.isFinite(action.y) || action.x! < 0 || action.x! > 1000 || action.y! < 0 || action.y! > 500))) return no("Invalid map position.");
      const country = current.mapCountry!;
      const hit = current.mode === "puzzle" ? Math.hypot(country.centre[0] - action.x!, country.centre[1] - action.y!) <= 6
        : selected ? action.countryCode === current.country!.code : countryContainsPoint(country, action.x!, action.y!) || (country.area < 3 && Math.hypot(country.centre[0] - action.x!, country.centre[1] - action.y!) <= 3);
      if (!hit) { detail("wrong"); run.wrong += 1; run.wrongTotal += 1; run.feedback = "Try another position."; return { advance: false, points: 0 }; }
      detail("correct", { countryCode: current.country!.code });
      run.found.add(current.country!.code);
      run.feedback = `Correct · ${current.country!.name}`;
      return correct();
    }
    if (action.type === "skip" && current.mode === "streetview-country") { detail("revealed", { countryCode: current.street!.countryCode }); run.feedback = "Country skipped."; return { advance: true, points: 0 }; }
    if (action.type !== "answer" || typeof action.answer !== "string" || action.answer.length > 200) return no("Invalid answer.");
    if (current.mode === "name-all") {
      const match = this.countries.countries.find((c) => !run.found.has(c.code) && matchesCountryName(c, action.answer!, action.auto === true, false));
      if (!match) { run.feedback = "Not a new country. Try again."; return { advance: false, points: 0 }; }
      run.found.add(match.code);
      detail("correct", { countryCode: match.code });
      run.feedback = `Correct · ${match.name}`;
      return correct();
    }
    const country = current.street ? this.countries.byCode.get(current.street.countryCode)! : current.country!;
    const accepted = current.mode === "capital-recall" ? matchesCapitalName(country, action.answer, action.auto === true) : matchesCountryName(country, action.answer, action.auto === true, current.mode !== "codes" && current.mode !== "capitals");
    if (accepted) {
      detail("correct", { countryCode: country.code });
      run.found.add(country.code);
      run.feedback = `Correct · ${country.name}`;
      return correct(current.street ? streetViewCountryPoints(run.wrong + 1) : 1);
    }
    if (action.auto === true) return { advance: false, points: 0 };
    detail("wrong");
    run.wrong += 1;
    run.wrongTotal += 1;
    run.feedback = "Try again.";
    if (current.mode === "flag-colors") {
      const guess = this.countries.countries.find((c) => matchesCountryName(c, action.answer!, false, true));
      if (guess) { await run.reveal!.guess(guess.flagSrc); run.revision += 1; }
    }
    if (current.street && run.wrong >= 3) { detail("revealed", { countryCode: country.code }); run.feedback = `Answer: ${country.name}`; return { advance: true, points: 0 }; }
    return { advance: false, points: 0 };
  }

  private async prepare(run: Run): Promise<void> {
    const current = run.queue[run.index];
    if (!current) return;
    if (current.mode === "flag-colors") run.reveal = new FlagReveal(current.country!.flagSrc);
    const frames = current.street?.frames ?? (current.geo ? [current.geo] : null);
    if (frames) {
      if (!this.options.resolvePanorama) throw new Error("Server Street View metadata key required.");
      const resolved = await Promise.all(frames.map(async (frame) => ({ ...frame, ...await this.options.resolvePanorama!(frame) })));
      run.privateFrames = resolved;
      if (current.geo) Object.assign(current.geo, { lat: resolved[0]!.lat, lng: resolved[0]!.lng });
    }
    run.questionAt = this.clock();
  }

  private view(run: Run): RankedState {
    const current = run.queue[run.index];
    let question: RankedQuestion | null = null;
    const asset = `/api/ranked/${run.id}/asset/${run.questionId}`;
    if (run.finishedAt === null) {
      if (run.flight) question = run.flight.target ? { id: run.questionId, kind: "flight", text: run.flight.target.name } : null;
      else if (current) {
        const country = current.country;
        const common = { id: run.questionId, text: "Name this country." };
        if (current.location) question = { ...common, kind: "pin", text: `Pin ${current.location.name}.`, mapTap: { id: run.questionId, name: current.location.name, category: current.location.category, difficulty: current.location.difficulty } };
        else if (current.geo || current.street) question = { ...common, kind: current.geo ? "pin" : "street", text: current.geo ? "Look around the street, then pin the starting location." : "Name this country.", frames: (run.privateFrames ?? []).map((_, index) => ({ asset: `${asset}?frame=${index}` })) };
        else if (current.split) question = { ...common, kind: "split", text: current.split.prompt };
        else if (current.mode === "name-all") question = { ...common, kind: "name-all", text: "Name every country." };
        else if (current.mode === "click-country") question = { ...common, kind: "click", text: `Click ${country!.name}.` };
        else if (current.mode === "spot-country") question = { ...common, kind: "spot", paths: current.mapCountry!.polygons.flatMap((p) => p) };
        else if (current.mode === "puzzle") {
          const c = current.mapCountry!;
          question = { ...common, kind: "puzzle", text: `Place ${country!.name}.`, paths: c.polygons.flatMap((p) => p.map((r) => r.map(([x, y]) => [x - c.centre[0], y - c.centre[1]] as const))) };
        } else {
          const prompt = getCategory(current.mode)!.prompt(country!);
          question = prompt.kind === "text" ? { ...common, kind: "text", text: prompt.value } : { ...common, kind: current.mode === "flag-colors" ? "flag-colors" : "image", asset: `${asset}?v=${run.revision}` };
        }
      }
    }
    return { runId: run.id, mode: run.mode, variant: run.variant, status: run.finishedAt === null ? "playing" : "complete", startedAt: run.startedAt, serverNow: this.clock(), endsAt: run.flight?.endsAt ?? null,
      index: run.index, total: run.flight ? this.map.filter((c) => c.targetable).length : run.queue.length, score: run.score,
      timeMs: run.finishedAt === null ? null : Math.round(run.finishedAt - run.startedAt), question,
      ...(run.flight ? { plane: run.flight.plane, reaches: run.flight.reaches } : {}), found: [...(run.flight?.visited ?? run.found)], hints: run.hints, wrongAnswers: run.wrongTotal, ...(run.result ? { result: run.result } : {}), ...(run.feedback ? { feedback: run.feedback } : {}) };
  }

  consume(userId: string, runId: unknown, mode: string, variant: string, claimed: unknown): VerifiedResult | null {
    const run = this.find(userId, runId);
    if (!run || run.finishedAt === null || run.mode !== mode || run.variant !== variant) return null;
    const value = leaderboardConfig(mode)?.metric === "time" ? Math.round(run.finishedAt - run.startedAt) : run.score;
    if (claimed !== value) return null;
    return { mode, variant, value };
  }

  consumeDaily(userId: string, runId: unknown): DailyChallengeResult | null {
    const run = this.find(userId, runId);
    if (!run || run.mode !== "daily" || run.finishedAt === null) return null;
    const timeMs = Math.round(run.finishedAt - run.startedAt);
    return { date: run.variant, seed: `verified-daily:${run.variant}`, completedAt: run.finishedAt, score: run.score, timeMs, hintsUsed: 0, marks: run.marks, rounds: run.rounds, challengeVersion: 2, shareText: createDailyShareText(run.variant, run.score, timeMs, run.marks) };
  }

  completedRecord(userId: string, runId: unknown): GameResult | null {
    const run = this.find(userId, runId);
    if (!run || run.finishedAt === null || run.mode === "daily") return null;
    const mapMode = ["name-all", "click-country", "spot-country", "puzzle"].includes(run.mode);
    return { mode: mapMode ? "world-map" : "solo", categoryIds: [run.mode], score: run.score, correctAnswers: run.flight?.score ?? run.found.size, wrongAnswers: run.wrongTotal, bestStreak: 0,
      ...(mapMode ? { durationMs: Math.round(run.finishedAt - run.startedAt), completed: true, countriesFound: run.found.size, countriesTotal: run.queue.length, playMode: run.mode } : {}) };
  }

  async asset(userId: string, runId: string, questionId: string, url: URL): Promise<Response> {
    const run = this.find(userId, runId);
    if (!run || run.finishedAt !== null || run.questionId !== questionId) return new Response("Not found", { status: 404 });
    const current = run.queue[run.index];
    if (run.privateFrames) {
      const index = Number(url.searchParams.get("frame") ?? 0);
      if (!Number.isInteger(index) || !run.privateFrames[index]) return new Response("Not found", { status: 404 });
      return streetImage(run.privateFrames[index]!, url);
    }
    if (!current?.country) return new Response("Not found", { status: 404 });
    const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
    if (run.reveal) return new Response(run.reveal.png(), { headers: { ...headers, "content-type": "image/png" } });
    const prompt = getCategory(current.mode)?.prompt(current.country);
    if (prompt?.kind !== "image") return new Response("Not found", { status: 404 });
    return new Response(gameArtwork(prompt.value), { headers: { ...headers, "content-type": "image/png" } });
  }

  private find(userId: string, runId: unknown): Run | null {
    const run = typeof runId === "string" ? this.runs.get(runId) : null;
    const now = this.clock();
    if (!run || run.userId !== userId || now - run.startedAt > LIFETIME_MS || (run.finishedAt !== null && now - run.finishedAt > RECEIPT_LIFETIME_MS)) return null;
    return run;
  }
  private sweep(): void {
    const now = this.clock();
    for (const [key, run] of this.runs) if (now - run.startedAt > LIFETIME_MS || (run.finishedAt !== null && now - run.finishedAt > RECEIPT_LIFETIME_MS)) this.runs.delete(key);
    for (const [userId, times] of this.rates) if (times.at(-1)! < now - 1000) this.rates.delete(userId);
  }
}
