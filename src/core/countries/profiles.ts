// Country profile API for the (lazy-loaded) country profile screen.
//
// NOTE: deliberately NOT re-exported from ./index.ts — the generated + curated data is
// ~250 KB of source and must stay out of the main bundle. Import this module by path:
//   const { getCountryProfile } = await import("../core/countries/profiles");

import { rawCountries } from "./countries";
import { fameTier, type FameTier } from "./fame";
import { GENERATED_COUNTRY_PROFILES } from "./profiles.data";
import { CURATED_COUNTRY_PROFILES } from "./profiles.curated";
import type { Continent } from "./types";
import type { CuratedCountryProfile, GeneratedCountryProfile } from "./profiles.types";
import { WORLD_SPLIT_POPULATION_MILLIONS } from "../worldsplit/population";

export type { Currency, CuratedCountryProfile, DrivingSide, GeneratedCountryProfile, NativeName } from "./profiles.types";
export type { FameTier } from "./fame";

export interface CountryProfile extends GeneratedCountryProfile, CuratedCountryProfile {
  /** Our display name (from rawCountries). */
  readonly name: string;
  /** Our primary capital (from rawCountries; may differ from `capitals[0]`). */
  readonly capital: string;
  readonly continent: Continent;
  readonly flagSrc: string;
  /** Outline SVG, e.g. "assets/country-shapes/za.svg". */
  readonly shapeSrc: string;
  /** Rounded 2024 population estimate, in millions (null if unknown). */
  readonly populationMillions: number | null;
  /** 1 = most populous of the 196 (null if population unknown). */
  readonly populationRank: number | null;
  /** 1 = largest by area of the 196. */
  readonly areaRank: number;
  readonly fameTier: FameTier;
}

export const PROFILE_COUNTRY_COUNT = rawCountries.length;

let cache: ReadonlyMap<string, CountryProfile> | null = null;

function buildProfiles(): ReadonlyMap<string, CountryProfile> {
  const codes = rawCountries.map((c) => c.code);
  const populationRanks = rankBy(codes, (code) => WORLD_SPLIT_POPULATION_MILLIONS[code]);
  const areaRanks = rankBy(codes, (code) => GENERATED_COUNTRY_PROFILES[code]?.areaKm2);

  const map = new Map<string, CountryProfile>();
  for (const raw of rawCountries) {
    const generated = GENERATED_COUNTRY_PROFILES[raw.code];
    const curated = CURATED_COUNTRY_PROFILES[raw.code];
    if (!generated || !curated) continue;
    const population = WORLD_SPLIT_POPULATION_MILLIONS[raw.code];
    map.set(raw.code, {
      ...generated,
      ...curated,
      name: raw.name,
      capital: raw.capital,
      continent: raw.continent,
      flagSrc: raw.flagSrc,
      shapeSrc: `assets/country-shapes/${raw.code.toLowerCase()}.svg`,
      populationMillions: population ?? null,
      populationRank: populationRanks.get(raw.code) ?? null,
      areaRank: areaRanks.get(raw.code) ?? PROFILE_COUNTRY_COUNT,
      fameTier: fameTier(raw.code),
    });
  }
  return map;
}

/** Competition ranking (1 = largest); ties share a rank. Codes without a value are skipped. */
function rankBy(codes: readonly string[], value: (code: string) => number | undefined): Map<string, number> {
  const valued = codes
    .map((code) => ({ code, v: value(code) }))
    .filter((e): e is { code: string; v: number } => typeof e.v === "number" && Number.isFinite(e.v))
    .sort((a, b) => b.v - a.v);
  const ranks = new Map<string, number>();
  valued.forEach((entry, i) => {
    const prev = valued[i - 1];
    ranks.set(entry.code, prev && prev.v === entry.v ? ranks.get(prev.code)! : i + 1);
  });
  return ranks;
}

function profiles(): ReadonlyMap<string, CountryProfile> {
  return (cache ??= buildProfiles());
}

/** Full profile for an alpha-2 code (case-insensitive), or null if unknown. */
export function getCountryProfile(code: string): CountryProfile | null {
  return profiles().get(code.toUpperCase()) ?? null;
}

/** All profiles, in rawCountries order. */
export function allCountryProfiles(): readonly CountryProfile[] {
  return [...profiles().values()];
}

/** Land neighbours' profiles, sorted by name. Empty for islands / unknown codes. */
export function neighboursOf(code: string): readonly CountryProfile[] {
  const profile = getCountryProfile(code);
  if (!profile) return [];
  return profile.borders
    .map((c) => getCountryProfile(c))
    .filter((p): p is CountryProfile => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "1.45 billion", "59 million", "670,000", "800" — from a value in millions. */
export function formatPopulation(millions: number | null | undefined): string {
  if (millions == null || !Number.isFinite(millions)) return "Unknown";
  if (millions >= 1000) return `${trimNumber(millions / 1000, 2)} billion`;
  if (millions >= 1) return `${trimNumber(millions, millions >= 10 ? 0 : 1)} million`;
  return Math.round(millions * 1_000_000).toLocaleString("en-US");
}

/** "1,221,037 km²", "0.44 km²". */
export function formatArea(km2: number | null | undefined): string {
  if (km2 == null || !Number.isFinite(km2)) return "Unknown";
  const digits = km2 < 10 ? 2 : 0;
  return `${km2.toLocaleString("en-US", { maximumFractionDigits: digits })} km²`;
}

/** "1st", "2nd", "23rd", "111th". */
export function formatOrdinal(n: number): string {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "3rd largest of 196" style label for a rank. */
export function formatRank(rank: number | null, noun = "largest"): string {
  return rank == null ? "Unranked" : `${formatOrdinal(rank)} ${noun} of ${PROFILE_COUNTRY_COUNT}`;
}

export function populationRank(code: string): number | null {
  return getCountryProfile(code)?.populationRank ?? null;
}

export function areaRank(code: string): number | null {
  return getCountryProfile(code)?.areaRank ?? null;
}

function trimNumber(value: number, maxDigits: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: maxDigits });
}
