import { COUNTRY_BORDERS } from "../countries/borders.data";
import { rawCountries } from "../countries/countries";
import { fameTier, type FameTier } from "../countries/fame";
import { createSeededRandom, shuffle } from "../game/random";
import { createBorderGraph, overlandGraph, type BorderGraph } from "./graph";

/** One Overland puzzle: get from `start` to `end` by land. */
export interface OverlandRoute {
  readonly start: string;
  readonly end: string;
  /** Countries in between on the shortest land route (the endpoints not counted). */
  readonly minimum: number;
  /** Guesses allowed: the minimum plus a few spare. */
  readonly guessesAllowed: number;
}

/** Spare guesses on top of the shortest route's length; long routes get one more per three countries past two. */
export const OVERLAND_SPARE_GUESSES = 4;

export function overlandGuessAllowance(minimum: number): number {
  return minimum + OVERLAND_SPARE_GUESSES + Math.floor(Math.max(0, minimum - 2) / 3);
}

/**
 * Borders that only exist through an exclave. They're real land borders, so guesses that use
 * them count, but they make surprising shortcuts (Germany to Lebanon through Kaliningrad), so a
 * route is only dealt when a shortest route also exists without them. The notes explain them
 * when one turns up in a revealed route.
 */
export const EXCLAVE_BORDERS: readonly { readonly countries: readonly [string, string]; readonly note: string }[] = [
  { countries: ["ES", "MA"], note: "Spain's North African cities, Ceuta and Melilla, border Morocco." },
  { countries: ["LT", "RU"], note: "Russia's Kaliningrad exclave borders Lithuania." },
  { countries: ["PL", "RU"], note: "Russia's Kaliningrad exclave borders Poland." },
  { countries: ["AZ", "TR"], note: "Azerbaijan's Nakhchivan exclave has a short border with Turkiye." },
  { countries: ["AO", "CG"], note: "Angola's Cabinda exclave borders the Republic of the Congo." },
];

/** The note for a border crossed only through an exclave, or null for an ordinary border. */
export function exclaveBorderNote(a: string, b: string): string | null {
  return EXCLAVE_BORDERS.find(({ countries: [x, y] }) => (x === a && y === b) || (x === b && y === a))?.note ?? null;
}

/** Notes for every exclave border crossed along `route` (a list of neighbouring countries). */
export function exclaveNotesFor(route: readonly string[]): readonly string[] {
  const notes: string[] = [];
  for (let index = 1; index < route.length; index += 1) {
    const note = exclaveBorderNote(route[index - 1]!, route[index]!);
    if (note && !notes.includes(note)) notes.push(note);
  }
  return notes;
}

let mainlandGraph: BorderGraph | null = null;

/** The border graph without exclave-only borders (used to deal routes, never to judge guesses). */
function withoutExclaves(): BorderGraph {
  if (!mainlandGraph) {
    const borders: Record<string, readonly string[]> = {};
    for (const [code, neighbours] of Object.entries(COUNTRY_BORDERS)) {
      borders[code] = neighbours.filter((neighbour) => exclaveBorderNote(code, neighbour) === null);
    }
    mainlandGraph = createBorderGraph(borders);
  }
  return mainlandGraph;
}

/** How hard one route of a run is: its length, and how well known its countries must be. */
export interface OverlandRouteStep {
  /** Countries in between on the shortest route. */
  readonly minimum: number;
  /** Start and end are at least this famous (src/core/countries/fame.ts: 1 = household names). */
  readonly endpointTier: FameTier;
  /** Some shortest route passes only through countries at least this famous. */
  readonly pathTier: FameTier;
}

/**
 * A run: five routes, each one country longer than the last. The first stays among household
 * names; the last two may pass through anywhere.
 */
export const OVERLAND_ROUTE_PLAN: readonly OverlandRouteStep[] = [
  { minimum: 2, endpointTier: 2, pathTier: 1 },
  { minimum: 3, endpointTier: 2, pathTier: 2 },
  { minimum: 4, endpointTier: 2, pathTier: 2 },
  { minimum: 5, endpointTier: 2, pathTier: 3 },
  { minimum: 6, endpointTier: 2, pathTier: 3 },
];

interface Candidate {
  readonly a: string;
  readonly b: string;
  /** Continents of the two ends, so consecutive routes can visit different parts of the world. */
  readonly region: string;
}

const continentByCode = new Map<string, string>(rawCountries.map((country) => [country.code, country.continent]));
const candidateCache = new Map<string, readonly Candidate[]>();

/** Every pair of countries that makes a fair route for `step`, in a stable order. */
export function overlandRouteCandidates(step: OverlandRouteStep): readonly { readonly start: string; readonly end: string }[] {
  return candidatesFor(step).map(({ a, b }) => ({ start: a, end: b }));
}

function candidatesFor(step: OverlandRouteStep): readonly Candidate[] {
  const key = `${step.minimum}:${step.endpointTier}:${step.pathTier}`;
  const cached = candidateCache.get(key);
  if (cached) return cached;
  const graph = overlandGraph();
  const mainland = withoutExclaves();
  const crossings = step.minimum + 1;
  const famousEnough = graph.codes.filter((code) => fameTier(code) <= step.pathTier);
  const endpoints = graph.codes.filter((code) => fameTier(code) <= step.endpointTier);
  const candidates: Candidate[] = [];
  for (const a of endpoints) {
    for (const b of endpoints) {
      if (a >= b || graph.distance(a, b) !== crossings || mainland.distance(a, b) !== crossings) continue;
      if (step.pathTier < 3 && (mainland.routeWithin(a, b, famousEnough)?.length ?? 0) !== crossings + 1) continue;
      candidates.push({ a, b, region: [continentByCode.get(a) ?? "", continentByCode.get(b) ?? ""].sort().join("/") });
    }
  }
  candidateCache.set(key, candidates);
  return candidates;
}

/**
 * Deal a run's routes from `seed`: the same seed always deals the same routes. No country starts
 * or ends two routes, and consecutive routes come from different parts of the world when possible.
 */
export function createOverlandRoutes(seed: string, plan: readonly OverlandRouteStep[] = OVERLAND_ROUTE_PLAN): readonly OverlandRoute[] {
  const random = createSeededRandom(`overland:${seed}`);
  const usedEnds = new Set<string>();
  let previousRegion = "";
  return plan.map((step) => {
    const pool = shuffle(candidatesFor(step), random);
    if (pool.length === 0) throw new Error(`No Overland route has ${step.minimum} countries in between.`);
    const fresh = pool.filter((candidate) => !usedEnds.has(candidate.a) && !usedEnds.has(candidate.b));
    const pick = fresh.find((candidate) => candidate.region !== previousRegion) ?? fresh[0] ?? pool[0]!;
    usedEnds.add(pick.a);
    usedEnds.add(pick.b);
    previousRegion = pick.region;
    const [start, end] = random() < 0.5 ? [pick.a, pick.b] : [pick.b, pick.a];
    return { start, end, minimum: step.minimum, guessesAllowed: overlandGuessAllowance(step.minimum) };
  });
}

/** The route between two countries with its usual guess allowance (null when no land route joins them). */
export function overlandRouteBetween(start: string, end: string): OverlandRoute | null {
  const crossings = overlandGraph().distance(start, end);
  if (crossings === null || crossings < 2) return null;
  return { start, end, minimum: crossings - 1, guessesAllowed: overlandGuessAllowance(crossings - 1) };
}

function pickRoute(steps: readonly OverlandRouteStep[], seed: string, accept: (candidate: Candidate) => boolean = () => true): OverlandRoute | null {
  const random = createSeededRandom(seed);
  for (const step of steps) {
    const pick = shuffle(candidatesFor(step), random).find(accept);
    if (pick) {
      const [start, end] = random() < 0.5 ? [pick.a, pick.b] : [pick.b, pick.a];
      return { start, end, minimum: step.minimum, guessesAllowed: overlandGuessAllowance(step.minimum) };
    }
  }
  return null;
}

/** Today's route lengths by weekday (Sunday first): short early in the week, longest at the weekend. */
const TODAY_ROUTE_LENGTHS: readonly number[] = [6, 3, 3, 4, 4, 5, 5];

/**
 * "Today's route" in Overland: one route for everyone on a date (YYYY-MM-DD), Travle-style.
 * Routes run from three countries in between on Mondays to six on Sundays.
 */
export function createDailyOverlandRoute(date: string): OverlandRoute {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const minimum = TODAY_ROUTE_LENGTHS[Number.isFinite(day) ? day : 1]!;
  const pathTier: FameTier = minimum >= 5 ? 3 : 2;
  return pickRoute([{ minimum, endpointTier: 2, pathTier }, { minimum, endpointTier: 2, pathTier: 3 }], `overland-today:${date}`)!;
}

/**
 * The Overland round of the daily challenge: a short route (two or three countries in between)
 * between two of the day's theme countries, or from one of them when the theme is mostly islands.
 */
export function createThemedOverlandRoute(themeCountryCodes: readonly string[], seed: string): OverlandRoute {
  const theme = new Set(themeCountryCodes);
  const steps: readonly OverlandRouteStep[] = [2, 3].map((minimum) => ({ minimum, endpointTier: 2, pathTier: 2 }));
  return pickRoute(steps, `${seed}:overland`, (candidate) => theme.has(candidate.a) && theme.has(candidate.b))
    ?? pickRoute(steps, `${seed}:overland`, (candidate) => theme.has(candidate.a) || theme.has(candidate.b))
    ?? pickRoute(steps, `${seed}:overland`)!;
}
