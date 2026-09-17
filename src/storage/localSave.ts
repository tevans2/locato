import { buildPromptSlots } from "../core/categories";
import type { CountryId, CountryIndex } from "../core/countries";
import type { GameState } from "../core/game";
import { DEFAULT_FLAG_POOL, type FlagPool } from "../core/flagPools";

export const SOLO_SAVE_KEY = "locato:solo:v2";

export interface SoloSave {
  readonly version: 2;
  readonly status?: GameState["status"];
  readonly categoryIds: readonly string[];
  readonly flagPool?: FlagPool;
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

export function createSoloSave(index: CountryIndex, state: GameState, updatedAt: number, flagPool: FlagPool = DEFAULT_FLAG_POOL): SoloSave {
  const currentCountry = state.currentCountryId === null ? null : index.byId[state.currentCountryId] ?? null;

  return {
    status: state.status,
    version: 2,
    categoryIds: [...state.categoryIds],
    flagPool,
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
    roundNumber: state.roundNumber,
    startedAt: state.startedAt ?? updatedAt,
    updatedAt,
  };
}

export function saveSoloGame(storage: Storage, index: CountryIndex, state: GameState, updatedAt = Date.now(), flagPool: FlagPool = DEFAULT_FLAG_POOL): void {
  storage.setItem(SOLO_SAVE_KEY, JSON.stringify(createSoloSave(index, state, updatedAt, flagPool)));
}

export function clearSoloSave(storage: Storage): void {
  storage.removeItem(SOLO_SAVE_KEY);
}

export function readSoloSave(storage: Storage): SoloSave | null {
  const raw = storage.getItem(SOLO_SAVE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SoloSave>;
    return parsed.version === 2 && typeof parsed.seed === "string" && Array.isArray(parsed.categoryIds) ? (parsed as SoloSave) : null;
  } catch {
    return null;
  }
}

export function hydrateGameState(index: CountryIndex, save: SoloSave): GameState | null {
  const currentCountryId = save.currentCountryCode ? index.byCode.get(save.currentCountryCode)?.id ?? null : null;
  const guessedCountryIds = new Set(idsFromCodes(index, save.guessedCountryCodes));
  const skippedCountryIds = new Set(idsFromCodes(index, save.skippedCountryCodes));
  const poolCountryIds = idsFromCodes(index, save.poolCountryCodes);
  const queueCountryIds = idsFromCodes(index, save.queueCountryCodes);

  if (poolCountryIds.length === 0) return null;

  // Category-per-country is deterministic from (categoryIds, seed), so recompute it rather than persist it.
  const assignments = new Map(buildPromptSlots(index, save.categoryIds, save.seed).map((slot) => [slot.countryId, slot.categoryId]));
  const status = save.status === "idle" ? "playing" : save.status ?? (currentCountryId === null ? "complete" : "playing");

  return {
    status,
    categoryIds: [...save.categoryIds],
    seed: save.seed,
    currentCountryId,
    currentCategoryId: currentCountryId === null ? null : assignments.get(currentCountryId) ?? null,
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
    startedAt: save.startedAt,
    endedAt: currentCountryId === null ? save.updatedAt : null,
    lastResult: null,
    queue: queueCountryIds.length > 0 ? { remainingCountryIds: queueCountryIds } : { remainingCountryIds: [] },
    poolCountryIds,
  };
}
