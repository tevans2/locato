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

export const pickCountryCategory: PromptCategory = {
  id: "pick-country",
  label: "Pick the country",
  description: "Click the named country on the world map.",
  eligible: () => true,
  prompt: (country) => ({ kind: "map-click", value: country.name }),
  accepts: (country, guess) => guess.trim().toUpperCase() === country.code,
  reveal: (country) => country.name,
};

export const spotCountryCategory: PromptCategory = {
  id: "spot-country",
  label: "Spot the country",
  description: "A country flashes on the map — race to type its name.",
  eligible: () => true,
  prompt: (country) => ({ kind: "map-highlight", value: country.code }),
  accepts: (country, guess, auto) => matchesCountryName(country, guess, auto, true),
  reveal: (country) => country.name,
};

export const capitalsCategory: PromptCategory = {
  id: "capitals",
  label: "Capitals",
  description: "Name the country whose capital city is shown.",
  eligible: (country) => country.capital.length > 0,
  prompt: (country) => ({ kind: "text", value: country.capital }),
  // The capital city is the prompt — only accept the country name, not the city itself.
  accepts: (country, guess, auto) => matchesCountryName(country, guess, auto, false),
  reveal: (country) => `${country.name} (capital: ${country.capital})`,
};
