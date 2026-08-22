import { describe, expect, it } from "vitest";
import { rawCountries } from "../src/core/countries";
import {
  WORLD_SPLIT_POPULATION_MILLIONS,
  extendSplitLineToMap,
  scoreWorldSplit,
  type WorldSplitCountryPoint,
  type WorldSplitRound,
} from "../src/core/worldsplit";

const testRound: WorldSplitRound = {
  id: "test",
  label: "Test",
  prompt: "Test split",
  detail: "Test split",
  continents: null,
};

function country(code: string, x: number, populationMillions: number): WorldSplitCountryPoint {
  return { code, name: code, continent: "Test", point: [x, 5], populationMillions };
}

describe("Worldsplit", () => {
  it("has a stable population weight for every playable country", () => {
    const missing = rawCountries.filter((item) => WORLD_SPLIT_POPULATION_MILLIONS[item.code] === undefined).map((item) => item.code);
    expect(missing).toEqual([]);
    expect(Object.keys(WORLD_SPLIT_POPULATION_MILLIONS)).toHaveLength(rawCountries.length);
  });

  it("awards 100 points for a perfect half", () => {
    const result = scoreWorldSplit([country("AA", -1, 50), country("BB", 1, 50)], testRound, [[0, 0], [0, 10]]);
    expect(result.sideAPercent).toBe(50);
    expect(result.sideBPercent).toBe(50);
    expect(result.score).toBe(100);
  });

  it("penalises each percentage point away from half", () => {
    const result = scoreWorldSplit([country("AA", -1, 60), country("BB", 1, 40)], testRound, [[0, 0], [0, 10]]);
    expect(result.errorPercentagePoints).toBe(10);
    expect(result.score).toBe(60);
  });

  it("extends a player segment to both edges of the map", () => {
    const [start, end] = extendSplitLineToMap([[250, 125], [750, 375]]);
    expect(start[0] === 0 || start[0] === 1000 || start[1] === 0 || start[1] === 500).toBe(true);
    expect(end[0] === 0 || end[0] === 1000 || end[1] === 0 || end[1] === 500).toBe(true);
  });
});
