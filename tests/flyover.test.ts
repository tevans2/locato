import { describe, expect, it } from "vitest";
import {
  FLYOVER_SPEED,
  FLYOVER_TURN_RATE,
  buildFlyoverCountries,
  countryContainsPoint,
  countryUnderPoint,
  headingTowards,
  pickNextTarget,
  planeTouchesCountry,
  stepPlane,
  wrappedDeltaX,
} from "../src/core/flyover";
import { projectWorldMapPosition, type WorldCountryFeature } from "../src/core/map";
import { FLYOVER_MAX_SCORE, leaderboardConfig } from "../src/core/leaderboards";

const square = (lng: number, lat: number, size = 10) => ({ type: "Polygon" as const, coordinates: [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]] });
const feature = (code: string, name: string, geometry: unknown): WorldCountryFeature => ({ code, name, continent: "Test", geometry }) as unknown as WorldCountryFeature;

const countries = buildFlyoverCountries([
  feature("AA", "Alpha", square(0, 0)),
  feature("BB", "Bravo", square(-30, 0)),
  feature("CC", "Charlie", square(100, 20)),
  feature("TT", "Tiny", square(50, 50, 0.2)),
  // A ring with a hole: the hole is not the country.
  feature("HH", "Holey", { type: "Polygon", coordinates: [
    [[-100, 20], [-80, 20], [-80, 40], [-100, 40], [-100, 20]],
    [[-95, 25], [-85, 25], [-85, 35], [-95, 35], [-95, 25]],
  ] }),
  // Straddles the date line as two polygons.
  feature("DL", "Dateline", { type: "MultiPolygon", coordinates: [
    [[[170, -20], [180, -20], [180, -10], [170, -10], [170, -20]]],
    [[[-180, -20], [-170, -20], [-170, -10], [-180, -10], [-180, -20]]],
  ] }),
]);
const byCode = (code: string) => countries.find((country) => country.code === code)!;
const at = (lng: number, lat: number) => projectWorldMapPosition([lng, lat]);

describe("flyover geometry", () => {
  it("projects countries and finds their centre", () => {
    const alpha = byCode("AA");
    const [cx, cy] = alpha.centre;
    const [ex, ey] = at(5, 5);
    expect(cx).toBeCloseTo(ex, 5);
    expect(cy).toBeCloseTo(ey, 5);
    expect(alpha.targetable).toBe(true);
    expect(byCode("TT").targetable).toBe(false);
  });

  it("tests points against outlines and holes", () => {
    expect(countryContainsPoint(byCode("AA"), ...at(5, 5))).toBe(true);
    expect(countryContainsPoint(byCode("AA"), ...at(15, 5))).toBe(false);
    expect(countryContainsPoint(byCode("HH"), ...at(-98, 30))).toBe(true);
    expect(countryContainsPoint(byCode("HH"), ...at(-90, 30))).toBe(false);
    expect(countryUnderPoint(countries, ...at(-25, 5))?.code).toBe("BB");
    expect(countryUnderPoint(countries, ...at(-60, -40))).toBeNull();
  });

  it("wraps east–west, so either wrap of a point is the same place", () => {
    const [x, y] = at(-175, -15);
    expect(countryContainsPoint(byCode("DL"), x, y)).toBe(true);
    expect(countryContainsPoint(byCode("DL"), x + 1000, y)).toBe(true);
    expect(wrappedDeltaX(990, 10)).toBeCloseTo(20);
    expect(wrappedDeltaX(10, 990)).toBeCloseTo(-20);
    expect(headingTowards([990, 100], [10, 100])).toBeCloseTo(0);
  });

  it("counts a touch when the plane's edge crosses the border", () => {
    const [edgeX, y] = at(10, 5);
    expect(countryContainsPoint(byCode("AA"), edgeX + 1.5, y)).toBe(false);
    expect(planeTouchesCountry(byCode("AA"), edgeX + 1.5, y)).toBe(true);
    expect(planeTouchesCountry(byCode("AA"), edgeX + 6, y)).toBe(false);
  });
});

describe("flyover flight", () => {
  it("flies forward at cruising speed and turns at the turn rate", () => {
    const moved = stepPlane({ x: 500, y: 250, heading: 0 }, { turn: 0 }, 1);
    expect(moved.x).toBeCloseTo(500 + FLYOVER_SPEED);
    expect(moved.y).toBeCloseTo(250);
    const turned = stepPlane({ x: 500, y: 250, heading: 0 }, { turn: 1 }, 0.1);
    expect(turned.heading).toBeCloseTo(FLYOVER_TURN_RATE * 0.1);
    const boosted = stepPlane({ x: 500, y: 250, heading: 0 }, { turn: 0, boost: true }, 1);
    expect(boosted.x - 500).toBeGreaterThan(FLYOVER_SPEED);
  });

  it("turns towards a pointer heading without overshooting", () => {
    const plane = stepPlane({ x: 500, y: 250, heading: 0 }, { turn: 0, towards: 0.05 }, 1);
    expect(plane.heading).toBeCloseTo(0.05);
    const long = stepPlane({ x: 500, y: 250, heading: 0 }, { turn: 0, towards: -Math.PI / 2 }, 0.1);
    expect(long.heading).toBeCloseTo(-FLYOVER_TURN_RATE * 0.1);
  });

  it("wraps around the world and bounces off the top and bottom", () => {
    expect(stepPlane({ x: 995, y: 250, heading: 0 }, { turn: 0 }, 0.5).x).toBeCloseTo(995 + FLYOVER_SPEED * 0.5 - 1000);
    const bounced = stepPlane({ x: 500, y: 7, heading: -Math.PI / 2 }, { turn: 0 }, 0.5);
    expect(bounced.y).toBeGreaterThanOrEqual(6);
    expect(bounced.heading).toBeCloseTo(Math.PI / 2);
  });
});

describe("flyover targets", () => {
  it("picks a nearby unvisited country that isn't under the plane, never a tiny one", () => {
    const from = byCode("AA").centre;
    const picked = pickNextTarget(countries, from, new Set(["AA"]), () => 0);
    expect(picked?.code).toBe("BB");
    for (let i = 0; i < 20; i++) expect(pickNextTarget(countries, from, new Set(), () => i / 20)?.code).not.toMatch(/AA|TT/);
  });

  it("returns null once every target has been visited", () => {
    const all = new Set(countries.map((country) => country.code));
    expect(pickNextTarget(countries, [500, 250], all)).toBeNull();
  });

  it("has a score board capped at the number of countries", () => {
    expect(leaderboardConfig("flyover")).toMatchObject({ metric: "score", maxScore: FLYOVER_MAX_SCORE });
  });
});
