import type { Country, CountryId } from "../countries";

export interface PromptContent {
  readonly kind: "image" | "text" | "map-click" | "map-highlight" | "flag-colors";
  readonly value: string;
}

// A category is "a type of prompt you're shown". It knows how to render a country as a prompt,
// match a guess, and reveal the answer. Categories are mix-and-matchable: a game pool draws
// slots from every selected category. Today all categories are country-backed, but the engine
// only ever sees the four functions below, so non-country categories can be added later.
export interface PromptCategory {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly eligible: (country: Country) => boolean;
  readonly prompt: (country: Country) => PromptContent;
  readonly accepts: (country: Country, guess: string, auto: boolean) => boolean;
  readonly reveal: (country: Country) => string;
}

// One playable round: a country shown through a specific category's prompt.
export interface PromptSlot {
  readonly countryId: CountryId;
  readonly categoryId: string;
}
