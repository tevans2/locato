import { COUNTRY_FACTS } from "../countries/facts";
import { isToleratedMisspelling, normalizeAnswerVariants, type Country, type CountryId, type CountryIndex } from "../countries";
import type { GameMode, ModeOptions } from "../modes";
import { createRoundQueue, takeNextCountry } from "./roundQueue";
import type { CreateGameEngineInput, GameCommand, GameEngine, GameEvent, GameState, Hint } from "./types";

function countNameLetters(name: string): number {
  return name.replace(/[^A-Za-z]/g, "").length;
}

function countNameWords(name: string): number {
  return name.split(/\s+/).filter(Boolean).length;
}

function createHint(country: Country, level: number): Hint {
  const hintLevel = Math.min(level, 2);
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

function acceptedByMode(country: Country, guess: string, mode: GameMode, auto: boolean): boolean {
  const guesses = normalizeAnswerVariants(guess);
  if (guesses.length === 0) return false;
  if (auto) return guesses.includes(country.normalizedName);

  const exactAnswers = new Set<string>();
  for (const value of [country.name, ...(mode.acceptAliases ? country.aliases : [])]) {
    for (const variant of normalizeAnswerVariants(value)) exactAnswers.add(variant);
  }

  if (mode.acceptCountryCodes) {
    for (const variant of normalizeAnswerVariants(country.code)) exactAnswers.add(variant);
  }

  if (guesses.some((candidate) => exactAnswers.has(candidate))) return true;

  const fuzzyAnswers = [country.name, ...(mode.acceptAliases ? country.aliases : [])];
  return fuzzyAnswers.some((answer) => isToleratedMisspelling(guess, answer));
}

function createInitialState(
  index: CountryIndex,
  mode: GameMode,
  seed: string,
  now: number,
  modeOptions?: ModeOptions,
): GameState {
  const poolCountryIds = mode.createCountryPool(index.countries, modeOptions);
  const queue = createRoundQueue(poolCountryIds, seed);
  const next = takeNextCountry(queue, new Set<CountryId>());

  return {
    status: next.countryId === null ? "complete" : "playing",
    modeId: mode.id,
    seed,
    currentCountryId: next.countryId,
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
    endedAt: next.countryId === null ? now : null,
    lastResult: null,
    queue: next.queue,
    poolCountryIds,
  };
}

function advanceToNextCountry(
  state: GameState,
  now: number,
): Pick<GameState, "currentCountryId" | "queue" | "roundNumber" | "status" | "endedAt" | "hintLevel"> {
  const next = takeNextCountry(state.queue, state.guessedCountryIds);
  const complete = next.countryId === null;

  return {
    currentCountryId: next.countryId,
    queue: next.queue,
    roundNumber: complete ? state.roundNumber : state.roundNumber + 1,
    status: complete ? "complete" : "playing",
    endedAt: complete ? now : null,
    hintLevel: 0,
  };
}

export function createGameEngine(input: CreateGameEngineInput): GameEngine {
  const { countryIndex, mode, seed, modeOptions } = input;
  let state = input.initialState ?? createInitialState(countryIndex, mode, seed, input.now ?? Date.now(), modeOptions);

  function completeIfNeeded(events: GameEvent[], now: number): void {
    if (state.status === "complete" || mode.isComplete(state, state.poolCountryIds.length)) {
      if (state.status !== "complete") state = { ...state, status: "complete", currentCountryId: null, endedAt: now };
      if (!events.some((event) => event.type === "GAME_COMPLETED")) events.push({ type: "GAME_COMPLETED" });
    }
  }

  return {
    getState: () => state,
    dispatch: (command: GameCommand) => {
      const events: GameEvent[] = [];

      if (command.type === "START_GAME" || command.type === "RESET_GAME") {
        state = createInitialState(countryIndex, mode, command.type === "START_GAME" ? command.seed : seed, command.now, modeOptions);
        if (state.currentCountryId !== null) events.push({ type: "GAME_STARTED", currentCountryId: state.currentCountryId });
        if (command.type === "RESET_GAME") events.push({ type: "GAME_RESET" });
        return events;
      }

      if (state.status !== "playing" || state.currentCountryId === null) return events;

      const currentCountry = countryIndex.byId[state.currentCountryId];
      if (!currentCountry) return events;

      if (command.type === "REQUEST_HINT") {
        if (!mode.hints.enabled) return events;
        const hint = createHint(currentCountry, state.hintLevel);
        state = {
          ...state,
          hintLevel: state.hintLevel + 1,
          score: Math.max(0, state.score - mode.hints.penaltyPoints),
          lastResult: { type: "hint", countryId: currentCountry.id, message: `${hint.title}: ${hint.message}` },
        };
        events.push({ type: "HINT_REVEALED", countryId: currentCountry.id, hint });
        return events;
      }

      if (command.type === "SKIP_ROUND") {
        if (!mode.allowSkip) return events;
        const skippedCountryIds = new Set(state.skippedCountryIds);
        skippedCountryIds.add(currentCountry.id);
        const queue = { remainingCountryIds: [...state.queue.remainingCountryIds, currentCountry.id] };
        const advanced = advanceToNextCountry({ ...state, skippedCountryIds, queue }, command.now);
        state = {
          ...state,
          ...advanced,
          skippedCountryIds,
          streak: 0,
          lastResult: { type: "skipped", countryId: currentCountry.id, message: `Skipped ${currentCountry.name}.` },
        };
        events.push({ type: "ROUND_SKIPPED", previousCountryId: currentCountry.id, nextCountryId: state.currentCountryId });
        completeIfNeeded(events, command.now);
        return events;
      }

      if (command.type !== "SUBMIT_GUESS") return events;

      if (acceptedByMode(currentCountry, command.value, mode, command.auto ?? false)) {
        const guessedCountryIds = new Set(state.guessedCountryIds);
        guessedCountryIds.add(currentCountry.id);
        const nextStreak = state.streak + 1;
        const scoreDelta = mode.scoreCorrectGuess({ state, answeredAt: command.now, countryId: currentCountry.id });
        const advanced = advanceToNextCountry({ ...state, guessedCountryIds }, command.now);
        state = {
          ...state,
          ...advanced,
          guessedCountryIds,
          attempts: state.attempts + 1,
          correctAnswers: state.correctAnswers + 1,
          streak: nextStreak,
          bestStreak: Math.max(state.bestStreak, nextStreak),
          score: state.score + scoreDelta.points,
          lastResult: { type: "correct", countryId: currentCountry.id, message: `Correct: ${currentCountry.name}.` },
        };
        events.push({ type: "GUESS_CORRECT", countryId: currentCountry.id, nextCountryId: state.currentCountryId, points: scoreDelta.points });
        completeIfNeeded(events, command.now);
        return events;
      }

      if (command.auto) return events;

      const wrongDelta = mode.scoreWrongGuess({ state, answeredAt: command.now, countryId: currentCountry.id });
      const wrongState: GameState = {
        ...state,
        attempts: state.attempts + 1,
        wrongAnswers: state.wrongAnswers + 1,
        streak: 0,
        score: Math.max(0, state.score + wrongDelta.points),
        lastResult: { type: "wrong", countryId: currentCountry.id, message: "Not quite. The flag is still live." },
      };
      state = mode.id === "streak" ? { ...wrongState, status: "complete", currentCountryId: null, endedAt: command.now } : wrongState;
      events.push({ type: "GUESS_WRONG", countryId: currentCountry.id });
      completeIfNeeded(events, command.now);
      return events;
    },
  };
}
