import { describe, expect, it } from "vitest";
import { territoryFlags } from "../src/core/territoryFlags";

describe("territory flag reference", () => {
  it("keeps a unique local SVG path for every territory entry", () => {
    expect(territoryFlags).toHaveLength(57);
    expect(new Set(territoryFlags.map((flag) => flag.code)).size).toBe(territoryFlags.length);
    expect(new Set(territoryFlags.map((flag) => flag.flagSrc)).size).toBe(territoryFlags.length);
    expect(territoryFlags.every((flag) => flag.flagSrc.startsWith("assets/flags/territories/") && flag.flagSrc.endsWith(".svg"))).toBe(true);
  });

  it("contains the split Caribbean Netherlands and Saint Helena group flags", () => {
    expect(territoryFlags.map((flag) => flag.code)).toEqual(expect.arrayContaining(["BQ-BO", "BQ-SA", "BQ-SE", "AC", "SH", "TA"]));
  });
});
