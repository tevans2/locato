import type { Continent, Country, CountryId } from "../countries";
import type { GameState } from "../game/types";

export interface ModeOptions {
  readonly continent?: Continent;
  readonly durationSeconds?: number;
  readonly lives?: number;
}

export interface ScoreInput {
  readonly state: GameState;
  readonly answeredAt: number;
  readonly countryId: CountryId;
}

export interface ScoreDelta {
  readonly points: number;
}

export interface HintPolicy {
  readonly enabled: boolean;
  readonly penaltyPoints: number;
}

export interface GameMode {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly durationSeconds?: number;
  readonly allowSkip: boolean;
  readonly acceptCountryCodes: boolean;
  readonly acceptAliases: boolean;
  readonly hints: HintPolicy;
  readonly createCountryPool: (countries: readonly Country[], options?: ModeOptions) => readonly CountryId[];
  readonly scoreCorrectGuess: (input: ScoreInput) => ScoreDelta;
  readonly scoreWrongGuess: (input: ScoreInput) => ScoreDelta;
  readonly isComplete: (state: GameState, countryCount: number) => boolean;
}
