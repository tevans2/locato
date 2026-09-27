import { buildPromptSlots } from "../core/categories";
import type { CountryId, CountryIndex } from "../core/countries";
import type { GameState } from "../core/game";
import { DEFAULT_FLAG_POOL, normalizeFlagPool, type FlagPool } from "../core/flagPools";

/** The single browser-wide solo save used before per-mode saves. Migrated on first read. */
export const LEGACY_SOLO_SAVE_KEY = "locato:solo:v2";
/** Per-mode practice saves: `locato:solo:v3:<mode>` (flags runs add `@<flagPool>`). */
export const SOLO_SAVE_PREFIX = "locato:solo:v3:";

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

/**
 * Stable id for one practice run slot: the sorted prompt categories, plus the flag pool when the
 * run includes flags (a territories flags run is kept apart from the countries one).
 */
export function soloSaveId(categoryIds: readonly string[], flagPool?: FlagPool | null): string {
  const mode = [...new Set(categoryIds)].sort().join("+");
  return categoryIds.includes("flags") ? `${mode}@${normalizeFlagPool(flagPool ?? DEFAULT_FLAG_POOL)}` : mode;
}

export function soloSaveKey(categoryIds: readonly string[], flagPool?: FlagPool | null): string {
  return `${SOLO_SAVE_PREFIX}${soloSaveId(categoryIds, flagPool)}`;
}

function parseSoloSave(raw: string | null): SoloSave | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SoloSave>;
    return parsed.version === 2 && typeof parsed.seed === "string" && Array.isArray(parsed.categoryIds) ? (parsed as SoloSave) : null;
  } catch {
    return null;
  }
}

function saveKeyFor(save: SoloSave): string {
  return soloSaveKey(save.categoryIds, save.categoryIds.includes("flags") ? save.flagPool : undefined);
}

/** Move the old single save into its mode's slot (unless that slot already has a newer run). */
export function migrateLegacySoloSave(storage: Storage): void {
  const raw = storage.getItem(LEGACY_SOLO_SAVE_KEY);
  if (raw === null) return;
  const legacy = parseSoloSave(raw);
  if (legacy) {
    const key = saveKeyFor(legacy);
    const existing = parseSoloSave(storage.getItem(key));
    if (!existing || existing.updatedAt < legacy.updatedAt) storage.setItem(key, raw);
  }
  storage.removeItem(LEGACY_SOLO_SAVE_KEY);
}

export function saveSoloGame(storage: Storage, index: CountryIndex, state: GameState, updatedAt = Date.now(), flagPool: FlagPool = DEFAULT_FLAG_POOL): void {
  const save = createSoloSave(index, state, updatedAt, flagPool);
  storage.setItem(saveKeyFor(save), JSON.stringify(save));
}

/**
 * Save the run in progress — practice runs only. Timed runs are deliberately never saved: the
 * clock is wall time so they can't be resumed honestly, and they must not overwrite (or, on
 * restart, clear) the mode's practice run. Leaving a timed run asks first instead.
 */
export function persistSoloRun(storage: Storage, index: CountryIndex, state: GameState, run: "practice" | "timed", updatedAt = Date.now(), flagPool: FlagPool = DEFAULT_FLAG_POOL): void {
  if (run === "timed") return;
  saveSoloGame(storage, index, state, updatedAt, flagPool);
}

/** Restart: clears the mode's practice save; a timed restart leaves it alone. */
export function clearSoloRun(storage: Storage, categoryIds: readonly string[], run: "practice" | "timed", flagPool?: FlagPool | null): void {
  if (run === "timed") return;
  clearSoloSave(storage, categoryIds, flagPool);
}

/** Clear one mode's practice run (Restart). Other modes keep their saves. */
export function clearSoloSave(storage: Storage, categoryIds: readonly string[], flagPool?: FlagPool | null): void {
  migrateLegacySoloSave(storage);
  storage.removeItem(soloSaveKey(categoryIds, flagPool));
}

function allSoloSaves(storage: Storage): SoloSave[] {
  migrateLegacySoloSave(storage);
  const saves: SoloSave[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key?.startsWith(SOLO_SAVE_PREFIX)) continue;
    const save = parseSoloSave(storage.getItem(key));
    if (save) saves.push(save);
  }
  return saves.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function isSoloSaveResumable(save: SoloSave): boolean {
  return (save.status ?? (save.currentCountryCode === null ? "complete" : "playing")) !== "complete";
}

/**
 * The saved run for one mode. For a flags run with no pool given, the most recently played flag
 * pool's run is returned.
 */
export function readSoloSave(storage: Storage, categoryIds: readonly string[], flagPool?: FlagPool | null): SoloSave | null {
  migrateLegacySoloSave(storage);
  if (!categoryIds.includes("flags") || (flagPool !== undefined && flagPool !== null)) {
    return parseSoloSave(storage.getItem(soloSaveKey(categoryIds, flagPool)));
  }
  const id = soloSaveId(categoryIds);
  const mode = id.slice(0, id.lastIndexOf("@"));
  return allSoloSaves(storage).find((save) => soloSaveId(save.categoryIds, save.flagPool).startsWith(`${mode}@`)) ?? null;
}

/** The most recently played practice run that can still be resumed (landing "Resume"). */
export function readLatestSoloSave(storage: Storage): SoloSave | null {
  return allSoloSaves(storage).find(isSoloSaveResumable) ?? null;
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
