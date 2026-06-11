import { buildPromptSlots } from "./categories";
import type { CountryId, CountryIndex } from "./countries";
import { createSeededRandom, shuffle } from "./game";

export const DAILY_COUNTRY_COUNT = 10;
export const DAILY_CATEGORY_IDS = ["flags", "shapes", "capitals"] as const;

export type DailyRoundMark = "correct" | "hint" | "miss";

export interface DailyChallenge {
  readonly date: string;
  readonly seed: string;
  readonly categoryIds: readonly string[];
  readonly countryIds: readonly CountryId[];
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
  const countryIds = shuffle(eligibleCountryIds, createSeededRandom(`${seed}:countries`)).slice(0, DAILY_COUNTRY_COUNT);

  return {
    date,
    seed,
    categoryIds: DAILY_CATEGORY_IDS,
    countryIds,
  };
}

export function formatDailyTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function createDailyShareText(date: string, score: number, timeMs: number, marks: readonly DailyRoundMark[]): string {
  const grid = marks.map((mark) => (mark === "correct" ? "🟩" : mark === "hint" ? "🟨" : "🟥")).join("");

  return `Locato Daily ${date}
Score: ${score}/${DAILY_COUNTRY_COUNT}
Time: ${formatDailyTime(timeMs)}
${grid}`;
}
