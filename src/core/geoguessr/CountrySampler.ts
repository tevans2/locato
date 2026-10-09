import type { WorldCountryFeature, WorldMapPolygon } from "../map";
import { normalizeLongitude } from "../maptap/distance";

interface Polygon {
  rings: readonly (readonly (readonly [number, number])[])[];
  minX: number; maxX: number; minY: number; maxY: number; weight: number; wrap: boolean;
}
function inRing(x: number, y: number, ring: Polygon["rings"][number]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function contains(polygon: Polygon, lat: number, lng: number): boolean {
  const x = polygon.wrap && lng < 0 ? lng + 360 : lng;
  return x >= polygon.minX && x <= polygon.maxX && lat >= polygon.minY && lat <= polygon.maxY &&
    inRing(x, lat, polygon.rings[0]!) && !polygon.rings.slice(1).some(ring => inRing(x, lat, ring));
}
function prepare(coordinates: WorldMapPolygon): Polygon | null {
  const outline = coordinates[0];
  if (!outline?.length) return null;
  const xs = outline.map(p => p[0]);
  const wrap = Math.max(...xs) - Math.min(...xs) > 180;
  const rings = coordinates.map(ring => ring.map(([lng, lat]) => [wrap && lng < 0 ? lng + 360 : lng, lat] as const));
  const outer = rings[0]!;
  const minX = Math.min(...outer.map(p => p[0])), maxX = Math.max(...outer.map(p => p[0]));
  const minY = Math.min(...outer.map(p => p[1])), maxY = Math.max(...outer.map(p => p[1]));
  const weight = (maxX - minX) * (Math.sin(maxY * Math.PI / 180) - Math.sin(minY * Math.PI / 180));
  return weight > 0 ? { rings, minX, maxX, minY, maxY, weight, wrap } : null;
}
/** Rejection sampling inside actual polygons; holes, islands and the date line are respected. */
export class CountrySampler {
  private readonly countries = new Map<string, readonly Polygon[]>();
  constructor(world: readonly WorldCountryFeature[]) {
    for (const feature of world) {
      const coordinates = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      this.countries.set(feature.code, coordinates.map(prepare).filter((p): p is Polygon => p !== null));
    }
  }
  codes(): string[] { return [...this.countries.keys()]; }
  contains(code: string, lat: number, lng: number): boolean {
    return this.countries.get(code)?.some(p => contains(p, lat, lng)) ?? false;
  }
  sample(code: string, random = Math.random): { lat: number; lng: number } | null {
    const polygons = this.countries.get(code);
    if (!polygons?.length) return null;
    const total = polygons.reduce((sum, p) => sum + p.weight, 0);
    for (let attempt = 0; attempt < 80; attempt++) {
      let pick = random() * total;
      const polygon = polygons.find(p => (pick -= p.weight) <= 0) ?? polygons[polygons.length - 1]!;
      const lng = normalizeLongitude(polygon.minX + random() * (polygon.maxX - polygon.minX));
      const low = Math.sin(polygon.minY * Math.PI / 180), high = Math.sin(polygon.maxY * Math.PI / 180);
      const lat = Math.asin(low + random() * (high - low)) * 180 / Math.PI;
      if (contains(polygon, lat, lng)) return { lat, lng };
    }
    return null;
  }
}
