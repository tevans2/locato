import { COUNTRY_BORDERS } from "../countries/borders.data";

/**
 * The land-border graph Overland is played on: one node per country, one edge per shared land
 * border (src/core/countries/borders.data.ts, generated with the country profiles). Island
 * nations have no edges, so no route starts, ends or passes through them.
 *
 * Distances count border crossings: neighbours are 1 apart, and a route with `n` countries in
 * between is `n + 1` apart.
 */
export interface BorderGraph {
  /** Every country in the graph, sorted by code. */
  readonly codes: readonly string[];
  readonly has: (code: string) => boolean;
  readonly neighbours: (code: string) => readonly string[];
  readonly areNeighbours: (a: string, b: string) => boolean;
  /** Border crossings on the shortest land route, or null when there is none (an island). */
  readonly distance: (from: string, to: string) => number | null;
  /**
   * How many crossings longer than the shortest `start` → `end` route a detour through `via`
   * is: 0 when `via` lies on a shortest route, null when no land route passes through it.
   */
  readonly excess: (start: string, end: string, via: string) => number | null;
  /** Every country (endpoints excluded) on at least one shortest route, nearest `start` first. */
  readonly routeCountries: (start: string, end: string) => readonly string[];
  /** True when `start` and `end` are joined by land using only countries from `via`. */
  readonly connects: (start: string, end: string, via: Iterable<string>) => boolean;
  /** The shortest route that only passes through `via` (endpoints included), or null. */
  readonly routeWithin: (start: string, end: string, via: Iterable<string>) => readonly string[] | null;
  /**
   * One shortest route (endpoints included), chosen to share as many countries with `prefer`
   * as possible; ties go to better-known countries (lower `rank`), then alphabetical order.
   */
  readonly shortestRoute: (start: string, end: string, prefer?: ReadonlySet<string>, rank?: (code: string) => number) => readonly string[] | null;
}

export function createBorderGraph(borders: Readonly<Record<string, readonly string[]>>): BorderGraph {
  const adjacency = new Map<string, readonly string[]>();
  for (const [code, neighbours] of Object.entries(borders)) adjacency.set(code, [...neighbours].sort());
  const codes = [...adjacency.keys()].sort();
  const distanceCache = new Map<string, ReadonlyMap<string, number>>();

  const neighbours = (code: string): readonly string[] => adjacency.get(code) ?? [];

  function distancesFrom(source: string): ReadonlyMap<string, number> {
    const cached = distanceCache.get(source);
    if (cached) return cached;
    const distances = new Map<string, number>();
    if (adjacency.has(source)) {
      distances.set(source, 0);
      const queue = [source];
      for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head]!;
        const next = distances.get(current)! + 1;
        for (const neighbour of neighbours(current)) {
          if (distances.has(neighbour)) continue;
          distances.set(neighbour, next);
          queue.push(neighbour);
        }
      }
    }
    distanceCache.set(source, distances);
    return distances;
  }

  function distance(from: string, to: string): number | null {
    return distancesFrom(from).get(to) ?? null;
  }

  function excess(start: string, end: string, via: string): number | null {
    const total = distance(start, end);
    const toVia = distance(start, via);
    const fromVia = distance(via, end);
    if (total === null || toVia === null || fromVia === null) return null;
    return toVia + fromVia - total;
  }

  function routeCountries(start: string, end: string): readonly string[] {
    const total = distance(start, end);
    if (total === null) return [];
    const fromStart = distancesFrom(start);
    const fromEnd = distancesFrom(end);
    return codes
      .filter((code) => code !== start && code !== end && (fromStart.get(code) ?? Infinity) + (fromEnd.get(code) ?? Infinity) === total)
      .sort((a, b) => fromStart.get(a)! - fromStart.get(b)! || a.localeCompare(b));
  }

  function routeWithin(start: string, end: string, via: Iterable<string>): readonly string[] | null {
    if (!adjacency.has(start) || !adjacency.has(end)) return null;
    const allowed = new Set(via);
    allowed.add(start);
    allowed.add(end);
    const previous = new Map<string, string | null>([[start, null]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]!;
      if (current === end) break;
      for (const neighbour of neighbours(current)) {
        if (!allowed.has(neighbour) || previous.has(neighbour)) continue;
        previous.set(neighbour, current);
        queue.push(neighbour);
      }
    }
    if (!previous.has(end)) return null;
    const path: string[] = [];
    for (let step: string | null = end; step !== null; step = previous.get(step) ?? null) path.push(step);
    return path.reverse();
  }

  function shortestRoute(start: string, end: string, prefer: ReadonlySet<string> = new Set(), rank: (code: string) => number = () => 0): readonly string[] | null {
    const total = distance(start, end);
    if (total === null) return null;
    if (total === 0) return [start];
    const fromStart = distancesFrom(start);
    const fromEnd = distancesFrom(end);
    const onRoute = (code: string, step: number) => fromStart.get(code) === step && fromEnd.get(code) === total - step;
    // Walk back from the end: best[code] is the most preferred countries on any shortest route
    // from `code` to `end`, so each forward step can pick the neighbour that keeps the most.
    const best = new Map<string, number>([[end, 0]]);
    for (let step = total - 1; step >= 0; step -= 1) {
      const layer = step === 0 ? [start] : codes.filter((code) => onRoute(code, step));
      for (const code of layer) {
        const onward = neighbours(code).filter((next) => best.has(next) && onRoute(next, step + 1));
        if (onward.length === 0) continue;
        best.set(code, Math.max(...onward.map((next) => best.get(next)!)) + (prefer.has(code) ? 1 : 0));
      }
    }
    const path = [start];
    for (let step = 1; step <= total; step += 1) {
      const current = path[path.length - 1]!;
      const options = neighbours(current).filter((next) => best.has(next) && onRoute(next, step));
      options.sort((a, b) => best.get(b)! - best.get(a)! || rank(a) - rank(b) || a.localeCompare(b));
      path.push(options[0]!);
    }
    return path;
  }

  return {
    codes,
    has: (code) => adjacency.has(code),
    neighbours,
    areNeighbours: (a, b) => neighbours(a).includes(b),
    distance,
    excess,
    routeCountries,
    connects: (start, end, via) => routeWithin(start, end, via) !== null,
    routeWithin,
    shortestRoute,
  };
}

let sharedGraph: BorderGraph | null = null;

/** The world's land-border graph (built once, on first use). */
export function overlandGraph(): BorderGraph {
  sharedGraph ??= createBorderGraph(COUNTRY_BORDERS);
  return sharedGraph;
}
