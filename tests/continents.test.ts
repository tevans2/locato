import { describe, expect, it } from "vitest";
import { indexCountries, isInContinent, rawCountries } from "../src/core/countries";

describe("isInContinent", () => {
  const { byCode } = indexCountries(rawCountries);

  it("counts Turkey and Cyprus in both Europe and Asia", () => {
    for (const code of ["TR", "CY"]) {
      expect(isInContinent(byCode.get(code)!, "Europe")).toBe(true);
      expect(isInContinent(byCode.get(code)!, "Asia")).toBe(true);
    }
  });

  it("keeps Malta in Europe and everyone else in their one continent", () => {
    expect(isInContinent(byCode.get("MT")!, "Europe")).toBe(true);
    expect(isInContinent(byCode.get("FR")!, "Asia")).toBe(false);
    expect(isInContinent(byCode.get("JP")!, "Europe")).toBe(false);
  });
});
