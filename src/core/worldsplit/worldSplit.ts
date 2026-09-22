import {
  MAP_VIEWBOX_HEIGHT,
  MAP_VIEWBOX_WIDTH,
  projectWorldMapPosition,
  type ProjectedPoint,
  type WorldCountryFeature,
  type WorldMapPolygon,
} from "../map";
import { WORLD_SPLIT_POPULATION_MILLIONS } from "./population";

export type WorldSplitSide = "a" | "b";
export type SplitLine = readonly [ProjectedPoint, ProjectedPoint];

export interface WorldSplitRound {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly detail: string;
  readonly continents: readonly string[] | null;
}

export interface WorldSplitCountryPoint {
  readonly code: string;
  readonly name: string;
  readonly continent: string;
  readonly point: ProjectedPoint;
  readonly populationMillions: number;
}

export interface WorldSplitResult {
  readonly sideAPercent: number;
  readonly sideBPercent: number;
  readonly sideAPopulationMillions: number;
  readonly sideBPopulationMillions: number;
  readonly totalPopulationMillions: number;
  readonly errorPercentagePoints: number;
  readonly score: number;
}

export const WORLD_SPLIT_MAX_ROUND_SCORE = 100;
export const WORLD_SPLIT_ROUNDS: readonly WorldSplitRound[] = [
  {
    id: "world",
    label: "Whole world",
    prompt: "Split the world’s population in half.",
    detail: "Draw one straight line. Every country is counted by the side containing its centre.",
    continents: null,
  },
  {
    id: "asia",
    label: "Asia",
    prompt: "Split Asia’s population in half.",
    detail: "Only countries in Asia count this round. The rest of the map is context.",
    continents: ["Asia"],
  },
  {
    id: "africa",
    label: "Africa",
    prompt: "Split Africa’s population in half.",
    detail: "Find a line that balances Africa’s population, not its land area.",
    continents: ["Africa"],
  },
  {
    id: "europe",
    label: "Europe",
    prompt: "Split Europe’s population in half.",
    detail: "Small moves matter when many countries sit close together.",
    continents: ["Europe"],
  },
  {
    id: "americas",
    label: "The Americas",
    prompt: "Split the Americas’ population in half.",
    detail: "North America and South America are counted together.",
    continents: ["North America", "South America"],
  },
];

export const DEFAULT_WORLD_SPLIT_LINE: SplitLine = [[180, MAP_VIEWBOX_HEIGHT / 2], [820, MAP_VIEWBOX_HEIGHT / 2]];

function ringArea(points: readonly ProjectedPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[(index + 1) % points.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ringCentroid(points: readonly ProjectedPoint[]): ProjectedPoint | null {
  let twiceArea = 0;
  let xTotal = 0;
  let yTotal = 0;

  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    const [x2, y2] = points[(index + 1) % points.length]!;
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    xTotal += (x1 + x2) * cross;
    yTotal += (y1 + y2) * cross;
  }

  if (Math.abs(twiceArea) < 0.0001) return null;
  return [xTotal / (3 * twiceArea), yTotal / (3 * twiceArea)];
}

function centerOfBounds(points: readonly ProjectedPoint[]): ProjectedPoint {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function polygonArea(polygon: WorldMapPolygon): number {
  const outerRing = polygon[0];
  if (!outerRing) return 0;
  return Math.abs(ringArea(outerRing.map(projectWorldMapPosition)));
}

export function worldSplitCountryCenter(feature: WorldCountryFeature): ProjectedPoint | null {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let largestPolygon: WorldMapPolygon | null = null;
  let largestArea = -1;

  for (const polygon of polygons) {
    const area = polygonArea(polygon);
    if (area > largestArea) {
      largestPolygon = polygon;
      largestArea = area;
    }
  }

  const outerRing = largestPolygon?.[0];
  if (!outerRing || outerRing.length === 0) return null;
  const points = outerRing.map(projectWorldMapPosition);
  return ringCentroid(points) ?? centerOfBounds(points);
}

export function buildWorldSplitCountries(features: readonly WorldCountryFeature[]): readonly WorldSplitCountryPoint[] {
  return features.flatMap((feature) => {
    const point = worldSplitCountryCenter(feature);
    const populationMillions = WORLD_SPLIT_POPULATION_MILLIONS[feature.code];
    if (!point || populationMillions === undefined || populationMillions <= 0) return [];
    return [{ code: feature.code, name: feature.name, continent: feature.continent, point, populationMillions }];
  });
}

export function isCountryInWorldSplitRound(country: Pick<WorldSplitCountryPoint, "continent">, round: WorldSplitRound): boolean {
  return round.continents === null || round.continents.includes(country.continent);
}

export function worldSplitSideForPoint(point: ProjectedPoint, line: SplitLine): WorldSplitSide {
  const [[startX, startY], [endX, endY]] = line;
  const cross = (endX - startX) * (point[1] - startY) - (endY - startY) * (point[0] - startX);
  return cross >= 0 ? "a" : "b";
}

export function splitLineLength(line: SplitLine): number {
  const [[startX, startY], [endX, endY]] = line;
  return Math.hypot(endX - startX, endY - startY);
}

export function scoreWorldSplit(
  countries: readonly WorldSplitCountryPoint[],
  round: WorldSplitRound,
  line: SplitLine,
): WorldSplitResult {
  let sideAPopulationMillions = 0;
  let sideBPopulationMillions = 0;

  for (const country of countries) {
    if (!isCountryInWorldSplitRound(country, round)) continue;
    if (worldSplitSideForPoint(country.point, line) === "a") sideAPopulationMillions += country.populationMillions;
    else sideBPopulationMillions += country.populationMillions;
  }

  const totalPopulationMillions = sideAPopulationMillions + sideBPopulationMillions;
  const sideAPercent = totalPopulationMillions > 0 ? (sideAPopulationMillions / totalPopulationMillions) * 100 : 50;
  const sideBPercent = 100 - sideAPercent;
  const errorPercentagePoints = Math.abs(sideAPercent - 50);
  const score = Math.max(0, Math.round(WORLD_SPLIT_MAX_ROUND_SCORE - errorPercentagePoints * 4));

  return {
    sideAPercent,
    sideBPercent,
    sideAPopulationMillions,
    sideBPopulationMillions,
    totalPopulationMillions,
    errorPercentagePoints,
    score,
  };
}

export function rotateSplitLine(line: SplitLine, degrees: number): SplitLine {
  const [[startX, startY], [endX, endY]] = line;
  const midpointX = (startX + endX) / 2;
  const midpointY = (startY + endY) / 2;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  function rotatePoint([x, y]: ProjectedPoint): ProjectedPoint {
    const localX = x - midpointX;
    const localY = y - midpointY;
    return [midpointX + localX * cos - localY * sin, midpointY + localX * sin + localY * cos];
  }

  return [rotatePoint(line[0]), rotatePoint(line[1])];
}

export function shiftSplitLine(line: SplitLine, distance: number): SplitLine {
  const [[startX, startY], [endX, endY]] = line;
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return line;
  const shiftX = (-dy / length) * distance;
  const shiftY = (dx / length) * distance;
  return [[startX + shiftX, startY + shiftY], [endX + shiftX, endY + shiftY]];
}

export function extendSplitLineToMap(line: SplitLine): SplitLine {
  const [[startX, startY], [endX, endY]] = line;
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.hypot(dx, dy) < 0.0001) return line;

  const candidates: ProjectedPoint[] = [];
  const add = (x: number, y: number): void => {
    if (x < -0.001 || x > MAP_VIEWBOX_WIDTH + 0.001 || y < -0.001 || y > MAP_VIEWBOX_HEIGHT + 0.001) return;
    if (candidates.some(([existingX, existingY]) => Math.hypot(existingX - x, existingY - y) < 0.01)) return;
    candidates.push([Math.min(MAP_VIEWBOX_WIDTH, Math.max(0, x)), Math.min(MAP_VIEWBOX_HEIGHT, Math.max(0, y))]);
  };

  if (Math.abs(dx) > 0.0001) {
    let t = (0 - startX) / dx;
    add(0, startY + t * dy);
    t = (MAP_VIEWBOX_WIDTH - startX) / dx;
    add(MAP_VIEWBOX_WIDTH, startY + t * dy);
  }
  if (Math.abs(dy) > 0.0001) {
    let t = (0 - startY) / dy;
    add(startX + t * dx, 0);
    t = (MAP_VIEWBOX_HEIGHT - startY) / dy;
    add(startX + t * dx, MAP_VIEWBOX_HEIGHT);
  }

  if (candidates.length < 2) return line;
  let first = candidates[0]!;
  let second = candidates[1]!;
  let farthest = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    for (let next = index + 1; next < candidates.length; next += 1) {
      const a = candidates[index]!;
      const b = candidates[next]!;
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (distance > farthest) {
        farthest = distance;
        first = a;
        second = b;
      }
    }
  }
  return [first, second];
}

export function formatPopulationMillions(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 2).replace(/\.00$/, "")}B`;
  if (value >= 10) return `${Math.round(value)}M`;
  if (value >= 1) return `${value.toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.max(1, Math.round(value * 1000))}K`;
}
