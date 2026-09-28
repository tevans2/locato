import { describe, expect, it } from "vitest";
import { indexCountries, rawCountries } from "../src/core/countries";
import { checkTypedAnswer } from "../src/core/academy";

const index = indexCountries(rawCountries);

describe("checkTypedAnswer", () => {
  it("accepts names, aliases and capitals exactly", () => {
    expect(checkTypedAnswer(index, "FR", "flag", "france")).toEqual({ correct: true, near: false, canonical: "France" });
    expect(checkTypedAnswer(index, "GB", "shape", "UK")).toMatchObject({ correct: true, near: false });
    expect(checkTypedAnswer(index, "BR", "capital", "Brasilia")).toEqual({ correct: true, near: false, canonical: "Brasília" });
    expect(checkTypedAnswer(index, "FR", "capital", "  PARIS ")).toMatchObject({ correct: true });
  });

  it("rejects bare codes and wrong answers", () => {
    expect(checkTypedAnswer(index, "FR", "flag", "fr").correct).toBe(false);
    expect(checkTypedAnswer(index, "FR", "flag", "Germany").correct).toBe(false);
    expect(checkTypedAnswer(index, "FR", "flag", "").correct).toBe(false);
    expect(checkTypedAnswer(index, "FR", "capital", "France").correct).toBe(false);
  });

  it("tolerates typos and flags them as near", () => {
    expect(checkTypedAnswer(index, "PT", "flag", "Portgual")).toEqual({ correct: false, near: false, canonical: "Portugal" });
    expect(checkTypedAnswer(index, "PT", "flag", "Portugl")).toEqual({ correct: true, near: true, canonical: "Portugal" });
    expect(checkTypedAnswer(index, "TD", "flag", "Chd")).toEqual({ correct: true, near: true, canonical: "Chad" });
    expect(checkTypedAnswer(index, "PE", "flag", "Peru")).toMatchObject({ correct: true, near: false });
    expect(checkTypedAnswer(index, "PE", "flag", "Perru")).toMatchObject({ correct: true, near: true });
    expect(checkTypedAnswer(index, "HU", "capital", "Budapset")).toMatchObject({ correct: false });
    expect(checkTypedAnswer(index, "HU", "capital", "Budpest")).toMatchObject({ correct: true, near: true });
  });

  it("never accepts another country's exact answer as a typo", () => {
    expect(checkTypedAnswer(index, "IR", "flag", "Iraq").correct).toBe(false);
    expect(checkTypedAnswer(index, "IR", "flag", "Irn")).toMatchObject({ correct: true, near: true });
    expect(checkTypedAnswer(index, "NE", "flag", "Nigeria").correct).toBe(false);
    expect(checkTypedAnswer(index, "AT", "flag", "Australia").correct).toBe(false);
  });
});
