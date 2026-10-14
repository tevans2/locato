import { describe, expect, it } from "vitest";
import { COUNTRY_BORDERS } from "../src/core/countries/borders.data";
import { GENERATED_COUNTRY_PROFILES } from "../src/core/countries/profiles.data";
import { fameTier } from "../src/core/countries/fame";
import { indexCountries, rawCountries } from "../src/core/countries";
import { OVERLAND_ATTEMPT_ROUTES, leaderboardConfig } from "../src/core/leaderboards";
import {
  EXCLAVE_BORDERS,
  OVERLAND_MAX_HINTS,
  OVERLAND_ROUTE_MAX_POINTS,
  OVERLAND_ROUTE_PLAN,
  createBorderGraph,
  createOverlandRound,
  createOverlandRoutes,
  exclaveNotesFor,
  guessOverland,
  hintOverland,
  isPerfectOverlandRound,
  overlandBestRoute,
  overlandGraph,
  overlandGuessAllowance,
  overlandMissingCountries,
  overlandPlayerRoute,
  overlandRouteCandidates,
  overlandRoundPoints,
  overlandShareLine,
  overlandVerdict,
  resolveCountryName,
  revealOverland,
  suggestCountryNames,
  type OverlandRound,
  type OverlandRoute,
} from "../src/core/overland";

const graph = overlandGraph();
const index = indexCountries(rawCountries);
const route = (start: string, end: string): OverlandRoute => {
  const minimum = graph.distance(start, end)! - 1;
  return { start, end, minimum, guessesAllowed: overlandGuessAllowance(minimum) };
};
function play(round: OverlandRound, ...codes: string[]): OverlandRound {
  for (const code of codes) {
    const result = guessOverland(graph, round, code);
    if ("error" in result) throw new Error(`${code}: ${result.error}`);
    round = result.round;
  }
  return round;
}

describe("Overland border data", () => {
  it("is the profiles' land borders, symmetric, for every playable country", () => {
    expect(Object.keys(COUNTRY_BORDERS)).toHaveLength(rawCountries.length);
    for (const [code, profile] of Object.entries(GENERATED_COUNTRY_PROFILES)) {
      expect(COUNTRY_BORDERS[code]).toEqual(profile.borders);
      for (const neighbour of profile.borders) expect(COUNTRY_BORDERS[neighbour]).toContain(code);
    }
  });

  it("lists every exclave border as a real border", () => {
    for (const { countries: [a, b] } of EXCLAVE_BORDERS) expect(graph.areNeighbours(a, b)).toBe(true);
    expect(exclaveNotesFor(["DE", "PL", "RU", "GE"])).toEqual(["Russia's Kaliningrad exclave borders Poland."]);
    expect(exclaveNotesFor(["PT", "ES", "FR", "DE"])).toEqual([]);
  });
});

describe("Overland border graph", () => {
  const tiny = createBorderGraph({ A: ["B", "C"], B: ["A", "D"], C: ["A", "D"], D: ["B", "C", "E"], E: ["D"], F: [] });

  it("measures routes in border crossings", () => {
    expect(tiny.distance("A", "E")).toBe(3);
    expect(tiny.distance("A", "A")).toBe(0);
    expect(tiny.distance("A", "F")).toBeNull();
    expect(tiny.routeCountries("A", "E")).toEqual(["B", "C", "D"]);
    expect(tiny.excess("B", "C", "D")).toBe(0);
    expect(tiny.excess("A", "E", "F")).toBeNull();
    expect(graph.distance("ES", "DE")).toBe(2);
    expect(graph.routeCountries("ES", "DE")).toEqual(["FR"]);
    expect(graph.distance("PT", "PL")).toBe(4);
    expect(graph.distance("GB", "FR")).toBeNull();
  });

  it("joins endpoints only through the allowed countries", () => {
    expect(tiny.connects("A", "E", ["B", "D"])).toBe(true);
    expect(tiny.connects("A", "E", ["B"])).toBe(false);
    expect(tiny.routeWithin("A", "E", ["C", "D", "B"])).toEqual(["A", "B", "D", "E"]);
    expect(tiny.routeWithin("A", "F", ["B", "C", "D", "E"])).toBeNull();
  });

  it("picks the shortest route that keeps the most preferred countries", () => {
    expect(tiny.shortestRoute("A", "E")).toEqual(["A", "B", "D", "E"]);
    expect(tiny.shortestRoute("A", "E", new Set(["C"]))).toEqual(["A", "C", "D", "E"]);
    expect(tiny.shortestRoute("A", "E", new Set(), (code) => (code === "C" ? 0 : 1))).toEqual(["A", "C", "D", "E"]);
    expect(graph.shortestRoute("PT", "PL")).toEqual(["PT", "ES", "FR", "DE", "PL"]);
  });

  it("counts and lists every shortest route", () => {
    expect(tiny.countShortestRoutes("A", "E")).toBe(2);
    expect(tiny.shortestRoutes("A", "E", 5)).toEqual([["A", "B", "D", "E"], ["A", "C", "D", "E"]]);
    expect(tiny.shortestRoutes("A", "E", 1)).toEqual([["A", "B", "D", "E"]]);
    expect(tiny.countShortestRoutes("A", "F")).toBe(0);
    expect(tiny.shortestRoutes("A", "F", 5)).toEqual([]);
    expect(graph.countShortestRoutes("ES", "DE")).toBe(1);
    const balkans = graph.shortestRoutes("AT", "BG", 10);
    expect(balkans).toHaveLength(graph.countShortestRoutes("AT", "BG"));
    expect(balkans).toContainEqual(["AT", "HU", "RS", "BG"]);
    expect(balkans).toContainEqual(["AT", "HU", "RO", "BG"]);
  });
});

describe("Overland verdicts", () => {
  const spainToGermany = route("ES", "DE");

  it("rates a guess by how much longer the best route through it is", () => {
    expect(overlandVerdict(graph, spainToGermany, "FR")).toBe("route");
    expect(overlandVerdict(graph, spainToGermany, "BE")).toBe("close");
    expect(overlandVerdict(graph, spainToGermany, "IT")).toBe("detour");
    expect(overlandVerdict(graph, spainToGermany, "RU")).toBe("off");
    expect(overlandVerdict(graph, spainToGermany, "JP")).toBe("off");
  });
});

describe("Overland rounds", () => {
  const portugalToPoland = route("PT", "PL");

  it("is solved once the guesses join the ends, in any order", () => {
    let round = createOverlandRound(portugalToPoland);
    round = play(round, "DE", "ES");
    expect(round.status).toBe("playing");
    round = play(round, "FR");
    expect(round.status).toBe("solved");
    expect(overlandRoundPoints(round)).toBe(OVERLAND_ROUTE_MAX_POINTS);
    expect(isPerfectOverlandRound(round)).toBe(true);
    expect(overlandPlayerRoute(graph, round)).toEqual(["PT", "ES", "FR", "DE", "PL"]);
    expect(overlandShareLine(round)).toBe("🟩🟩🟩 +100");
  });

  it("accepts a longer route, at a cost per extra guess", () => {
    const round = play(createOverlandRound(portugalToPoland), "ES", "FR", "CH", "AT", "CZ");
    expect(round.status).toBe("solved");
    expect(round.guesses.map((guess) => guess.verdict)).toEqual(["route", "route", "close", "detour", "close"]);
    expect(overlandRoundPoints(round)).toBe(80);
    expect(overlandPlayerRoute(graph, round)).toEqual(["PT", "ES", "FR", "CH", "AT", "CZ", "PL"]);
  });

  it("rejects the ends, repeats and unknown countries without using a guess", () => {
    const round = play(createOverlandRound(portugalToPoland), "ES");
    expect(guessOverland(graph, round, "PT")).toEqual({ error: "endpoint" });
    expect(guessOverland(graph, round, "ES")).toEqual({ error: "repeat" });
    expect(guessOverland(graph, round, "XX")).toEqual({ error: "unknown" });
    expect(round.guesses).toHaveLength(1);
  });

  it("fails when the last allowed guess doesn't finish the route", () => {
    const wrong = ["JP", "AU", "BR", "AR", "CL", "PE", "CO"].slice(0, portugalToPoland.guessesAllowed);
    const round = play(createOverlandRound(portugalToPoland), ...wrong);
    expect(round.status).toBe("failed");
    expect(overlandRoundPoints(round)).toBe(0);
    expect(guessOverland(graph, round, "ES")).toEqual({ error: "finished" });
    expect(overlandShareLine(round)).toBe("🟥🟥🟥🟥🟥🟥🟥 —");
  });

  it("gives three hints in order, each stronger, at a cost", () => {
    let round = play(createOverlandRound(portugalToPoland), "ES");
    expect(overlandMissingCountries(graph, round)).toEqual(["FR", "DE"]);
    for (const [level, outlined] of [[1, ["FR"]], [2, ["FR", "DE"]], [3, ["FR", "DE"]]] as const) {
      const result = hintOverland(graph, round);
      if ("error" in result) throw new Error(result.error);
      expect(result.hint).toEqual({ level, outlined });
      round = result.round;
    }
    expect(hintOverland(graph, round)).toEqual({ error: "no-hints" });
    expect(round.hintsUsed).toBe(OVERLAND_MAX_HINTS);
    round = play(round, "FR", "DE");
    expect(overlandRoundPoints(round)).toBe(OVERLAND_ROUTE_MAX_POINTS - 3 * 15);
    expect(overlandShareLine(round)).toBe("🟩🟩🟩 💡💡💡 +55");
  });

  it("points hints along the route the player is already building", () => {
    // Germany → Hungary: through Austria or through Czechia and Slovakia? Austria is shorter.
    const round = play(createOverlandRound(route("DE", "HU")), "PL");
    expect(overlandBestRoute(graph, round)).toEqual(["DE", "AT", "HU"]);
    // Austria → Bulgaria crosses Hungary, then Serbia or Romania: whichever the player named.
    expect(overlandBestRoute(graph, play(createOverlandRound(route("AT", "BG")), "RS"))).toEqual(["AT", "HU", "RS", "BG"]);
    expect(overlandBestRoute(graph, play(createOverlandRound(route("AT", "BG")), "RO"))).toEqual(["AT", "HU", "RO", "BG"]);
  });

  it("never scores a found route below the floor, and nothing once given up", () => {
    const given = revealOverland(play(createOverlandRound(portugalToPoland), "ES"));
    expect(given.status).toBe("revealed");
    expect(overlandRoundPoints(given)).toBe(0);
    let round = createOverlandRound({ ...portugalToPoland, guessesAllowed: 20 });
    round = play(round, "JP", "AU", "BR", "AR", "CL", "PE", "CO");
    for (let hint = 0; hint < OVERLAND_MAX_HINTS; hint++) round = (hintOverland(graph, round) as { round: OverlandRound }).round;
    round = play(round, "ES", "FR", "DE");
    expect(round.status).toBe("solved");
    expect(overlandRoundPoints(round)).toBe(10);
  });
});

describe("Overland runs", () => {
  it("deals the same five routes for the same seed", () => {
    const routes = createOverlandRoutes("seed-a");
    expect(routes).toHaveLength(OVERLAND_ATTEMPT_ROUTES);
    expect(createOverlandRoutes("seed-a")).toEqual(routes);
    expect(createOverlandRoutes("seed-b")).not.toEqual(routes);
  });

  it("makes every route fair: the planned length, known ends, no exclave shortcut needed", () => {
    for (const seed of ["one", "two", "three", "four", "five", "six"]) {
      const routes = createOverlandRoutes(seed);
      const ends = routes.flatMap((item) => [item.start, item.end]);
      expect(new Set(ends).size).toBe(ends.length);
      routes.forEach((item, position) => {
        const step = OVERLAND_ROUTE_PLAN[position]!;
        expect(item.minimum).toBe(step.minimum);
        expect(graph.distance(item.start, item.end)).toBe(step.minimum + 1);
        expect(item.guessesAllowed).toBe(overlandGuessAllowance(step.minimum));
        expect(fameTier(item.start)).toBeLessThanOrEqual(step.endpointTier);
        expect(fameTier(item.end)).toBeLessThanOrEqual(step.endpointTier);
      });
    }
  });

  it("only deals routes that have a shortest route without exclave borders", () => {
    const exclaveFree = createBorderGraph(Object.fromEntries(Object.entries(COUNTRY_BORDERS).map(([code, neighbours]) => [
      code, neighbours.filter((neighbour) => !EXCLAVE_BORDERS.some(({ countries: [a, b] }) => (a === code && b === neighbour) || (b === code && a === neighbour))),
    ])));
    for (const step of OVERLAND_ROUTE_PLAN) {
      const candidates = overlandRouteCandidates(step);
      expect(candidates.length).toBeGreaterThan(100);
      for (const { start, end } of candidates) expect(exclaveFree.distance(start, end)).toBe(step.minimum + 1);
    }
    expect(overlandRouteCandidates(OVERLAND_ROUTE_PLAN[4]!)).not.toContainEqual({ start: "DE", end: "LB" });
  });

  it("matches the leaderboard's attempt", () => {
    expect(OVERLAND_ROUTE_PLAN).toHaveLength(OVERLAND_ATTEMPT_ROUTES);
    expect(leaderboardConfig("overland")).toMatchObject({ metric: "score", runs: "single", maxScore: OVERLAND_ATTEMPT_ROUTES * OVERLAND_ROUTE_MAX_POINTS });
  });
});

describe("Overland guess names", () => {
  it("resolves names, aliases, codes and small typos to one country", () => {
    expect(resolveCountryName(index, "France")?.code).toBe("FR");
    expect(resolveCountryName(index, "  czech republic ")?.code).toBe("CZ");
    expect(resolveCountryName(index, "de")?.code).toBe("DE");
    expect(resolveCountryName(index, "Swizterland")?.code).toBe("CH");
    expect(resolveCountryName(index, "Atlantis")).toBeNull();
  });

  it("offers names that start with what's typed first, leaving out the excluded ones", () => {
    expect(suggestCountryNames(index, "g")).toEqual([]);
    expect(suggestCountryNames(index, "ger").map((country) => country.code)).toEqual(["DE"]);
    expect(suggestCountryNames(index, "guinea").map((country) => country.code).slice(0, 2)).toEqual(["GN", "GW"]);
    expect(suggestCountryNames(index, "sou", new Set(["ZA"])).map((country) => country.code)).not.toContain("ZA");
    expect(suggestCountryNames(index, "korea").map((country) => country.code).sort()).toEqual(["KP", "KR"]);
  });
});
