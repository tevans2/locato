import { buildPromptSlots } from "./categories";
import type { CountryId, CountryIndex } from "./countries";
import { createSeededRandom, shuffle } from "./game";
import { MAP_TAP_LOCATIONS } from "./maptap/locations";
import { streetViewCountryRounds } from "./streetview";

export const DAILY_PROMPT_COUNTRY_COUNT = 8;
export const DAILY_MAP_TAP_ROUND_COUNT = 1;
export const DAILY_STREET_VIEW_ROUND_COUNT = 1;
export const DAILY_COUNTRY_COUNT = DAILY_PROMPT_COUNTRY_COUNT + DAILY_MAP_TAP_ROUND_COUNT + DAILY_STREET_VIEW_ROUND_COUNT;
export const DAILY_MAX_SCORE = 100;
export const DAILY_POINTS_PER_ROUND = DAILY_MAX_SCORE / DAILY_COUNTRY_COUNT;
export const DAILY_HINT_PENALTY = 3;
export const DAILY_WRONG_GUESS_PENALTY = 2;
export const DAILY_CATEGORY_IDS = ["flags", "shapes", "capitals", "pick-country", "spot-country"] as const;

export type DailyRoundMark = "correct" | "hint" | "miss";

export interface DailyChallenge {
  readonly date: string;
  readonly seed: string;
  readonly categoryIds: readonly string[];
  readonly countryIds: readonly CountryId[];
  readonly mapTapTargetId: string;
  readonly streetViewCountryCode: string;
}

export function getLocalDailyDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createDailyChallenge(index: CountryIndex, date = getLocalDailyDate()): DailyChallenge {
  const seed = `daily:${date}`;
  const eligibleCountryIds = buildPromptSlots(index, DAILY_CATEGORY_IDS, seed).map((slot) => slot.countryId);
  const countryIds = shuffle(eligibleCountryIds, createSeededRandom(`${seed}:countries`)).slice(0, DAILY_PROMPT_COUNTRY_COUNT);
  const mapTapTargetId = shuffle(MAP_TAP_LOCATIONS, createSeededRandom(`${seed}:maptap`))[0]?.id ?? "";
  const eligibleStreetViewRounds = streetViewCountryRounds.filter((round) => index.byCode.has(round.countryCode));
  const streetViewSource = eligibleStreetViewRounds.length > 0 ? eligibleStreetViewRounds : streetViewCountryRounds;
  const streetViewCountryCode = shuffle(streetViewSource, createSeededRandom(`${seed}:streetview`))[0]?.countryCode ?? "";

  return {
    date,
    seed,
    categoryIds: DAILY_CATEGORY_IDS,
    countryIds,
    mapTapTargetId,
    streetViewCountryCode,
  };
}

export function formatDailyTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function scoreDailyRound(hintsUsed: number, missed = false, wrongGuesses = 0): number {
  if (missed) return 0;
  const penalty = Math.max(0, hintsUsed) * DAILY_HINT_PENALTY + Math.max(0, wrongGuesses) * DAILY_WRONG_GUESS_PENALTY;
  return Math.max(0, Math.round(DAILY_POINTS_PER_ROUND - penalty));
}

export function scoreDailyMapTapRound(score: number, maxScore: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return 0;
  return Math.max(0, Math.min(DAILY_POINTS_PER_ROUND, Math.round((score / maxScore) * DAILY_POINTS_PER_ROUND)));
}

export function createDailyShareText(date: string, score: number, timeMs: number, marks: readonly DailyRoundMark[]): string {
  const grid = marks.map((mark) => (mark === "correct" ? "🟩" : mark === "hint" ? "🟨" : "🟥")).join("");

  return `Locato Daily ${date}
Score: ${score}/${DAILY_MAX_SCORE}
Time: ${formatDailyTime(timeMs)}
${grid}`;
}
