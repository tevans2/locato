import { MAP_VIEWBOX_HEIGHT, MAP_VIEWBOX_WIDTH, projectWorldMapPosition, type ProjectedPoint, type WorldCountryFeature, type WorldMapPolygon } from "../map";
import { FLYOVER_ATTEMPT_SECONDS } from "../leaderboards";

/**
 * Flyover: a plane flies over the world map at a constant speed and you steer it over the named
 * country. Each country you reach scores a point and names the next one; the run ends when the
 * clock does. Everything here works in the world map's projected units (1000 × 500, the same
 * equirectangular projection as the other map modes), and the map wraps east–west.
 */

export const FLYOVER_RUN_SECONDS = FLYOVER_ATTEMPT_SECONDS;
/** Cruising speed, in map units per second (the map is 1000 units round the world). */
export const FLYOVER_SPEED = 42;
/** Holding boost multiplies the speed by this. */
export const FLYOVER_BOOST = 1.9;
/** How fast the plane turns, in radians per second. */
export const FLYOVER_TURN_RATE = Math.PI * 0.95;
/** Skipping a country costs this many seconds off the clock. */
export const FLYOVER_SKIP_PENALTY_SECONDS = 5;
/** After this long on one country, a compass arrow points the way. */
export const FLYOVER_HINT_AFTER_SECONDS = 15;
/** The plane touches a country if any point within this radius of it is inside the country. */
export const FLYOVER_TOUCH_RADIUS = 2.2;
/** Countries smaller than this (projected units²) are too small to see at flying zoom: never targets. */
const MIN_TARGET_AREA = 3;
/** New targets are picked among the nearest few unvisited countries at least this far away. */
const MIN_TARGET_DISTANCE = 22;
const NEAREST_TARGET_CHOICES = 14;
/** Keep the plane off the very top and bottom of the map (the projection stops at 85°N / 60°S). */
const EDGE_MARGIN = 6;

export type Rng = () => number;

export interface FlyoverCountry {
  readonly code: string;
  readonly name: string;
  readonly continent: string;
  /** Projected rings (the first ring of each polygon is its outline, the rest are holes). */
  readonly polygons: readonly (readonly (readonly ProjectedPoint[])[])[];
  /** [minX, minY, maxX, maxY] over every polygon. */
  readonly bounds: readonly [number, number, number, number];
  /** Centre of the largest polygon: where "the country" is when picking nearby targets. */
  readonly centre: ProjectedPoint;
  readonly area: number;
  /** Big enough to see and fly to. */
  readonly targetable: boolean;
}

export interface PlaneState {
  readonly x: number;
  readonly y: number;
  /** Radians; 0 flies east, π/2 flies south (screen coordinates, y grows downward). */
  readonly heading: number;
}

export interface PlaneInput {
  /** -1 turn left (anticlockwise), 1 turn right, 0 straight. Ignored when `towards` is set. */
  readonly turn: number;
  /** Heading to turn towards (pointer steering). */
  readonly towards?: number | null;
  readonly boost?: boolean;
}

function ringArea(ring: readonly ProjectedPoint[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[index + 1]!;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function ringCentroid(ring: readonly ProjectedPoint[]): ProjectedPoint {
  const area = ringArea(ring);
  if (Math.abs(area) < 1e-9) {
    const sx = ring.reduce((sum, point) => sum + point[0], 0);
    const sy = ring.reduce((sum, point) => sum + point[1], 0);
    return [sx / ring.length, sy / ring.length];
  }
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index]!;
    const [x2, y2] = ring[index + 1]!;
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function projectPolygon(polygon: WorldMapPolygon): (readonly ProjectedPoint[])[] {
  return polygon.map((ring) => ring.map((point) => projectWorldMapPosition(point)));
}

export function buildFlyoverCountries(features: readonly WorldCountryFeature[]): FlyoverCountry[] {
  return features.map((feature) => {
    const polygons = feature.geometry.type === "Polygon" ? [projectPolygon(feature.geometry.coordinates)] : feature.geometry.coordinates.map(projectPolygon);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let area = 0;
    let largest: readonly ProjectedPoint[] | null = null;
    let largestArea = -1;
    for (const polygon of polygons) {
      polygon.forEach((ring, index) => {
        const ringSize = Math.abs(ringArea(ring));
        area += index === 0 ? ringSize : -ringSize;
        if (index === 0 && ringSize > largestArea) {
          largestArea = ringSize;
          largest = ring;
        }
        for (const [x, y] of ring) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      });
    }
    const centre: ProjectedPoint = largest ? ringCentroid(largest) : [(minX + maxX) / 2, (minY + maxY) / 2];
    return {
      code: feature.code,
      name: feature.name,
      continent: feature.continent,
      polygons,
      bounds: [minX, minY, maxX, maxY] as const,
      centre,
      area,
      targetable: area >= MIN_TARGET_AREA,
    };
  });
}

function pointInRing(x: number, y: number, ring: readonly ProjectedPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function wrapX(x: number): number {
  return ((x % MAP_VIEWBOX_WIDTH) + MAP_VIEWBOX_WIDTH) % MAP_VIEWBOX_WIDTH;
}

/** Is the map point inside the country (holes excluded)? `x` may be any wrap of the point. */
export function countryContainsPoint(country: FlyoverCountry, x: number, y: number): boolean {
  const px = wrapX(x);
  const [minX, minY, maxX, maxY] = country.bounds;
  if (px < minX || px > maxX || y < minY || y > maxY) return false;
  for (const polygon of country.polygons) {
    const [outline, ...holes] = polygon;
    if (!outline || !pointInRing(px, y, outline)) continue;
    if (!holes.some((hole) => pointInRing(px, y, hole))) return true;
  }
  return false;
}

const TOUCH_OFFSETS: readonly ProjectedPoint[] = [
  [0, 0],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
];

/** Does the plane (a small disc, not a single point) touch the country? */
export function planeTouchesCountry(country: FlyoverCountry, x: number, y: number, radius = FLYOVER_TOUCH_RADIUS): boolean {
  return TOUCH_OFFSETS.some(([dx, dy]) => countryContainsPoint(country, x + dx * radius, y + dy * radius));
}

/** The country directly under the plane, if any. */
export function countryUnderPoint(countries: readonly FlyoverCountry[], x: number, y: number): FlyoverCountry | null {
  return countries.find((country) => countryContainsPoint(country, x, y)) ?? null;
}

/** Shortest east–west offset from `fromX` to `toX` on the wrapping map. */
export function wrappedDeltaX(fromX: number, toX: number): number {
  let dx = wrapX(toX) - wrapX(fromX);
  if (dx > MAP_VIEWBOX_WIDTH / 2) dx -= MAP_VIEWBOX_WIDTH;
  if (dx < -MAP_VIEWBOX_WIDTH / 2) dx += MAP_VIEWBOX_WIDTH;
  return dx;
}

export function wrappedDistance(from: ProjectedPoint, to: ProjectedPoint): number {
  return Math.hypot(wrappedDeltaX(from[0], to[0]), to[1] - from[1]);
}

/** Heading from the plane to a point, the short way round. */
export function headingTowards(from: ProjectedPoint, to: ProjectedPoint): number {
  return Math.atan2(to[1] - from[1], wrappedDeltaX(from[0], to[0]));
}

function normaliseAngle(angle: number): number {
  let result = angle % (Math.PI * 2);
  if (result > Math.PI) result -= Math.PI * 2;
  if (result < -Math.PI) result += Math.PI * 2;
  return result;
}

/** Advance the plane by `dt` seconds: turn, fly forward, wrap east–west, bounce off the poles. */
export function stepPlane(plane: PlaneState, input: PlaneInput, dt: number): PlaneState {
  const maxTurn = FLYOVER_TURN_RATE * dt;
  let heading = plane.heading;
  if (input.towards !== undefined && input.towards !== null) {
    const diff = normaliseAngle(input.towards - heading);
    heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
  } else if (input.turn) {
    heading += Math.max(-1, Math.min(1, input.turn)) * maxTurn;
  }
  const speed = FLYOVER_SPEED * (input.boost ? FLYOVER_BOOST : 1);
  let x = plane.x + Math.cos(heading) * speed * dt;
  let y = plane.y + Math.sin(heading) * speed * dt;
  if (y < EDGE_MARGIN || y > MAP_VIEWBOX_HEIGHT - EDGE_MARGIN) {
    y = Math.max(EDGE_MARGIN, Math.min(MAP_VIEWBOX_HEIGHT - EDGE_MARGIN, y));
    heading = -heading;
  }
  x = wrapX(x);
  return { x, y, heading: normaliseAngle(heading) };
}

/**
 * The next country to fly to: a random pick among the nearest unvisited targets that aren't
 * right under the plane. Falls back to any unvisited target, and null once every one is visited.
 */
export function pickNextTarget(countries: readonly FlyoverCountry[], from: ProjectedPoint, exclude: ReadonlySet<string>, rng: Rng = Math.random): FlyoverCountry | null {
  const open = countries.filter((country) => country.targetable && !exclude.has(country.code));
  if (open.length === 0) return null;
  const byDistance = open
    .map((country) => ({ country, distance: wrappedDistance(from, country.centre) }))
    .sort((a, b) => a.distance - b.distance);
  const away = byDistance.filter((item) => item.distance >= MIN_TARGET_DISTANCE && !countryContainsPoint(item.country, from[0], from[1]));
  const pool = (away.length > 0 ? away : byDistance).slice(0, NEAREST_TARGET_CHOICES);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!.country;
}

/** Where a run starts: over a random country, flying in a random direction. */
export function startingPlane(countries: readonly FlyoverCountry[], rng: Rng = Math.random): PlaneState {
  const targets = countries.filter((country) => country.targetable);
  const start = targets[Math.floor(rng() * targets.length)];
  const [x, y] = start?.centre ?? [MAP_VIEWBOX_WIDTH / 2, MAP_VIEWBOX_HEIGHT / 2];
  return { x, y, heading: rng() * Math.PI * 2 - Math.PI };
}

// --- Multiplayer ---------------------------------------------------------------------------

/** Flight lengths a multiplayer host can pick. */
export const FLYOVER_MULTIPLAYER_DURATIONS_MS = [60_000, 90_000, 120_000] as const;
export const DEFAULT_FLYOVER_MULTIPLAYER_DURATION_MS = 90_000;
/** Everyone takes off together after this countdown. */
export const FLYOVER_TAKEOFF_COUNTDOWN_MS = 3_000;
/**
 * The clock is shared in a race, so a skip can't cost time off it: instead the plane flies a
 * holding pattern this long, during which no country counts.
 */
export const FLYOVER_SKIP_HOLD_SECONDS = 5;

export interface FlyoverRoute {
  readonly start: PlaneState;
  /** Every racer flies to these in order. Each is picked near the one before. */
  readonly route: readonly FlyoverCountry[];
}

/**
 * A race route from a seeded rng: a starting plane over a random country, then each target picked
 * among the nearest unvisited countries to the previous target (the solo game picks near the
 * plane instead, which can't be shared). Runs until every targetable country is on it.
 */
export function buildFlyoverRoute(countries: readonly FlyoverCountry[], rng: Rng): FlyoverRoute {
  const start = startingPlane(countries, rng);
  const route: FlyoverCountry[] = [];
  const used = new Set<string>();
  const startCountry = countryUnderPoint(countries, start.x, start.y);
  if (startCountry) used.add(startCountry.code);
  let from: ProjectedPoint = [start.x, start.y];
  for (;;) {
    const next = pickNextTarget(countries, from, used, rng);
    if (!next) break;
    route.push(next);
    used.add(next.code);
    from = next.centre;
  }
  return { start, route };
}

/** The least time a plane could take between two points, flying straight on full boost. */
export function minimumFlightSeconds(from: ProjectedPoint, to: ProjectedPoint): number {
  return wrappedDistance(from, to) / (FLYOVER_SPEED * FLYOVER_BOOST);
}

/**
 * Could an honest plane have reached `at` (touching `country`) from `from` in `elapsedSeconds`?
 * Generous on time — network jitter lands messages late or bunched — but never on place.
 */
export function isPlausibleReach(country: FlyoverCountry, at: ProjectedPoint, from: ProjectedPoint, elapsedSeconds: number): boolean {
  // The same test the plane ran (identical maths, so an honest touch always passes), plus a wider
  // ring for a position rounded on the way. A wider ring alone misses slivers the plane's own
  // ring catches, so it can't replace it.
  const touches = planeTouchesCountry(country, at[0], at[1]) || planeTouchesCountry(country, at[0], at[1], FLYOVER_TOUCH_RADIUS * 1.5);
  if (!touches) return false;
  return elapsedSeconds >= minimumFlightSeconds(from, at) * 0.75 - 1.5;
}
