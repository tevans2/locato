import { expect, it } from "vitest";
import { AuthoritativeFlight, parsePlaneInput } from "../server/ranked/AuthoritativeFlight";
import { createSeededRandom } from "../src/core/game";
import { buildFlyoverCountries, FLYOVER_SPEED, FLYOVER_BOOST, FLYOVER_TURN_RATE } from "../src/core/flyover";
import { rankedWorld } from "../server/ranked/assets";
import { FLYOVER_MAX_SCORE } from "../src/core/leaderboards";

it("uses fixed speed and turning regardless of input request frequency", () => {
  const flight = new AuthoritativeFlight([], createSeededRandom("test"), 0, 90_000, { x: 500, y: 250, heading: 0 }, []);
  for (let i = 0; i < 1000; i++) flight.steer({ turn: 0, boost: true }, 0);
  expect(flight.plane).toEqual({ x: 500, y: 250, heading: 0 });
  flight.advance(500);
  expect(flight.plane.x).toBeCloseTo(500 + FLYOVER_SPEED * FLYOVER_BOOST / 2, 5);
  flight.steer({ turn: 1, boost: false }, 500);
  flight.advance(750);
  expect(flight.plane.heading).toBeCloseTo(FLYOVER_TURN_RATE / 4, 5);
  expect(parsePlaneInput({ turn: 0, speed: 500, radius: 1000 })).toBeNull();
});

it("does not bank disconnected time for later steering", () => {
  const flight = new AuthoritativeFlight([], createSeededRandom("test"), 0, 90_000, { x: 500, y: 250, heading: 0 }, []);
  flight.advance(20_000);
  const before = flight.plane.x;
  flight.steer({ turn: 0, boost: true }, 30_000);
  expect(flight.plane.x).toBe(before);
  flight.advance(30_500);
  expect(flight.plane.x - before).toBeCloseTo(FLYOVER_SPEED * FLYOVER_BOOST / 2);
});

it("matches the ranked score limit to the actual targetable map", () => {
  const countries = buildFlyoverCountries(rankedWorld());
  expect(countries).toHaveLength(196);
  expect(countries.filter((c) => c.targetable)).toHaveLength(FLYOVER_MAX_SCORE);
});
