import { matchesCountryName } from "./matching";
import type { PromptCategory } from "./types";

export const flagsCategory: PromptCategory = {
  id: "flags",
  label: "Flags",
  description: "Name the country from its flag.",
  eligible: () => true,
  prompt: (country) => ({ kind: "image", value: country.flagSrc }),
  accepts: (country, guess, auto) => matchesCountryName(country, guess, auto, true),
  reveal: (country) => country.name,
};

export const shapesCategory: PromptCategory = {
  id: "shapes",
  label: "Country outlines",
  description: "Name the country from its outline.",
  eligible: () => true,
  prompt: (country) => ({ kind: "image", value: `assets/country-shapes/${country.code.toLowerCase()}.svg` }),
  accepts: (country, guess, auto) => matchesCountryName(country, guess, auto, true),
  reveal: (country) => country.name,
};

export const codesCategory: PromptCategory = {
  id: "codes",
  label: "Country codes",
  description: "Name the country from its ISO code.",
  eligible: () => true,
  prompt: (country) => ({ kind: "text", value: country.code }),
  // Don't accept the code itself — it's the prompt the player is staring at.
  accepts: (country, guess, auto) => matchesCountryName(country, guess, auto, false),
  reveal: (country) => `${country.name} (${country.code})`,
};
