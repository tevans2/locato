import type { CountryId, CountryIndex } from "../core/countries";
import type { GameState } from "../core/game";
import type { GameMode } from "../core/modes";
import { createRoundQueue } from "../core/game/roundQueue";

export const SOLO_SAVE_KEY = "locale:solo:v1";

export interface SoloSaveV1 {
  readonly version: 1;
  readonly modeId: string;
  readonly seed: string;
  readonly currentCountryCode: string | null;
  readonly queueCountryCodes: readonly string[];
  readonly poolCountryCodes: readonly string[];
  readonly guessedCountryCodes: readonly string[];
  readonly skippedCountryCodes: readonly string[];
  readonly attempts: number;
  readonly correctAnswers: number;
  readonly wrongAnswers: number;
  readonly streak: number;
  readonly bestStreak: number;
  readonly score: number;
  readonly timeLimitSeconds?: number | null;
  readonly roundNumber: number;
  readonly startedAt: number;
  readonly updatedAt: number;
}

function codesFromIds(index: CountryIndex, countryIds: Iterable<CountryId>): string[] {
  const codes: string[] = [];
  for (const countryId of countryIds) {
    const country = index.byId[countryId];
    if (country) codes.push(country.code);
  }
  return codes;
}

function idsFromCodes(index: CountryIndex, countryCodes: readonly string[]): CountryId[] {
  const ids: CountryId[] = [];
  for (const code of countryCodes) {
    const country = index.byCode.get(code.toUpperCase());
    if (country) ids.push(country.id);
  }
  return ids;
}

export function createSoloSave(index: CountryIndex, state: GameState, updatedAt: number): SoloSaveV1 {
  const currentCountry = state.currentCountryId === null ? null : index.byId[state.currentCountryId] ?? null;

  return {
    version: 1,
    modeId: state.modeId,
    seed: state.seed,
    currentCountryCode: currentCountry?.code ?? null,
    queueCountryCodes: codesFromIds(index, state.queue.remainingCountryIds),
    poolCountryCodes: codesFromIds(index, state.poolCountryIds),
    guessedCountryCodes: codesFromIds(index, state.guessedCountryIds),
    skippedCountryCodes: codesFromIds(index, state.skippedCountryIds),
    attempts: state.attempts,
    correctAnswers: state.correctAnswers,
    wrongAnswers: state.wrongAnswers,
    streak: state.streak,
    bestStreak: state.bestStreak,
    score: state.score,
    timeLimitSeconds: state.timeLimitSeconds,
    roundNumber: state.roundNumber,
    startedAt: state.startedAt ?? updatedAt,
    updatedAt,
  };
}

export function saveSoloGame(storage: Storage, index: CountryIndex, state: GameState, updatedAt = Date.now()): void {
  storage.setItem(SOLO_SAVE_KEY, JSON.stringify(createSoloSave(index, state, updatedAt)));
}

export function clearSoloSave(storage: Storage): void {
  storage.removeItem(SOLO_SAVE_KEY);
}

export function readSoloSave(storage: Storage): SoloSaveV1 | null {
  const raw = storage.getItem(SOLO_SAVE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SoloSaveV1>;
    return parsed.version === 1 && typeof parsed.seed === "string" && typeof parsed.modeId === "string" ? (parsed as SoloSaveV1) : null;
  } catch {
    return null;
  }
}

export function hydrateGameState(index: CountryIndex, mode: GameMode, save: SoloSaveV1): GameState | null {
  const currentCountryId = save.currentCountryCode ? index.byCode.get(save.currentCountryCode)?.id ?? null : null;
  const guessedCountryIds = new Set(idsFromCodes(index, save.guessedCountryCodes));
  const skippedCountryIds = new Set(idsFromCodes(index, save.skippedCountryCodes));
  const poolCountryIds = idsFromCodes(index, save.poolCountryCodes);
  const queueCountryIds = idsFromCodes(index, save.queueCountryCodes);

  if (poolCountryIds.length === 0) return null;
  const timeLimitSeconds = save.timeLimitSeconds ?? mode.durationSeconds ?? null;
  const timeRemainingMs = timeLimitSeconds === null ? null : Math.max(0, timeLimitSeconds * 1000 - (Date.now() - save.startedAt));


  return {
    status: currentCountryId === null || timeRemainingMs === 0 ? "complete" : "playing",
    modeId: mode.id,
    seed: save.seed,
    currentCountryId,
    roundNumber: save.roundNumber,
    guessedCountryIds,
    skippedCountryIds,
    attempts: save.attempts,
    correctAnswers: save.correctAnswers,
    wrongAnswers: save.wrongAnswers,
    streak: save.streak,
    bestStreak: save.bestStreak,
    score: save.score,
    hintLevel: 0,
    timeLimitSeconds,
    timeRemainingMs,
    startedAt: save.startedAt,
    endedAt: currentCountryId === null || timeRemainingMs === 0 ? save.updatedAt : null,
    lastResult: null,
    queue: queueCountryIds.length > 0 ? { remainingCountryIds: queueCountryIds } : createRoundQueue([], save.seed),
    poolCountryIds,
  };
}
