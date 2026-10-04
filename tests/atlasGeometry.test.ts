import { describe, expect, it } from "vitest";
import { atlasCountryAnchor, atlasPosition, atlasTexturePoint, unwrapAtlasRing } from "../src/ui/components/landing/atlasGeometry";
import type { WorldCountryFeature } from "../src/core/map";

describe("Atlas globe geography", () => {
  it("keeps the country marker and sphere texture in the same orientation", () => {
    expect(atlasPosition([0, 0])).toEqual([0, 0, 1]);
    expect(atlasTexturePoint([0, 0], 4096, 2048)).toEqual([1024, 1024]);
    expect(atlasPosition([90, 0])[0]).toBeCloseTo(1);
    expect(atlasPosition([0, 90])[1]).toBeCloseTo(1);
    const position = atlasPosition([25, -29]);
    expect(Math.hypot(...position)).toBeCloseTo(1);
  });

  it("draws date-line islands across the texture seam rather than across the entire Earth", () => {
    const ring = unwrapAtlasRing([[179, -15], [-179, -15], [-179, -17], [179, -17], [179, -15]]);
    expect(ring.map(([longitude]) => longitude)).toEqual([179, 181, 181, 179, 179]);
    const xs = ring.map((point) => atlasTexturePoint(point, 360, 180)[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(2);
    expect(unwrapAtlasRing([])).toEqual([]);
  });

  it("anchors a country to its main landmass instead of averaging in overseas islands", () => {
    const feature: WorldCountryFeature = {
      name: "France", code: "FR", continent: "Europe",
      geometry: { type: "MultiPolygon", coordinates: [
        [[[-55, 3], [-52, 3], [-52, 5], [-55, 5], [-55, 3]]],
        [[[-5, 42], [8, 42], [8, 51], [-5, 51], [-5, 42]]],
      ] },
    };
    expect(atlasCountryAnchor(feature)).toEqual([1.5, 46.5]);
  });

  it("normalizes country anchors that straddle the date line", () => {
    const feature: WorldCountryFeature = {
      name: "Island", code: "XX", continent: "Oceania",
      geometry: { type: "Polygon", coordinates: [[[179, -15], [-179, -15], [-179, -17], [179, -17], [179, -15]]] },
    };
    expect(atlasCountryAnchor(feature)).toEqual([-180, -16]);
  });
});
