import { DAILY_THEMES } from "../dailyThemes";
import { createSeededRandom, shuffle } from "../game";
import { streetViewCatalog, streetViewLocationKey } from "./catalog";
import type { StreetViewCountryRound } from "./rounds";

export const DAILY_STREET_VIEW_ROTATION_START = "2026-11-24";

const DAY_MS = 86_400_000;
const startDay = Date.parse(DAILY_STREET_VIEW_ROTATION_START) / DAY_MS;

const roundsByTheme = DAILY_THEMES.map((theme) => streetViewCatalog
  .filter((round) => theme.countryCodes.includes(round.countryCode))
  .map((round) => theme.id === "southern" ? { ...round, frames: round.frames.filter((frame) => frame.lat < 0) } : round)
  .filter((round) => round.frames.length >= 3));

/** Rebuild the rotation from its start date so reloads and different devices agree. */
export function dailyStreetViewRound(date: string, seed = "daily-streetview:v1"): StreetViewCountryRound | undefined {
  const targetDay = Date.parse(`${date}T00:00:00Z`) / DAY_MS;
  if (!Number.isFinite(targetDay) || targetDay < startDay) return undefined;

  const lastCountryDay = new Map<string, number>();
  const lastLocationDay = new Map<string, number>();
  for (let day = startDay; day <= targetDay; day++) {
    const random = createSeededRandom(`${seed}:${day}`);
    const candidates = shuffle(roundsByTheme[day % DAILY_THEMES.length]!, random).sort((a, b) =>
      (lastCountryDay.get(a.countryCode) ?? -1) - (lastCountryDay.get(b.countryCode) ?? -1));
    const country = candidates.find((round) => day - (lastCountryDay.get(round.countryCode) ?? 0) >= DAILY_THEMES.length &&
      round.frames.filter((frame) => !lastLocationDay.has(streetViewLocationKey(frame))).length >= 3) ?? candidates[0]!;
    const frames = shuffle(country.frames, random).sort((a, b) =>
      (lastLocationDay.get(streetViewLocationKey(a)) ?? -1) - (lastLocationDay.get(streetViewLocationKey(b)) ?? -1)).slice(0, 3);

    if (day === targetDay) return { countryCode: country.countryCode, frames };
    lastCountryDay.set(country.countryCode, day);
    for (const frame of frames) lastLocationDay.set(streetViewLocationKey(frame), day);
  }
}
