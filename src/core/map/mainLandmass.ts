import { projectWorldMapPosition } from "./projection";
import type { WorldCountryFeature, WorldMapPolygon, WorldMapPosition } from "./types";

/** A rectangle in world-map viewBox units (see `MAP_VIEWBOX_WIDTH`). */
export interface MapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MainLandmassOptions {
  /**
   * A [longitude, latitude] point (usually the capital) that picks the home landmass instead of
   * the largest one: Tarawa for Kiribati rather than Kiritimati. The point itself is not added
   * to the bounds.
   */
  readonly anchor?: WorldMapPosition | null;
}

interface Piece {
  readonly rect: MapRect;
  readonly area: number;
}

/** Islands closer than this (viewBox units, ~2° of longitude) always join their neighbour. */
const MIN_LINK_GAP = 6;
/** ...and bigger landmasses reach proportionally further (Corsica, Sicily, Tierra del Fuego). */
const LINK_GAP_RATIO = 0.12;
/**
 * A separate group still counts as home land when it is at least this share of the home group's
 * land and no further away than the larger group is wide: Peninsular and East Malaysia, but not
 * Svalbard (~40% of mainland Norway) or Alaska (a third of the contiguous US).
 */
const PARTNER_LAND_RATIO = 0.5;

function polygonsOf(feature: WorldCountryFeature): readonly WorldMapPolygon[] {
  return feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}

function measurePolygon(polygon: WorldMapPolygon): Piece | null {
  const ring = polygon[0];
  if (!ring || ring.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let twiceArea = 0;
  let previous = projectWorldMapPosition(ring[ring.length - 1]!);
  for (const position of ring) {
    const point = projectWorldMapPosition(position);
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
    twiceArea += previous[0] * point[1] - point[0] * previous[1];
    previous = point;
  }
  return { rect: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, area: Math.abs(twiceArea / 2) };
}

function gapBetween(a: MapRect, b: MapRect): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

function distanceToPoint(rect: MapRect, [px, py]: readonly [number, number]): number {
  const dx = Math.max(0, rect.x - px, px - (rect.x + rect.width));
  const dy = Math.max(0, rect.y - py, py - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export function unionMapRects(rects: readonly MapRect[]): MapRect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Bounds of every polygon of a feature, far-flung territories included. */
export function featureBounds(feature: WorldCountryFeature): MapRect | null {
  return unionMapRects(polygonsOf(feature).map(measurePolygon).filter((piece): piece is Piece => piece !== null).map((piece) => piece.rect));
}

/**
 * The part of a country worth framing on the map: its home landmass plus the islands that sit
 * next to it. France without French Guiana or Réunion, the US without Alaska and Hawaii, Norway
 * without Svalbard, the Netherlands without the Caribbean, Indonesia as one archipelago.
 *
 * Polygons are grouped by single-linkage on the gaps between their bounding boxes, with a link
 * distance set by the largest landmass, so island chains (Indonesia, the Philippines) stay whole
 * while overseas territories fall away. The group containing the anchor's nearest polygon wins
 * (or, without an anchor, the group with the most land).
 *
 * The flat map cannot draw a frame that wraps round the date line, so polygons on the far side
 * of the antimeridian (Chukotka for Russia, eastern Fiji, the Line Islands for Kiribati's Tarawa)
 * are measured in plain map space: they sit a whole map-width away and never join the group.
 */
export function mainLandmassBounds(feature: WorldCountryFeature, options: MainLandmassOptions = {}): MapRect | null {
  const pieces = polygonsOf(feature).map(measurePolygon).filter((piece): piece is Piece => piece !== null);
  if (pieces.length === 0) return null;
  if (pieces.length === 1) return pieces[0]!.rect;

  const largest = pieces.reduce((best, piece) => (piece.area > best.area ? piece : best));
  const linkGap = Math.max(MIN_LINK_GAP, Math.max(largest.rect.width, largest.rect.height) * LINK_GAP_RATIO);

  // Union-find over pieces linked by a small enough gap.
  const parent = pieces.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  for (let a = 0; a < pieces.length; a += 1) {
    for (let b = a + 1; b < pieces.length; b += 1) {
      if (gapBetween(pieces[a]!.rect, pieces[b]!.rect) <= linkGap) parent[find(a)] = find(b);
    }
  }

  let seed: number;
  if (options.anchor) {
    const point = projectWorldMapPosition(options.anchor);
    seed = 0;
    let bestDistance = Infinity;
    pieces.forEach((piece, index) => {
      const distance = distanceToPoint(piece.rect, point);
      const best = pieces[seed]!;
      if (distance < bestDistance - 0.01 || (Math.abs(distance - bestDistance) <= 0.01 && piece.area > best.area)) {
        seed = index;
        bestDistance = distance;
      }
    });
  } else {
    const landByGroup = new Map<number, number>();
    pieces.forEach((piece, index) => landByGroup.set(find(index), (landByGroup.get(find(index)) ?? 0) + piece.area));
    seed = pieces.indexOf(largest);
    let bestLand = -1;
    for (const [group, land] of landByGroup) {
      if (land > bestLand) {
        bestLand = land;
        seed = group;
      }
    }
  }

  const groupOf = pieces.map((_, index) => find(index));
  const home = groupOf[seed]!;
  const rectOf = (group: number) => unionMapRects(pieces.filter((_, index) => groupOf[index] === group).map((piece) => piece.rect))!;
  const landOf = (group: number) => pieces.reduce((total, piece, index) => total + (groupOf[index] === group ? piece.area : 0), 0);
  const homeRect = rectOf(home);
  const homeLand = landOf(home);
  const span = (rect: MapRect) => Math.max(rect.width, rect.height);
  const partners = [...new Set(groupOf)].filter((group) => {
    if (group === home || landOf(group) < homeLand * PARTNER_LAND_RATIO) return false;
    const rect = rectOf(group);
    return gapBetween(rect, homeRect) <= Math.max(span(rect), span(homeRect));
  });
  return unionMapRects([homeRect, ...partners.map(rectOf)]);
}
