import { buildPromptSlots, getCategory, type PromptSlot } from "./categories";
import type { CountryId, CountryIndex } from "./countries";
import { fameTier, type FameTier } from "./countries/fame";
import { dailyThemeForDate, type DailyTheme } from "./dailyThemes";
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
export const DAILY_FORMAT = [
  { label: "Flags", rounds: "1–2", icon: "flag" },
  { label: "Capitals", rounds: "3–4", icon: "crown" },
  { label: "Country shapes", rounds: "5–6", icon: "shapes" },
  { label: "Country locations", rounds: "7–8", icon: "map-pin" },
  { label: "Map Tap", rounds: "9", icon: "globe" },
  { label: "Street View", rounds: "10", icon: "binoculars" },
] as const;

export interface DailyRoundResult {
  readonly categoryId: string;
  readonly countryCode?: string;
  readonly targetId?: string;
  readonly points: number;
  readonly hintsUsed: number;
  readonly wrongGuesses: number;
  readonly missed: boolean;
  readonly distanceKm?: number;
}

/** Validate persisted and API review details with the same bounded schema. */
export function parseDailyRoundResults(value: unknown): readonly DailyRoundResult[] | null {
  if (!Array.isArray(value) || value.length > DAILY_COUNTRY_COUNT) return null;
  const results: DailyRoundResult[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const r = item as DailyRoundResult;
    if (![...DAILY_CATEGORY_IDS, "map-tap", "streetview-country"].includes(r.categoryId) ||
      !Number.isInteger(r.points) || r.points < 0 || r.points > DAILY_POINTS_PER_ROUND ||
      !Number.isInteger(r.hintsUsed) || r.hintsUsed < 0 || r.hintsUsed > 1000 ||
      !Number.isInteger(r.wrongGuesses) || r.wrongGuesses < 0 || r.wrongGuesses > 1_000_000 ||
      typeof r.missed !== "boolean" || (r.missed && r.points !== 0)) return null;
    if (r.categoryId === "map-tap") {
      if (typeof r.targetId !== "string" || !MAP_TAP_LOCATIONS.some((location) => location.id === r.targetId) ||
        (r.distanceKm !== undefined && (!Number.isFinite(r.distanceKm) || r.distanceKm < 0 || r.distanceKm > 21_000))) return null;
    } else if (typeof r.countryCode !== "string" || !/^[A-Z]{2}$/.test(r.countryCode)) return null;
    results.push({ categoryId: r.categoryId, points: r.points, hintsUsed: r.hintsUsed, wrongGuesses: r.wrongGuesses, missed: r.missed,
      ...(r.categoryId === "map-tap" ? { targetId: r.targetId!, ...(r.distanceKm !== undefined ? { distanceKm: r.distanceKm } : {}) } : { countryCode: r.countryCode! }) });
  }
  return results;
}

export type DailyRoundMark = "correct" | "hint" | "miss";

export interface DailyChallenge {
  readonly date: string;
  readonly seed: string;
  readonly categoryIds: readonly string[];
  readonly countryIds: readonly CountryId[];
  readonly mapTapTargetId: string;
  readonly streetViewCountryCode: string;
  readonly promptSlots?: readonly PromptSlot[];
  readonly theme?: DailyTheme;
  readonly challengeVersion?: 2;
  readonly themeScoped?: true;
}

export function getLocalDailyDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createLegacyDailyChallenge(index: CountryIndex, date: string): DailyChallenge {
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

export function createDailyChallenge(index: CountryIndex, date = getLocalDailyDate()): DailyChallenge {
  return buildThemedDailyChallenge(index, date, true);
}

/** Preserve the questions of attempts started before every round followed its theme. */
export function createMixedThemeDailyChallenge(index: CountryIndex, date: string): DailyChallenge {
  return buildThemedDailyChallenge(index, date, false);
}

/** Server callers supply a private seed; the public date must not reveal the ranked queue. */
export function createServerDailyChallenge(index: CountryIndex, date: string, seed: string): DailyChallenge {
  return buildThemedDailyChallenge(index, date, true, seed);
}

function buildThemedDailyChallenge(index: CountryIndex, date: string, themeScoped: boolean, seed = `daily:${date}`): DailyChallenge {
  const theme = dailyThemeForDate(date);
  const categories = ["flags", "flags", "capitals", "capitals", "shapes", "shapes", "pick-country", "spot-country"];
  const tiers: readonly FameTier[] = [1, 1, 2, 2, 1, 3, 2, 3];
  const used = new Set<CountryId>();
  const candidates = shuffle(index.countries.filter((country) => !country.allowedCategoryIds &&
    (!themeScoped || theme.countryCodes.includes(country.code))), createSeededRandom(`${seed}:balanced`));
  const promptSlots: PromptSlot[] = [];
  categories.forEach((categoryId, position) => {
    const eligible = candidates.filter((country) => !used.has(country.id) && getCategory(categoryId)?.eligible(country));
    const tier = eligible.filter((country) => fameTier(country.code) === tiers[position]);
    const themed = !themeScoped && position % 2 === 0;
    const country = (themed ? tier.find((country) => theme.countryCodes.includes(country.code)) : undefined) ?? tier[0] ?? eligible[0];
    if (country) {
      used.add(country.id);
      promptSlots.push({ countryId: country.id, categoryId });
    }
  });
  const themedLocations = MAP_TAP_LOCATIONS.filter((location) => theme.mapTapTargetIds.includes(location.id));
  const approachableLocations = themedLocations.filter((location) => location.difficulty !== "hard");
  const mapTapTargetId = shuffle(approachableLocations.length ? approachableLocations : themedLocations, createSeededRandom(`${seed}:maptap`))[0]?.id ?? MAP_TAP_LOCATIONS[0]!.id;
  const streetRounds = streetViewCountryRounds.filter((round) => index.byCode.has(round.countryCode));
  const themedStreetRounds = streetRounds.filter((round) => theme.countryCodes.includes(round.countryCode));
  const mediumStreetRounds = themedStreetRounds.filter((round) => fameTier(round.countryCode) === 2);
  const streetSource = mediumStreetRounds.length ? mediumStreetRounds : themedStreetRounds.length ? themedStreetRounds
    : themeScoped ? streetViewCountryRounds.filter((round) => theme.countryCodes.includes(round.countryCode))
    : streetRounds.length ? streetRounds : streetViewCountryRounds;
  const streetViewCountryCode = shuffle(streetSource, createSeededRandom(`${seed}:streetview`))[0]?.countryCode ?? "";
  return { date, seed, categoryIds: DAILY_CATEGORY_IDS, countryIds: promptSlots.map((slot) => slot.countryId), promptSlots, theme, challengeVersion: 2,
    ...(themeScoped ? { themeScoped: true } : {}), mapTapTargetId, streetViewCountryCode };
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
