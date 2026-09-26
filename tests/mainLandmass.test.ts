import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { featureBounds, mainLandmassBounds, projectWorldMapPosition, type MapRect, type WorldCountryFeature, type WorldMapPolygon } from "../src/core/map";

/** An axis-aligned lon/lat box polygon. */
function box(west: number, south: number, east: number, north: number): WorldMapPolygon {
  return [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
}

function feature(code: string, polygons: readonly WorldMapPolygon[]): WorldCountryFeature {
  return { name: code, code, continent: "Test", geometry: { type: "MultiPolygon", coordinates: polygons } };
}

function contains(rect: MapRect, lon: number, lat: number): boolean {
  const [x, y] = projectWorldMapPosition([lon, lat]);
  return x >= rect.x - 1e-6 && x <= rect.x + rect.width + 1e-6 && y >= rect.y - 1e-6 && y <= rect.y + rect.height + 1e-6;
}

describe("mainLandmassBounds (synthetic shapes)", () => {
  it("returns a single polygon's bounds untouched", () => {
    const single: WorldCountryFeature = { name: "X", code: "XX", continent: "Test", geometry: { type: "Polygon", coordinates: box(0, 0, 10, 10) } };
    expect(mainLandmassBounds(single)).toEqual(featureBounds(single));
  });

  it("keeps a nearby island but drops a far-flung territory", () => {
    const france = feature("FR", [box(-5, 42, 8, 51), box(8.5, 41.4, 9.6, 43), box(-54.5, 2, -51.6, 5.8), box(55.2, -21.4, 55.8, -20.9)]);
    const bounds = mainLandmassBounds(france)!;
    expect(contains(bounds, 9, 42)).toBe(true); // Corsica
    expect(contains(bounds, -53, 4)).toBe(false); // French Guiana
    expect(contains(bounds, 55.5, -21)).toBe(false); // Réunion
    expect(bounds.width).toBeLessThan(45);
  });

  it("drops a sizeable but separate landmass that is much smaller than home (Alaska)", () => {
    const usa = feature("US", [box(-125, 25, -67, 49), box(-168, 55, -130, 71), box(-160, 19, -155, 22)]);
    const bounds = mainLandmassBounds(usa)!;
    expect(contains(bounds, -100, 40)).toBe(true);
    expect(contains(bounds, -150, 64)).toBe(false);
    expect(contains(bounds, -157, 20)).toBe(false);
  });

  it("joins two comparable halves across a short sea (Malaysia)", () => {
    const malaysia = feature("MY", [box(100, 1.3, 104.3, 6.7), box(109.6, 1, 117, 6)]);
    const bounds = mainLandmassBounds(malaysia)!;
    expect(contains(bounds, 101.7, 3.1)).toBe(true);
    expect(contains(bounds, 116, 5)).toBe(true);
  });

  it("chains an archipelago through stepping-stone islands", () => {
    const islands = feature("ID", [box(95, -6, 106, 6), box(106.5, -8, 114, -6), box(114.5, -9, 120, -8), box(108.8, -4, 119, 7)]);
    const bounds = mainLandmassBounds(islands)!;
    expect(contains(bounds, 97, 3)).toBe(true);
    expect(contains(bounds, 118, 5)).toBe(true);
  });

  it("never wraps a frame across the date line", () => {
    const russia = feature("RU", [box(28, 42, 180, 77), box(-180, 64, -169, 69)]);
    const bounds = mainLandmassBounds(russia)!;
    expect(contains(bounds, 100, 60)).toBe(true);
    expect(contains(bounds, -175, 66)).toBe(false);
    expect(bounds.x).toBeGreaterThan(500);
  });

  it("starts from the polygon nearest the anchor when one is given", () => {
    const kiribati = feature("KI", [box(-157.6, 1.7, -157.1, 2.1), box(172.9, 1.3, 173.1, 1.5), box(173.3, 1.8, 173.4, 2.0)]);
    const unanchored = mainLandmassBounds(kiribati)!;
    const anchored = mainLandmassBounds(kiribati, { anchor: [173, 1.33] })!;
    expect(contains(unanchored, -157.4, 1.9)).toBe(true);
    expect(contains(anchored, 173, 1.4)).toBe(true);
    expect(contains(anchored, 173.35, 1.9)).toBe(true);
    expect(contains(anchored, -157.4, 1.9)).toBe(false);
  });
});

describe("mainLandmassBounds (real map data)", () => {
  const features = JSON.parse(readFileSync(new URL("../public/assets/world-map.json", import.meta.url), "utf8")) as WorldCountryFeature[];
  const byCode = (code: string) => features.find((f) => f.code.toUpperCase() === code)!;

  it.each([
    ["FR", [2.35, 48.85], [[9.1, 42.1]], [[-53, 4], [55.5, -21.1]], 50],
    ["US", [-77, 38.9], [[-122.4, 37.8], [-80.2, 25.8]], [[-150, 64], [-157.8, 21.3]], 170],
    ["NO", [10.75, 59.9], [[18.9, 69.6]], [[15.6, 78.2]], 80],
    ["NL", [4.9, 52.37], [[6.5, 53.2]], [[-69, 12.5]], 15],
    ["RU", [37.6, 55.75], [[20.5, 54.7], [135, 48.5]], [[-175, 66]], 450],
    ["MY", [101.7, 3.1], [[116, 5.9]], [], 60],
  ] as const)("%s frames its home landmass", (code, anchor, inside, outside, maxWidth) => {
    for (const bounds of [mainLandmassBounds(byCode(code))!, mainLandmassBounds(byCode(code), { anchor })!]) {
      for (const [lon, lat] of inside) expect(contains(bounds, lon, lat), `${code} should include ${lon},${lat}`).toBe(true);
      for (const [lon, lat] of outside) expect(contains(bounds, lon, lat), `${code} should drop ${lon},${lat}`).toBe(false);
      expect(bounds.width).toBeLessThanOrEqual(maxWidth);
    }
  });

  it("frames Kiribati round Tarawa when anchored, never the whole Pacific", () => {
    const kiribati = byCode("KI");
    expect(featureBounds(kiribati)!.width).toBeGreaterThan(900);
    expect(mainLandmassBounds(kiribati)!.width).toBeLessThan(20);
    const anchored = mainLandmassBounds(kiribati, { anchor: [172.98, 1.33] })!;
    expect(anchored.width).toBeLessThan(20);
    expect(contains(anchored, 172.98, 1.4) || anchored.x > 950).toBe(true);
  });
});
