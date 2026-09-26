#!/usr/bin/env node
// Generates src/core/countries/profiles.data.ts from the `world-countries` dataset
// (mledoze, devDependency). The app never imports world-countries at runtime — only the
// committed, generated file. Re-run with: node scripts/generate-country-profiles.mjs
//
// The script fails loudly if any of our 196 countries cannot be resolved, or if any
// derived value looks wrong (e.g. a capital coordinate far from its country).

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worldCountries = require("world-countries");
const datasetVersion = require("world-countries/package.json").version;

const OUT_PATH = resolve(root, "src/core/countries/profiles.data.ts");
const COUNTRIES_PATH = resolve(root, "src/core/countries/countries.ts");

// --- Our 196 countries ------------------------------------------------------------------
const countriesSource = readFileSync(COUNTRIES_PATH, "utf8");
const arrayStart = countriesSource.indexOf("= [") + 2;
const arrayEnd = countriesSource.lastIndexOf("] as const");
if (arrayStart < 2 || arrayEnd < 0) fail("Could not locate rawCountries array in countries.ts");
/** @type {{ name: string, code: string, capital: string }[]} */
const ourCountries = JSON.parse(countriesSource.slice(arrayStart, arrayEnd + 1));
if (ourCountries.length !== 196) fail(`Expected 196 countries in rawCountries, found ${ourCountries.length}`);
const ourCodes = new Set(ourCountries.map((c) => c.code));

// --- Code / name mapping ----------------------------------------------------------------
// Our code -> dataset cca2 where they differ. Currently all 196 of our codes match the
// dataset's cca2 directly (Kosovo "XK", Palestine "PS", Taiwan "TW" and Vatican "VA" all
// exist as-is), but keep the hook so a future mismatch is a one-line fix, not a crash.
const DATASET_CODE_OVERRIDES = {};

// Dataset gaps / fixes, applied after extraction.
const FIELD_OVERRIDES = {
  // Micronesia uses the US dollar; the dataset has an empty currencies object.
  FM: { currencies: [{ code: "USD", name: "United States dollar", symbol: "$" }] },
  // The Holy See is a UN permanent observer, not a member (dataset marks it true).
  VA: { unMember: false },
};

// Dataset border errors: [code, neighbourCode] pairs to drop.
const BORDER_REMOVALS = [
  // Sri Lanka has no land border with India (the dataset lists IND one-way).
  ["LK", "IN"],
];

// Countries whose idd has several suffixes. +1 (NANP) and +7 are genuine shared roots;
// anything else must be spelled out here or the script fails.
const SHARED_CALLING_ROOTS = new Set(["+1", "+7"]);
// Vatican City: +379 is reserved but unused; its lines are reached via Italy's +39 (06 698).
const CALLING_CODE_OVERRIDES = { VA: "+39" };

// The dataset (v5) has no capital coordinates, so these are hand-maintained
// (approximate city-centre coordinates, 2 dp) for the capital named in rawCountries.
// Sanity-checked below against each country's centroid.
const CAPITAL_LATLNG = {
  AD: [42.51, 1.52], AE: [24.45, 54.38], AF: [34.53, 69.17], AG: [17.12, -61.85], AL: [41.33, 19.82],
  AM: [40.18, 44.51], AO: [-8.84, 13.23], AR: [-34.6, -58.38], AT: [48.21, 16.37], AU: [-35.28, 149.13],
  AZ: [40.41, 49.87], BA: [43.86, 18.41], BB: [13.1, -59.62], BD: [23.81, 90.41], BE: [50.85, 4.35],
  BF: [12.37, -1.52], BG: [42.7, 23.32], BH: [26.23, 50.59], BI: [-3.43, 29.92], BJ: [6.5, 2.6],
  BN: [4.9, 114.94], BO: [-19.05, -65.26], BR: [-15.79, -47.88], BS: [25.05, -77.35], BT: [27.47, 89.64],
  BW: [-24.65, 25.91], BY: [53.9, 27.56], BZ: [17.25, -88.77], CA: [45.42, -75.7], CD: [-4.44, 15.27],
  CF: [4.39, 18.56], CG: [-4.26, 15.24], CH: [46.95, 7.45], CI: [6.83, -5.29], CL: [-33.45, -70.67],
  CM: [3.85, 11.5], CN: [39.9, 116.41], CO: [4.71, -74.07], CR: [9.93, -84.09], CU: [23.11, -82.37],
  CV: [14.93, -23.51], CY: [35.17, 33.36], CZ: [50.08, 14.44], DE: [52.52, 13.4], DJ: [11.59, 43.15],
  DK: [55.68, 12.57], DM: [15.3, -61.39], DO: [18.49, -69.93], DZ: [36.75, 3.06], EC: [-0.18, -78.47],
  EE: [59.44, 24.75], EG: [30.04, 31.24], ER: [15.32, 38.93], ES: [40.42, -3.7], ET: [9.03, 38.74],
  FI: [60.17, 24.94], FJ: [-18.14, 178.44], FM: [6.92, 158.16], FR: [48.86, 2.35], GA: [0.39, 9.45],
  GB: [51.51, -0.13], GD: [12.06, -61.75], GE: [41.72, 44.79], GH: [5.6, -0.19], GM: [13.45, -16.58],
  GN: [9.64, -13.58], GQ: [3.75, 8.78], GR: [37.98, 23.73], GT: [14.63, -90.51], GW: [11.86, -15.6],
  GY: [6.8, -58.16], HN: [14.07, -87.19], HR: [45.81, 15.98], HT: [18.59, -72.31], HU: [47.5, 19.04],
  ID: [-6.21, 106.85], IE: [53.35, -6.26], IL: [31.77, 35.21], IN: [28.61, 77.21], IQ: [33.31, 44.36],
  IR: [35.69, 51.39], IS: [64.15, -21.94], IT: [41.9, 12.5], JM: [17.97, -76.79], JO: [31.95, 35.93],
  JP: [35.68, 139.69], KE: [-1.29, 36.82], KG: [42.87, 74.59], KH: [11.56, 104.93], KI: [1.33, 172.98],
  KM: [-11.7, 43.26], KN: [17.3, -62.72], KP: [39.04, 125.76], KR: [37.57, 126.98], KW: [29.38, 47.99],
  KZ: [51.17, 71.45], LA: [17.98, 102.63], LB: [33.89, 35.5], LC: [14.01, -60.99], LI: [47.14, 9.52],
  LK: [6.89, 79.92], LR: [6.3, -10.8], LS: [-29.31, 27.48], LT: [54.69, 25.28], LU: [49.61, 6.13],
  LV: [56.95, 24.11], LY: [32.89, 13.19], MA: [34.02, -6.83], MC: [43.74, 7.42], MD: [47.01, 28.86],
  ME: [42.44, 19.26], MG: [-18.88, 47.51], MH: [7.09, 171.38], MK: [42.0, 21.43], ML: [12.64, -8.0],
  MM: [19.76, 96.08], MN: [47.89, 106.91], MR: [18.08, -15.98], MT: [35.9, 14.51], MU: [-20.16, 57.5],
  MV: [4.18, 73.51], MW: [-13.96, 33.79], MX: [19.43, -99.13], MY: [3.14, 101.69], MZ: [-25.97, 32.57],
  NA: [-22.56, 17.08], NE: [13.51, 2.13], NG: [9.08, 7.4], NI: [12.11, -86.24], NL: [52.37, 4.9],
  NO: [59.91, 10.75], NP: [27.72, 85.32], NR: [-0.55, 166.92], NZ: [-41.29, 174.78], OM: [23.59, 58.41],
  PA: [8.98, -79.52], PE: [-12.05, -77.04], PG: [-9.44, 147.18], PH: [14.6, 120.98], PK: [33.68, 73.05],
  PL: [52.23, 21.01], PS: [31.9, 35.2], PT: [38.72, -9.14], PW: [7.5, 134.62], PY: [-25.26, -57.58],
  QA: [25.29, 51.53], RO: [44.43, 26.1], RS: [44.79, 20.45], RU: [55.76, 37.62], RW: [-1.94, 30.06],
  SA: [24.71, 46.68], SB: [-9.43, 159.95], SC: [-4.62, 55.45], SD: [15.5, 32.56], SE: [59.33, 18.07],
  SG: [1.29, 103.85], SI: [46.06, 14.51], SK: [48.15, 17.11], SL: [8.47, -13.23], SM: [43.94, 12.45],
  SN: [14.72, -17.47], SO: [2.05, 45.32], SR: [5.85, -55.2], SS: [4.85, 31.58], ST: [0.34, 6.73],
  SV: [13.69, -89.22], SY: [33.51, 36.29], SZ: [-26.31, 31.14], TD: [12.13, 15.06], TG: [6.13, 1.22],
  TH: [13.76, 100.5], TJ: [38.56, 68.79], TL: [-8.56, 125.57], TM: [37.96, 58.33], TN: [36.81, 10.18],
  TO: [-21.14, -175.2], TR: [39.93, 32.86], TT: [10.66, -61.51], TV: [-8.52, 179.2], TW: [25.03, 121.57],
  TZ: [-6.16, 35.75], UA: [50.45, 30.52], UG: [0.35, 32.58], US: [38.9, -77.04], UY: [-34.9, -56.16],
  UZ: [41.3, 69.24], VA: [41.9, 12.45], VC: [13.16, -61.23], VE: [10.48, -66.9], VN: [21.03, 105.85],
  VU: [-17.73, 168.32], WS: [-13.83, -171.76], YE: [15.37, 44.19], ZA: [-25.75, 28.19], ZM: [-15.39, 28.32],
  ZW: [-17.83, 31.05],
};

// --- Build ---------------------------------------------------------------------------
const byCca2 = new Map(worldCountries.map((c) => [c.cca2, c]));
const cca3ToOurCode = new Map();
for (const c of worldCountries) {
  const ours = Object.entries(DATASET_CODE_OVERRIDES).find(([, cca2]) => cca2 === c.cca2)?.[0] ?? c.cca2;
  if (ourCodes.has(ours)) cca3ToOurCode.set(c.cca3, ours);
}

const errors = [];
const droppedBorders = new Set();
const profiles = {};

for (const country of [...ourCountries].sort((a, b) => a.code.localeCompare(b.code))) {
  const code = country.code;
  const source = byCca2.get(DATASET_CODE_OVERRIDES[code] ?? code);
  if (!source) {
    errors.push(`${code} (${country.name}) not found in world-countries`);
    continue;
  }

  const languageEntries = Object.entries(source.languages ?? {});
  const languages = languageEntries.map(([, name]) => name);

  const nativeEntries = Object.entries(source.name.native ?? {});
  // Prefer non-English native names (English is already the display name), in the
  // dataset's language order; fall back to English if that's all there is.
  nativeEntries.sort(([a], [b]) => Number(a === "eng") - Number(b === "eng"));
  const nativeNames = nativeEntries.slice(0, 2).map(([lang, n]) => ({
    language: source.languages?.[lang] ?? lang,
    official: n.official.trim(),
    common: n.common.trim(),
  }));

  const borders = [];
  for (const cca3 of source.borders ?? []) {
    const ours = cca3ToOurCode.get(cca3);
    if (ours) borders.push(ours);
    else droppedBorders.add(`${code}->${cca3}`);
  }
  for (const [from, to] of BORDER_REMOVALS) {
    if (from === code && borders.includes(to)) borders.splice(borders.indexOf(to), 1);
  }
  borders.sort();

  const currencies = Object.entries(source.currencies ?? {}).map(([cur, v]) => ({
    code: cur,
    name: v.name,
    symbol: v.symbol ?? null,
  }));

  const { root: iddRoot = "", suffixes = [] } = source.idd ?? {};
  let callingCode = CALLING_CODE_OVERRIDES[code] ?? null;
  if (!callingCode) {
    if (suffixes.length === 1) callingCode = iddRoot + suffixes[0];
    else if (SHARED_CALLING_ROOTS.has(iddRoot)) callingCode = iddRoot;
    else errors.push(`${code}: ambiguous calling code ${iddRoot} ${suffixes.join(",")} — add an override`);
  }

  const capitalLatLng = CAPITAL_LATLNG[code] ?? null;
  if (!capitalLatLng) errors.push(`${code}: missing CAPITAL_LATLNG entry`);

  const profile = {
    code,
    cca3: source.cca3,
    commonName: source.name.common,
    officialName: source.name.official,
    nativeNames,
    region: source.region,
    subregion: source.subregion ?? "",
    capitals: source.capital ?? [],
    latlng: source.latlng.map((n) => Math.round(n * 100) / 100),
    capitalLatLng,
    areaKm2: source.area,
    landlocked: Boolean(source.landlocked),
    borders,
    languages,
    currencies,
    demonym: source.demonyms?.eng?.m ?? "",
    callingCode,
    tld: source.tld ?? [],
    flagEmoji: source.flag,
    unMember: Boolean(source.unMember),
    ...FIELD_OVERRIDES[code],
  };

  for (const [key, value] of Object.entries(profile)) {
    if (value === "" || value == null) errors.push(`${code}: empty ${key}`);
  }
  if (!profile.currencies.length) errors.push(`${code}: no currencies`);
  if (!profile.languages.length) errors.push(`${code}: no languages`);
  if (!(profile.areaKm2 > 0)) errors.push(`${code}: bad area`);

  // Capital sanity: within ~(country "radius" + 1,500 km) of the dataset centroid.
  if (capitalLatLng) {
    const km = haversineKm(capitalLatLng, profile.latlng);
    const limit = Math.sqrt(profile.areaKm2) * 1.2 + 1500;
    if (km > limit) errors.push(`${code}: capital ${km.toFixed(0)} km from centroid (limit ${limit.toFixed(0)})`);
  }

  profiles[code] = profile;
}

for (const code of ourCodes) if (!profiles[code] && !errors.some((e) => e.startsWith(code))) errors.push(`${code}: missing`);
for (const p of Object.values(profiles)) {
  for (const other of p.borders) {
    if (!profiles[other]?.borders.includes(p.code)) errors.push(`${p.code}: border with ${other} is not symmetric`);
  }
}
if (errors.length) fail(`Country profile generation failed:\n  ${errors.join("\n  ")}`);

// --- Emit ------------------------------------------------------------------------------
const body = Object.values(profiles)
  .map((p) => `  ${p.code}: ${formatValue(p, 2)},`)
  .join("\n");

const output = `// AUTO-GENERATED by scripts/generate-country-profiles.mjs — do not edit by hand.
// Source: world-countries@${datasetVersion} (mledoze/countries, ODbL). Capital coordinates are
// hand-maintained in the generator. ${Object.keys(profiles).length} countries, sorted by code.
import type { GeneratedCountryProfile } from "./profiles.types";

export const GENERATED_COUNTRY_PROFILES: Readonly<Record<string, GeneratedCountryProfile>> = {
${body}
};
`;

writeFileSync(OUT_PATH, output);
console.log(`Wrote ${Object.keys(profiles).length} profiles to ${OUT_PATH} (${(output.length / 1024).toFixed(1)} KB).`);
if (droppedBorders.size) console.log(`Dropped ${droppedBorders.size} borders to non-listed territories: ${[...droppedBorders].sort().join(" ")}`);

// --- Helpers ---------------------------------------------------------------------------
function fail(message) {
  console.error(message);
  process.exit(1);
}

function haversineKm([lat1, lng1], [lat2, lng2]) {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** JSON-ish pretty printer: unquoted identifier keys, primitive arrays on one line. */
function formatValue(value, indent) {
  const pad = " ".repeat(indent);
  const inner = " ".repeat(indent + 2);
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== "object")) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    return `[\n${value.map((v) => `${inner}${formatValue(v, indent + 2)},`).join("\n")}\n${pad}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const flat = entries.every(([, v]) => v === null || typeof v !== "object");
    const parts = entries.map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${formatValue(v, indent + 2)}`);
    const oneLine = `{ ${parts.join(", ")} }`;
    if (flat && oneLine.length + indent <= 110) return oneLine;
    return `{\n${parts.map((p) => `${inner}${p},`).join("\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}
