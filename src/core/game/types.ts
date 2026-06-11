import type { CountryId, CountryIndex } from "../countries";

export interface Hint {
  readonly title: string;
  readonly message: string;
  readonly level: number;
}

export interface GuessResult {
  readonly type: "correct" | "wrong" | "skipped" | "hint" | "revealed" | "complete";
  readonly countryId: CountryId | null;
  readonly message: string;
}

export interface RoundQueue {
  readonly remainingCountryIds: readonly CountryId[];
}

export interface GameState {
  readonly status: "idle" | "playing" | "complete";
  readonly categoryIds: readonly string[];
  readonly seed: string;
  readonly currentCountryId: CountryId | null;
  readonly currentCategoryId: string | null;
  readonly roundNumber: number;
  readonly guessedCountryIds: ReadonlySet<CountryId>;
  readonly skippedCountryIds: ReadonlySet<CountryId>;
  readonly attempts: number;
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly streak: number;
  readonly bestStreak: number;
  readonly score: number;
  readonly hintLevel: number;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly lastResult: GuessResult | null;
  readonly queue: RoundQueue;
  readonly poolCountryIds: readonly CountryId[];
}

export interface CreateGameEngineInput {
  readonly countryIndex: CountryIndex;
  readonly categoryIds: readonly string[];
  readonly seed: string;
  readonly now?: number;
  readonly poolCountryIds?: readonly CountryId[];
  readonly initialState?: GameState;
}

export interface GameEngine {
  readonly getState: () => GameState;
  readonly dispatch: (command: GameCommand) => readonly GameEvent[];
}

export type GameCommand =
  | { readonly type: "START_GAME"; readonly seed: string; readonly categoryIds: readonly string[]; readonly now: number }
  | { readonly type: "SUBMIT_GUESS"; readonly value: string; readonly now: number; readonly auto?: boolean }
  | { readonly type: "REQUEST_HINT"; readonly now: number }
  | { readonly type: "SKIP_ROUND"; readonly now: number }
  | { readonly type: "RESET_GAME"; readonly now: number }
  | { readonly type: "REVEAL_ANSWER"; readonly now: number }
  | { readonly type: "TICK"; readonly now: number };

export type GameEvent =
  | { readonly type: "GAME_STARTED"; readonly currentCountryId: CountryId }
  | { readonly type: "GUESS_CORRECT"; readonly countryId: CountryId; readonly nextCountryId: CountryId | null; readonly points: number }
  | { readonly type: "GUESS_WRONG"; readonly countryId: CountryId }
  | { readonly type: "ROUND_SKIPPED"; readonly previousCountryId: CountryId; readonly nextCountryId: CountryId | null }
  | { readonly type: "HINT_REVEALED"; readonly countryId: CountryId; readonly hint: Hint }
  | { readonly type: "GAME_COMPLETED" }
  | { readonly type: "GAME_RESET" }
  | { readonly type: "ANSWER_REVEALED"; readonly countryId: CountryId; readonly nextCountryId: CountryId | null };

export interface GameStats {
  readonly totalCountries: number;
  readonly guessedCount: number;
  readonly remainingCount: number;
  readonly accuracy: number;
  readonly progress: number;
}
