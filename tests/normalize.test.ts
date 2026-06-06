import { expect, it } from "vitest";
import { normalizeAnswer } from "../src/core/countries";

const cases: readonly (readonly [string, string])[] = [
  ["United Kingdom", "united kingdom"],
  ["U.K.", "u k"],
  ["Côte d'Ivoire", "cote d ivoire"],
  ["São Tomé & Príncipe", "sao tome and principe"],
  ["  United   States!! ", "united states"],
];

cases.forEach(([input, expected]) => {
  it(`normalizes ${input}`, () => {
    expect(normalizeAnswer(input)).toBe(expected);
  });
});
