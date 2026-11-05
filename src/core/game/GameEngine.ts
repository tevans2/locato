import { normalizeAnswerVariants, type CountryId, type CountryIndex } from "../countries";
import { buildPromptSlots, getCategory } from "../categories";
import { createFameRampQueue } from "./fameRamp";
import { createHint, isIslandPool, TOTAL_HINTS } from "./hints";
import { createRoundQueue, takeNextCountry } from "./roundQueue";
import type { CreateGameEngineInput, GameCommand, GameEngine, GameEvent, GameState, Hint } from "./types";

// Hint ladders live in ./hints — mode-aware, so they never repeat what the prompt already shows.
export { createHint, TOTAL_HINTS } from "./hints";

// Single "infinite" mode policy (the only mode now): endless run, hints on, skips on, no timer.
const STREAK_SCORE_CAP = 10;
const CORRECT_BASE_POINTS = 100;
const STREAK_BONUS_POINTS = 10;

function correctGuessPoints(streak: number): number {
  return CORRECT_BASE_POINTS + Math.min(streak, STREAK_SCORE_CAP) * STREAK_BONUS_POINTS;
}

// Seeded category-per-country assignment shared by createInitialState and matching. One slot per
// country; selecting multiple categories interleaves their prompt types into a single deck.
function buildAssignments(index: CountryIndex, categoryIds: readonly string[], seed: string): ReadonlyMap<CountryId, string> {
  return new Map(buildPromptSlots(index, categoryIds, seed).map((slot) => [slot.countryId, slot.categoryId]));
}

function filterAssignments(assignments: ReadonlyMap<CountryId, string>, poolCountryIds?: readonly CountryId[]): ReadonlyMap<CountryId, string> {
  if (!poolCountryIds) return assignments;

  const filtered = new Map<CountryId, string>();
  for (const countryId of poolCountryIds) {
    const categoryId = assignments.get(countryId);
    if (categoryId) filtered.set(countryId, categoryId);
  }
  return filtered;
}

function createInitialState(
  assignments: ReadonlyMap<CountryId, string>,
  categoryIds: readonly string[],
  seed: string,
  now: number,
  countryIndex?: CountryIndex,
  poolOrdering?: CreateGameEngineInput["poolOrdering"],
): GameState {
  const poolCountryIds = [...assignments.keys()];
  const initialQueue = poolOrdering === "fixed" ? { remainingCountryIds: poolCountryIds } : poolOrdering === "fame-ramp" && countryIndex
    ? createFameRampQueue(poolCountryIds, countryIndex, seed)
    : createRoundQueue(poolCountryIds, seed);
  const next = takeNextCountry(initialQueue, new Set<CountryId>());
  const status = next.countryId === null ? "complete" : "playing";
  return {
    status,
    categoryIds: [...categoryIds],
    seed,
    currentCountryId: next.countryId,
    currentCategoryId: next.countryId === null ? null : assignments.get(next.countryId) ?? null,
    roundNumber: next.countryId === null ? 0 : 1,
    guessedCountryIds: new Set<CountryId>(),
    skippedCountryIds: new Set<CountryId>(),
    attempts: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    streak: 0,
    bestStreak: 0,
    score: 0,
    hintLevel: 0,
    startedAt: now,
    endedAt: status === "complete" ? now : null,
    lastResult: null,
    queue: next.queue,
    poolCountryIds,
  };
}

function advanceToNextCountry(
  state: GameState,
  assignments: ReadonlyMap<CountryId, string>,
  now: number,
): Pick<GameState, "currentCountryId" | "currentCategoryId" | "queue" | "roundNumber" | "status" | "endedAt" | "hintLevel"> {
  const next = takeNextCountry(state.queue, state.guessedCountryIds);
  const complete = next.countryId === null;

  return {
    currentCountryId: next.countryId,
    currentCategoryId: next.countryId === null ? null : assignments.get(next.countryId) ?? null,
    queue: next.queue,
    roundNumber: complete ? state.roundNumber : state.roundNumber + 1,
    status: complete ? "complete" : "playing",
    endedAt: complete ? now : null,
    hintLevel: 0,
  };
}

export function createGameEngine(input: CreateGameEngineInput): GameEngine {
  const { countryIndex } = input;
  let categoryIds = input.initialState?.categoryIds ?? input.categoryIds;
  function assignmentsFor(seed: string): ReadonlyMap<CountryId, string> {
    const assignments = input.promptSlots
      ? new Map(input.promptSlots.filter((slot) => {
          const country = countryIndex.byId[slot.countryId];
          const category = getCategory(slot.categoryId);
          return country && category && category.eligible(country) && (!country.allowedCategoryIds || country.allowedCategoryIds.includes(category.id));
        }).map((slot) => [slot.countryId, slot.categoryId]))
      : buildAssignments(countryIndex, categoryIds, seed);
    return filterAssignments(assignments, input.poolCountryIds);
  }
  let assignments = assignmentsFor(input.initialState?.seed ?? input.seed);
  let state = input.initialState ? { ...input.initialState, currentCategoryId: input.initialState.currentCountryId === null ? null : assignments.get(input.initialState.currentCountryId) ?? null }
    : createInitialState(assignments, categoryIds, input.seed, input.now ?? Date.now(), input.countryIndex, input.poolOrdering);

  function categoryFor(countryId: CountryId) {
    return getCategory(assignments.get(countryId) ?? "") ?? getCategory("flags");
  }

  function completeIfNeeded(events: GameEvent[], now: number): void {
    if (state.status === "complete") {
      if (state.endedAt === now && !events.some((event) => event.type === "GAME_COMPLETED")) events.push({ type: "GAME_COMPLETED" });
      return;
    }

    if (state.guessedCountryIds.size >= state.poolCountryIds.length) {
      state = { ...state, status: "complete", currentCountryId: null, currentCategoryId: null, endedAt: now };
      if (!events.some((event) => event.type === "GAME_COMPLETED")) events.push({ type: "GAME_COMPLETED" });
    }
  }

  return {
    getState: () => state,
    dispatch: (command: GameCommand) => {
      const events: GameEvent[] = [];

      if (command.type === "START_GAME" || command.type === "RESET_GAME") {
        if (command.type === "START_GAME") categoryIds = command.categoryIds;
        const seed = command.type === "START_GAME" ? command.seed : state.seed;
        assignments = assignmentsFor(seed);
        state = createInitialState(assignments, categoryIds, seed, command.now, input.countryIndex, input.poolOrdering);
        if (state.currentCountryId !== null) events.push({ type: "GAME_STARTED", currentCountryId: state.currentCountryId });
        if (command.type === "RESET_GAME") events.push({ type: "GAME_RESET" });
        return events;
      }

      if (command.type === "TICK") {
        completeIfNeeded(events, command.now);
        return events;
      }

      if (state.status !== "playing" || state.currentCountryId === null) return events;

      const currentCountry = countryIndex.byId[state.currentCountryId];
      const category = categoryFor(state.currentCountryId);
      if (!currentCountry || !category) return events;

      if (command.type === "REQUEST_HINT") {
        const hint = createHint(currentCountry, state.hintLevel, category.id, {
          islandPool: isIslandPool(state.poolCountryIds, countryIndex),
        });
        state = {
          ...state,
          hintLevel: state.hintLevel + 1,
          lastResult: { type: "hint", countryId: currentCountry.id, message: `${hint.title}: ${hint.message}` },
        };
        events.push({ type: "HINT_REVEALED", countryId: currentCountry.id, hint });
        return events;
      }

      if (command.type === "SKIP_ROUND") {
        const skippedCountryIds = new Set(state.skippedCountryIds);
        skippedCountryIds.add(currentCountry.id);
        const queue = { remainingCountryIds: [...state.queue.remainingCountryIds, currentCountry.id] };
        const advanced = advanceToNextCountry({ ...state, skippedCountryIds, queue }, assignments, command.now);
        state = {
          ...state,
          ...advanced,
          skippedCountryIds,
          streak: 0,
          lastResult: { type: "skipped", countryId: currentCountry.id, message: `Skipped ${category.reveal(currentCountry)}.` },
        };
        events.push({ type: "ROUND_SKIPPED", previousCountryId: currentCountry.id, nextCountryId: state.currentCountryId });
        completeIfNeeded(events, command.now);
        return events;
      }

      if (command.type === "REVEAL_ANSWER") {
        const guessedCountryIds = new Set(state.guessedCountryIds);
        guessedCountryIds.add(currentCountry.id);
        const advanced = advanceToNextCountry({ ...state, guessedCountryIds }, assignments, command.now);
        state = {
          ...state,
          ...advanced,
          guessedCountryIds,
          streak: 0,
          lastResult: { type: "revealed", countryId: currentCountry.id, message: `Answer: ${category.reveal(currentCountry)}.` },
        };
        events.push({ type: "ANSWER_REVEALED", countryId: currentCountry.id, nextCountryId: state.currentCountryId });
        completeIfNeeded(events, command.now);
        return events;
      }

      if (command.type !== "SUBMIT_GUESS") return events;

      if (normalizeAnswerVariants(command.value).length === 0) return events;

      if (category.accepts(currentCountry, command.value, command.auto ?? false)) {
        const guessedCountryIds = new Set(state.guessedCountryIds);
        guessedCountryIds.add(currentCountry.id);
        const nextStreak = state.streak + 1;
        const points = correctGuessPoints(state.streak);
        const advanced = advanceToNextCountry({ ...state, guessedCountryIds }, assignments, command.now);
        state = {
          ...state,
          ...advanced,
          guessedCountryIds,
          attempts: state.attempts + 1,
          correctAnswers: state.correctAnswers + 1,
          streak: nextStreak,
          bestStreak: Math.max(state.bestStreak, nextStreak),
          score: state.score + points,
          lastResult: { type: "correct", countryId: currentCountry.id, message: `Correct: ${category.reveal(currentCountry)}.` },
        };
        events.push({ type: "GUESS_CORRECT", countryId: currentCountry.id, nextCountryId: state.currentCountryId, points });
        completeIfNeeded(events, command.now);
        return events;
      }

      if (command.auto) return events;

      state = {
        ...state,
        attempts: state.attempts + 1,
        wrongAnswers: state.wrongAnswers + 1,
        streak: 0,
        lastResult: { type: "wrong", countryId: currentCountry.id, message: "Not quite. The prompt is still live." },
      };
      events.push({ type: "GUESS_WRONG", countryId: currentCountry.id });
      return events;
    },
  };
}
