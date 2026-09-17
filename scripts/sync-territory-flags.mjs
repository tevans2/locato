import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetRoot = join(root, "public", "assets", "flags", "territories");
const countryFlagRoot = join(root, "public", "assets", "flags");
const regionFlagRoot = join(root, "node_modules", "region-flags", "svg");
const detailedCountryFlagRoot = join(root, "node_modules", "svg-country-flags", "svg");

// region-flags keeps native proportions and the detailed Wikipedia-derived emblems
// that the main country flag set uses. These are intentionally not normalized to
// a 3:2 icon grid.
const regionFlagCodes = [
  "AC", "AI", "AQ", "AS", "AW", "AX", "BM", "BV", "CC", "CK", "CW", "CX",
  "EH", "FK", "FO", "GF", "GG", "GI", "GL", "GS", "GU", "HK", "HM", "IM",
  "IO", "JE", "KY", "MO", "MP", "MS", "NC", "NF", "NU", "PF", "PN", "PR",
  "SH", "SJ", "SX", "TA", "TC", "TK", "UM", "VG", "VI", "WF", "YT",
];

// The current region-flags snapshot aliases these to parent flags, while the
// detailed svg-country-flags snapshot contains the locally recognisable artwork
// already used by this project for these entries.
const detailedCountryFlagCodes = ["BL", "TF"];

// These entries deliberately use France's official tricolour in the current
// reference set. Reuse the exact same SVG as the main country flag collection.
const franceFlagAliases = ["GP", "PM", "RE"];

// These are maintained in this repository instead of copied from a package:
// - the Caribbean Netherlands entries need three separate island flags;
// - Saint Martin is a local reference flag rather than the package's FR alias;
// - Martinique changed flag in 2023 and must not be overwritten by older sets.
const projectOwnedFlagCodes = ["BQ-BO", "BQ-SA", "BQ-SE", "MF", "MQ"];

const expectedFlagCodes = [
  "AC", "AI", "AQ", "AS", "AW", "AX", "BL", "BM", "BQ-BO", "BQ-SA", "BQ-SE", "BV",
  "CC", "CK", "CW", "CX", "EH", "FK", "FO", "GF", "GG", "GI", "GL", "GP", "GS", "GU",
  "HK", "HM", "IM", "IO", "JE", "KY", "MF", "MO", "MP", "MQ", "MS", "NC", "NF", "NU",
  "PF", "PM", "PN", "PR", "RE", "SH", "SJ", "SX", "TA", "TC", "TF", "TK", "UM", "VG",
  "VI", "WF", "YT",
];

const generatedCodes = new Set([
  ...regionFlagCodes,
  ...detailedCountryFlagCodes,
  ...franceFlagAliases,
  ...projectOwnedFlagCodes,
]);

if (generatedCodes.size !== expectedFlagCodes.length || expectedFlagCodes.some((code) => !generatedCodes.has(code))) {
  throw new Error("Territory flag sync map is incomplete or contains duplicate codes.");
}

await mkdir(targetRoot, { recursive: true });

for (const code of regionFlagCodes) {
  await copyFile(join(regionFlagRoot, `${code}.svg`), join(targetRoot, `${code.toLowerCase()}.svg`));
}

for (const code of detailedCountryFlagCodes) {
  await copyFile(join(detailedCountryFlagRoot, `${code.toLowerCase()}.svg`), join(targetRoot, `${code.toLowerCase()}.svg`));
}

for (const code of franceFlagAliases) {
  await copyFile(join(countryFlagRoot, "fr.svg"), join(targetRoot, `${code.toLowerCase()}.svg`));
}

await copyFile(join(root, "node_modules", "region-flags", "COPYING"), join(targetRoot, "LICENSE-region-flags.txt"));
await copyFile(join(root, "node_modules", "svg-country-flags", "README.md"), join(targetRoot, "SOURCE-svg-country-flags.md"));
await rm(join(targetRoot, "LICENSE-country-flag-icons.txt"), { force: true });

console.log(
  `Synced ${regionFlagCodes.length + detailedCountryFlagCodes.length + franceFlagAliases.length} detailed territory SVGs; ` +
    `kept ${projectOwnedFlagCodes.length} project-owned current/split flags.`,
);
