import type { Continent, CountryId, CountryIndex } from "../core/countries";
import type { GameModeId, WorldMapGameModeId } from "../core/gameModes";

const STORAGE_KEY = "locato.achievements.v1";

export interface Achievement {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export interface AchievementState {
  readonly unlockedIds: readonly string[];
  readonly dailyDates: readonly string[];
  readonly bestDailyStreak: number;
  readonly completedWorldModes: readonly string[];
  readonly completedPuzzleContinents: readonly string[];
  readonly completedWorldContinents: readonly string[];
  readonly completedLandlockedCountryCodes: readonly string[];
  readonly completedNoHintSoloContinents: readonly string[];
}

interface MutableAchievementState {
  unlockedIds: string[];
  dailyDates: string[];
  bestDailyStreak: number;
  completedWorldModes: string[];
  completedPuzzleContinents: string[];
  completedWorldContinents: string[];
  completedLandlockedCountryCodes: string[];
  completedNoHintSoloContinents: string[];
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "daily-first", title: "Daily foothold", description: "Complete a Daily Challenge." },
  { id: "daily-streak-3", title: "Three-day trail", description: "Complete three Daily Challenges in a row." },
  { id: "daily-streak-7", title: "Week on the map", description: "Complete seven Daily Challenges in a row." },
  { id: "solo-perfect", title: "Clean passport", description: "Complete a solo prompt run without a wrong answer." },
  { id: "solo-streak-25", title: "Hot hand", description: "Reach a 25-answer solo streak." },
  { id: "world-first", title: "World tour", description: "Complete any world-map mode." },
  { id: "world-all-modes", title: "Map generalist", description: "Complete Name, Click, and Spot world-map modes." },
  { id: "puzzle-first", title: "Cartographer", description: "Complete a continent puzzle." },
  { id: "puzzle-accurate", title: "Steady hands", description: "Score at least 75% on a continent puzzle." },
  { id: "puzzle-all-continents", title: "Continental drift", description: "Complete every continent puzzle." },
  { id: "solo-no-hints", title: "Compass memory", description: "Complete a solo prompt run without using a hint." },
  { id: "solo-africa-clean", title: "Africa clean sweep", description: "Answer every African country in a solo run without hints or misses." },
  { id: "solo-south-america-clean", title: "Andes to Atlantic", description: "Answer every South American country in a solo run without hints or misses." },
  { id: "solo-oceania-clean", title: "Pacific memory", description: "Answer every Oceanian country in a solo run without hints or misses." },
  { id: "world-africa-complete", title: "Africa filled in", description: "Reveal every African country in a world-map mode." },
  { id: "world-south-america-complete", title: "South America filled in", description: "Reveal every South American country in a world-map mode." },
  { id: "world-oceania-complete", title: "Oceania filled in", description: "Reveal every Oceanian country in a world-map mode." },
  { id: "world-landlocked-25", title: "Inland specialist", description: "Reveal 25 landlocked countries in world-map modes." },
  { id: "world-landlocked-all", title: "No coast, no problem", description: "Reveal every landlocked country in world-map modes." },
];

const WORLD_COMPLETION_MODES: readonly WorldMapGameModeId[] = ["name-all", "click-country", "spot-country"];
const PUZZLE_CONTINENTS: readonly Continent[] = ["Africa", "Asia", "Europe", "North America", "Oceania", "South America"];
const CLEAN_SOLO_CONTINENT_ACHIEVEMENTS: Readonly<Record<Continent, string | null>> = {
  Africa: "solo-africa-clean",
  Asia: null,
  Europe: null,
  "North America": null,
  Oceania: "solo-oceania-clean",
  "South America": "solo-south-america-clean",
};
const WORLD_CONTINENT_ACHIEVEMENTS: Readonly<Record<Continent, string | null>> = {
  Africa: "world-africa-complete",
  Asia: null,
  Europe: null,
  "North America": null,
  Oceania: "world-oceania-complete",
  "South America": "world-south-america-complete",
};
const LANDLOCKED_COUNTRY_CODES = new Set([
  "AF", "AD", "AM", "AT", "AZ", "BY", "BT", "BO", "BW", "BF", "BI", "CF", "TD", "CZ", "SZ", "ET",
  "HU", "KZ", "KG", "LA", "LS", "LI", "LU", "MW", "ML", "MD", "MN", "NP", "NE", "MK", "PY", "RW",
  "SM", "RS", "SK", "SS", "CH", "TJ", "TM", "UG", "UZ", "ZM", "ZW", "VA",
]);

function emptyState(): MutableAchievementState {
  return {
    unlockedIds: [],
    dailyDates: [],
    bestDailyStreak: 0,
    completedWorldModes: [],
    completedPuzzleContinents: [],
    completedWorldContinents: [],
    completedLandlockedCountryCodes: [],
    completedNoHintSoloContinents: [],
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function readState(storage: Storage): MutableAchievementState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<AchievementState>;
    return {
      unlockedIds: unique(Array.isArray(parsed.unlockedIds) ? parsed.unlockedIds.filter((value): value is string => typeof value === "string") : []),
      dailyDates: unique(Array.isArray(parsed.dailyDates) ? parsed.dailyDates.filter((value): value is string => typeof value === "string") : []).sort(),
      bestDailyStreak: typeof parsed.bestDailyStreak === "number" && Number.isFinite(parsed.bestDailyStreak) ? Math.max(0, Math.floor(parsed.bestDailyStreak)) : 0,
      completedWorldModes: unique(Array.isArray(parsed.completedWorldModes) ? parsed.completedWorldModes.filter((value): value is string => typeof value === "string") : []),
      completedPuzzleContinents: unique(Array.isArray(parsed.completedPuzzleContinents) ? parsed.completedPuzzleContinents.filter((value): value is string => typeof value === "string") : []),
      completedWorldContinents: unique(Array.isArray(parsed.completedWorldContinents) ? parsed.completedWorldContinents.filter((value): value is string => typeof value === "string") : []),
      completedLandlockedCountryCodes: unique(Array.isArray(parsed.completedLandlockedCountryCodes) ? parsed.completedLandlockedCountryCodes.filter((value): value is string => typeof value === "string") : []),
      completedNoHintSoloContinents: unique(Array.isArray(parsed.completedNoHintSoloContinents) ? parsed.completedNoHintSoloContinents.filter((value): value is string => typeof value === "string") : []),
    };
  } catch {
    return emptyState();
  }
}

function writeState(storage: Storage, state: MutableAchievementState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function dateKeyToUtcDay(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000;
}

function dailyStreakEndingAt(dates: readonly string[], dateKey: string): number {
  const days = new Set(dates.map(dateKeyToUtcDay).filter((day): day is number => day !== null));
  const today = dateKeyToUtcDay(dateKey);
  if (today === null || !days.has(today)) return 0;

  let streak = 0;
  for (let day = today; days.has(day); day -= 1) streak += 1;
  return streak;
}

function unlock(state: MutableAchievementState, unlocked: Achievement[], id: string): void {
  if (state.unlockedIds.includes(id)) return;
  const achievement = ACHIEVEMENTS.find((candidate) => candidate.id === id);
  if (!achievement) return;
  state.unlockedIds.push(id);
  unlocked.push(achievement);
}

export function getAchievementState(storage: Storage): AchievementState {
  return readState(storage);
}

export function getUnlockedAchievements(storage: Storage): readonly Achievement[] {
  const state = readState(storage);
  const unlocked = new Set(state.unlockedIds);
  return ACHIEVEMENTS.filter((achievement) => unlocked.has(achievement.id));
}

export function recordDailyAchievement(storage: Storage, dateKey: string): { readonly streak: number; readonly unlocked: readonly Achievement[] } {
  const state = readState(storage);
  const unlocked: Achievement[] = [];
  if (!state.dailyDates.includes(dateKey)) state.dailyDates.push(dateKey);
  state.dailyDates = unique(state.dailyDates).sort();

  const streak = dailyStreakEndingAt(state.dailyDates, dateKey);
  state.bestDailyStreak = Math.max(state.bestDailyStreak, streak);
  unlock(state, unlocked, "daily-first");
  if (streak >= 3) unlock(state, unlocked, "daily-streak-3");
  if (streak >= 7) unlock(state, unlocked, "daily-streak-7");

  writeState(storage, state);
  return { streak, unlocked };
}

function countryIdsForContinent(countryIndex: CountryIndex, continent: Continent): readonly CountryId[] {
  return countryIndex.countries.filter((country) => country.continent === continent).map((country) => country.id);
}

function countryCodesForIds(countryIndex: CountryIndex, countryIds: ReadonlySet<CountryId>): readonly string[] {
  return countryIndex.countries.filter((country) => countryIds.has(country.id)).map((country) => country.code);
}

export function recordSoloAchievements(
  storage: Storage,
  input: {
    readonly completed: boolean;
    readonly wrongAnswers: number;
    readonly bestStreak: number;
    readonly gameMode: GameModeId;
    readonly hintsUsed?: number;
    readonly countryIndex?: CountryIndex;
    readonly guessedCountryIds?: ReadonlySet<CountryId>;
  },
): readonly Achievement[] {
  const state = readState(storage);
  const unlocked: Achievement[] = [];
  if (input.completed && input.wrongAnswers === 0) unlock(state, unlocked, "solo-perfect");
  if (input.bestStreak >= 25) unlock(state, unlocked, "solo-streak-25");
  if (input.completed && (input.hintsUsed ?? 0) === 0) unlock(state, unlocked, "solo-no-hints");

  if (input.completed && input.wrongAnswers === 0 && (input.hintsUsed ?? 0) === 0 && input.countryIndex && input.guessedCountryIds) {
    for (const continent of PUZZLE_CONTINENTS) {
      const achievementId = CLEAN_SOLO_CONTINENT_ACHIEVEMENTS[continent];
      if (!achievementId || state.completedNoHintSoloContinents.includes(continent)) continue;
      const countryIds = countryIdsForContinent(input.countryIndex, continent);
      if (countryIds.length > 0 && countryIds.every((countryId) => input.guessedCountryIds?.has(countryId))) {
        state.completedNoHintSoloContinents.push(continent);
        unlock(state, unlocked, achievementId);
      }
    }
  }
  writeState(storage, state);
  return unlocked;
}

export function recordWorldAchievements(
  storage: Storage,
  input: {
    readonly playMode: WorldMapGameModeId;
    readonly completed: boolean;
    readonly puzzleContinent?: Continent;
    readonly puzzleAccuracyPercent?: number | null;
    readonly countryIndex?: CountryIndex;
    readonly guessedCountryIds?: ReadonlySet<CountryId>;
  },
): readonly Achievement[] {
  const state = readState(storage);
  const unlocked: Achievement[] = [];

  if (input.completed && input.playMode === "puzzle") {
    unlock(state, unlocked, "puzzle-first");
    if (input.puzzleContinent && !state.completedPuzzleContinents.includes(input.puzzleContinent)) state.completedPuzzleContinents.push(input.puzzleContinent);
    if ((input.puzzleAccuracyPercent ?? 0) >= 75) unlock(state, unlocked, "puzzle-accurate");
    if (PUZZLE_CONTINENTS.every((continent) => state.completedPuzzleContinents.includes(continent))) unlock(state, unlocked, "puzzle-all-continents");
  } else if (input.completed) {
    unlock(state, unlocked, "world-first");
    if (!state.completedWorldModes.includes(input.playMode)) state.completedWorldModes.push(input.playMode);
    if (WORLD_COMPLETION_MODES.every((mode) => state.completedWorldModes.includes(mode))) unlock(state, unlocked, "world-all-modes");
  }

  if (input.playMode !== "puzzle" && input.countryIndex && input.guessedCountryIds) {
    for (const continent of PUZZLE_CONTINENTS) {
      const achievementId = WORLD_CONTINENT_ACHIEVEMENTS[continent];
      if (!achievementId || state.completedWorldContinents.includes(continent)) continue;
      const countryIds = countryIdsForContinent(input.countryIndex, continent);
      if (countryIds.length > 0 && countryIds.every((countryId) => input.guessedCountryIds?.has(countryId))) {
        state.completedWorldContinents.push(continent);
        unlock(state, unlocked, achievementId);
      }
    }

    const guessedLandlockedCodes = countryCodesForIds(input.countryIndex, input.guessedCountryIds).filter((code) => LANDLOCKED_COUNTRY_CODES.has(code));
    state.completedLandlockedCountryCodes = unique([...state.completedLandlockedCountryCodes, ...guessedLandlockedCodes]);
    if (state.completedLandlockedCountryCodes.length >= 25) unlock(state, unlocked, "world-landlocked-25");
    if ([...LANDLOCKED_COUNTRY_CODES].every((code) => state.completedLandlockedCountryCodes.includes(code))) unlock(state, unlocked, "world-landlocked-all");
  }

  writeState(storage, state);
  return unlocked;
}
