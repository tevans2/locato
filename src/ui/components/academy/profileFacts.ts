// Pure helpers that turn a CountryProfile into friendly, learnable phrases.

import type { CountryProfile, FameTier } from "../../../core/countries/profiles";

interface AreaReference {
  readonly label: string;
  readonly km2: number;
  /** The country this reference is, so a country is never compared with itself. */
  readonly code?: string;
}

// Ascending by area. Familiar yardsticks from pitch-sized to continent-sized.
const AREA_REFERENCES: readonly AreaReference[] = [
  { label: "football pitches", km2: 0.00714 },
  { label: "New York's Central Park", km2: 3.41 },
  { label: "Manhattan", km2: 59.1 },
  { label: "Greater London", km2: 1572 },
  { label: "Wales", km2: 20779 },
  { label: "the United Kingdom", km2: 242495, code: "GB" },
  { label: "Texas", km2: 695662 },
  { label: "Australia", km2: 7_692_024, code: "AU" },
];

/** "About 1.6× the size of the United Kingdom", "About 62 football pitches" — or null when nothing fits. */
export function areaComparison(areaKm2: number, code: string): string | null {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) return null;
  const candidates = AREA_REFERENCES.filter((ref) => ref.code !== code && areaKm2 / ref.km2 >= 0.4);
  const ref = candidates.at(-1);
  if (!ref) return null;
  const ratio = areaKm2 / ref.km2;
  if (ref.label === "football pitches") {
    const pitches = Math.round(ratio);
    return pitches <= 1 ? "About the size of a football pitch" : `About ${roundNicely(pitches).toLocaleString("en-US")} football pitches`;
  }
  if (ratio >= 1.5) {
    const multiple = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
    return `About ${multiple}× the size of ${ref.label}`;
  }
  if (ratio >= 0.85) return `About the size of ${ref.label}`;
  if (ratio >= 0.6) return `A little smaller than ${ref.label}`;
  return `About half the size of ${ref.label}`;
}

function roundNicely(n: number): number {
  if (n < 100) return n;
  const magnitude = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / magnitude) * magnitude;
}

/** "328 people per km²" (null if population unknown). */
export function populationDensity(profile: Pick<CountryProfile, "populationMillions" | "areaKm2">): string | null {
  const { populationMillions, areaKm2 } = profile;
  if (populationMillions == null || !areaKm2) return null;
  const density = (populationMillions * 1_000_000) / areaKm2;
  const digits = density < 10 ? 1 : 0;
  return `${density.toLocaleString("en-US", { maximumFractionDigits: digits })} people per km²`;
}

/** "35.7°N 139.7°E". */
export function formatLatLng([lat, lng]: readonly [number, number]): string {
  const latText = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`;
  const lngText = `${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`;
  return `${latText} ${lngText}`;
}

export function hemispheres([lat, lng]: readonly [number, number]): string {
  return `${lat >= 0 ? "Northern" : "Southern"} · ${lng >= 0 ? "Eastern" : "Western"}`;
}

export const FAME_LABELS: Readonly<Record<FameTier, { readonly title: string; readonly detail: string }>> = {
  1: { title: "Easy", detail: "Famous worldwide" },
  2: { title: "Medium", detail: "Well known in its region" },
  3: { title: "Hard", detail: "A deep cut" },
};

// UN non-member observer states among the playable countries.
const UN_OBSERVERS = new Set(["VA", "PS"]);

export function unStatus(profile: Pick<CountryProfile, "code" | "unMember">): { readonly value: string; readonly detail: string } {
  if (profile.unMember) return { value: "Member", detail: "United Nations member state" };
  if (UN_OBSERVERS.has(profile.code)) return { value: "Observer", detail: "Non-member observer state" };
  return { value: "Not a member", detail: "Outside the United Nations" };
}

/** One-line standfirst: "An island nation in Eastern Asia, home to 124 million people." */
export function standfirst(profile: CountryProfile, population: string): string {
  const kind = profile.landlocked ? "landlocked country" : profile.borders.length === 0 ? "island nation" : "country";
  const place = profile.subregion || profile.region || profile.continent;
  const article = /^[aeiou]/i.test(kind) ? "An" : "A";
  const people = profile.populationMillions == null ? "" : `, home to ${population} ${population === "1" ? "person" : "people"}`;
  return `${article} ${kind} in ${place}${people}.`;
}

/** Other capitals besides the primary one ("Cape Town", "Bloemfontein"). */
export function otherCapitals(profile: Pick<CountryProfile, "capital" | "capitals">): readonly string[] {
  const primary = profile.capital.toLowerCase();
  return profile.capitals.filter((capital) => capital.toLowerCase() !== primary);
}

/** Native names that differ from the English common name, deduplicated. */
export function distinctNativeNames(profile: Pick<CountryProfile, "nativeNames" | "name" | "commonName">, limit = 2): readonly { readonly name: string; readonly language: string }[] {
  const seen = new Set([profile.name.toLowerCase(), profile.commonName.toLowerCase()]);
  const result: { name: string; language: string }[] = [];
  for (const native of profile.nativeNames) {
    const key = native.common.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name: native.common, language: native.language });
    if (result.length >= limit) break;
  }
  return result;
}
