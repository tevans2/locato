import { getCountryProfile, type CountryProfile } from "../countries/profiles";
import { haversineDistanceKm } from "../maptap/distance";

/**
 * What one guess in Mystery country tells you about the hidden country. Distances run between
 * the countries' centres; comparisons describe the mystery country relative to the guess.
 */

export type Compass = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
/** The mystery country's value next to the guess's ("about the same" within 10%). */
export type Comparison = "higher" | "lower" | "same";

export interface MysteryClues {
  readonly correct: boolean;
  readonly distanceKm: number;
  /** Which way to go from the guess (degrees clockwise from north), or null when correct. */
  readonly bearing: number | null;
  readonly direction: Compass | null;
  /** 100 at the mystery country, falling to 0 on the far side of the world. */
  readonly proximity: number;
  readonly sameContinent: boolean;
  /** The guess shares a land border with the mystery country. */
  readonly neighbour: boolean;
  readonly population: Comparison;
  readonly area: Comparison;
  /** Both landlocked, or both with a coast. */
  readonly sameLandlocked: boolean;
  readonly sameDrivingSide: boolean;
}

/** Half the Earth's circumference: the furthest two places can be apart. */
const FURTHEST_KM = 20_015;
const COMPASS: readonly Compass[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

function compare(target: number | null, guess: number | null): Comparison {
  if (target === null || guess === null || guess <= 0) return "same";
  const ratio = target / guess;
  return ratio > 1.1 ? "higher" : ratio < 1 / 1.1 ? "lower" : "same";
}

/** Initial compass bearing from `from` to `to`, in degrees clockwise from north. */
export function bearingDegrees(from: { readonly lat: number; readonly lng: number }, to: { readonly lat: number; readonly lng: number }): number {
  const rad = Math.PI / 180;
  const dLng = (to.lng - from.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(to.lat * rad);
  const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

export function compassFor(bearing: number): Compass {
  return COMPASS[Math.round(bearing / 45) % 8]!;
}

const centre = (profile: CountryProfile) => ({ lat: profile.latlng[0], lng: profile.latlng[1] });

/** The clues a guess earns, or null when either code isn't a country. */
export function mysteryClues(guessCode: string, targetCode: string): MysteryClues | null {
  const guess = getCountryProfile(guessCode);
  const target = getCountryProfile(targetCode);
  if (!guess || !target) return null;
  if (guess.code === target.code) {
    return { correct: true, distanceKm: 0, bearing: null, direction: null, proximity: 100, sameContinent: true, neighbour: false, population: "same", area: "same", sameLandlocked: true, sameDrivingSide: true };
  }
  const distanceKm = Math.round(haversineDistanceKm(centre(guess), centre(target)));
  const bearing = Math.round(bearingDegrees(centre(guess), centre(target)));
  return {
    correct: false,
    distanceKm,
    bearing,
    direction: compassFor(bearing),
    // Never 100 for a wrong guess, however close the centres are.
    proximity: Math.min(99, Math.max(0, Math.round((1 - distanceKm / FURTHEST_KM) * 100))),
    sameContinent: guess.continent === target.continent,
    neighbour: guess.borders.includes(target.code),
    population: compare(target.populationMillions, guess.populationMillions),
    area: compare(target.areaKm2, guess.areaKm2),
    sameLandlocked: guess.landlocked === target.landlocked,
    sameDrivingSide: guess.drivingSide === target.drivingSide,
  };
}

/** Hint text: 1 names the region, 2 gives the first letter. */
export function mysteryHintText(targetCode: string, level: number): string {
  const target = getCountryProfile(targetCode);
  if (!target) return "";
  return level === 1 ? `It's in ${target.subregion}.` : `Its name starts with “${target.name.charAt(0)}”.`;
}
