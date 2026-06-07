import type { CountryIndex } from "../countries";
import { createSeededRandom } from "../game/random";
import { codesCategory, flagsCategory, shapesCategory } from "./builtins";
import type { PromptCategory, PromptSlot } from "./types";

export const promptCategories = {
  flags: flagsCategory,
  shapes: shapesCategory,
  codes: codesCategory,
} as const;

export type CategoryId = keyof typeof promptCategories;

export const allCategories: readonly PromptCategory[] = Object.values(promptCategories);

export const DEFAULT_CATEGORY_IDS: readonly string[] = ["flags"];

export function getCategory(id: string): PromptCategory | undefined {
  return promptCategories[id as CategoryId];
}

// Keeps only known ids; falls back to the default so a game always has at least one category.
export function resolveCategoryIds(ids: readonly string[]): readonly string[] {
  const valid = ids.filter((id) => getCategory(id) !== undefined);
  return valid.length > 0 ? [...new Set(valid)] : [...DEFAULT_CATEGORY_IDS];
}

// One slot per country: each country is shown through exactly one of the selected (and eligible)
// categories, chosen deterministically from the seed. Selecting Flags + Codes yields a single
// interleaved deck, not a doubled one. Order is shuffled later by the round queue.
export function buildPromptSlots(index: CountryIndex, categoryIds: readonly string[], seed: string): readonly PromptSlot[] {
  const categories = resolveCategoryIds(categoryIds)
    .map((id) => getCategory(id))
    .filter((category): category is PromptCategory => category !== undefined);
  const random = createSeededRandom(`${seed}:slots`);
  const slots: PromptSlot[] = [];

  for (const country of index.countries) {
    const eligible = categories.filter((category) => category.eligible(country));
    if (eligible.length === 0) continue;
    const chosen = eligible[Math.floor(random() * eligible.length)] ?? eligible[0];
    if (chosen) slots.push({ countryId: country.id, categoryId: chosen.id });
  }

  return slots;
}
