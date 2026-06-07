import { COUNTRY_FACTS } from "../countries/facts";
import { normalizeAnswerVariants, type Country, type CountryId, type CountryIndex } from "../countries";
import { buildPromptSlots, getCategory } from "../categories";
import { createRoundQueue, takeNextCountry } from "./roundQueue";
import type { CreateGameEngineInput, GameCommand, GameEngine, GameEvent, GameState, Hint } from "./types";

// Single "infinite" mode policy (the only mode now): endless run, hints on, skips on, no timer.
const STREAK_SCORE_CAP = 10;
const CORRECT_BASE_POINTS = 100;
const STREAK_BONUS_POINTS = 10;

// Number of distinct hints before the hint button flips to "Reveal answer".
export const TOTAL_HINTS = 3;

function correctGuessPoints(streak: number): number {
  return CORRECT_BASE_POINTS + Math.min(streak, STREAK_SCORE_CAP) * STREAK_BONUS_POINTS;
}

function countNameLetters(name: string): number {
  return name.replace(/[^A-Za-z]/g, "").length;
}

function countNameWords(name: string): number {
  return name.split(/\s+/).filter(Boolean).length;
}

function createHint(country: Country, level: number): Hint {
  const hintLevel = Math.min(level, TOTAL_HINTS - 1);
  if (hintLevel === 0) {
    return {
      title: "Country note",
      message: COUNTRY_FACTS[country.code] ?? `It has a distinct geographic profile in ${country.continent}.`,
      level: hintLevel,
    };
  }

  if (hintLevel === 1) {
    const letterCount = countNameLetters(country.name);
    const wordCount = countNameWords(country.name);
    return {
      title: "Name shape",
      message: `${country.continent}. Starts with “${country.name.charAt(0).toUpperCase()}”; ${letterCount} letters${wordCount > 1 ? ` across ${wordCount} words` : ""}.`,
      level: hintLevel,
    };
  }

  const codeLetter = country.code.charAt(1) || country.code.charAt(0);
  return {
    title: "Index trace",
    message: `One ISO-code letter is “${codeLetter}”. ${country.aliases.length > 0 ? "An alternate accepted name exists." : "No alternate-name shortcut is registered."}`,
    level: hintLevel,
  };
}

// Seeded category-per-country assignment shared by createInitialState and matching. One slot per
// country; selecting multiple categories interleaves their prompt types into a single deck.
function buildAssignments(index: CountryIndex, categoryIds: readonly string[], seed: string): ReadonlyMap<CountryId, string> {
  return new Map(buildPromptSlots(index, categoryIds, seed).map((slot) => [slot.countryId, slot.categoryId]));
}

function createInitialState(
  assignments: ReadonlyMap<CountryId, string>,
  categoryIds: readonly string[],
  seed: string,
  now: number,
): GameState {
  const poolCountryIds = [...assignments.keys()];
  const initialQueue = createRoundQueue(poolCountryIds, seed);
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
  let assignments = buildAssignments(countryIndex, categoryIds, input.initialState?.seed ?? input.seed);
  let state = input.initialState ?? createInitialState(assignments, categoryIds, input.seed, input.now ?? Date.now());

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
        assignments = buildAssignments(countryIndex, categoryIds, seed);
        state = createInitialState(assignments, categoryIds, seed, command.now);
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
        const hint = createHint(currentCountry, state.hintLevel);
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
