import type { WorldCountryFeature, WorldMapPolygon, WorldMapPosition } from "../../../core/map";

/** Shared orientation for the sphere, its painted map and country picking. */
export function atlasPosition([longitude, latitude]: WorldMapPosition): readonly [number, number, number] {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

export function atlasTexturePoint([longitude, latitude]: WorldMapPosition, width: number, height: number): readonly [number, number] {
  return [(longitude + 90) / 360 * width, (90 - latitude) / 180 * height];
}

/** Unwrap the date line before drawing; repeated copies cover the texture seam. */
export function unwrapAtlasRing(ring: readonly WorldMapPosition[]): readonly WorldMapPosition[] {
  let previous = ring[0]?.[0] ?? 0;
  return ring.map(([longitude, latitude]) => {
    while (longitude - previous > 180) longitude -= 360;
    while (previous - longitude > 180) longitude += 360;
    previous = longitude;
    return [longitude, latitude];
  });
}

export function atlasPolygons(feature: WorldCountryFeature): readonly WorldMapPolygon[] {
  return feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}

/** A main-landmass anchor, so France's card does not sit over its overseas islands. */
export function atlasCountryAnchor(feature: WorldCountryFeature): WorldMapPosition {
  let anchor: WorldMapPosition = [0, 0];
  let largestArea = -1;
  for (const polygon of atlasPolygons(feature)) {
    const ring = unwrapAtlasRing(polygon[0] ?? []);
    if (ring.length === 0) continue;
    const longitudes = ring.map(([lon]) => lon);
    const latitudes = ring.map(([, lat]) => lat);
    const west = Math.min(...longitudes), east = Math.max(...longitudes);
    const south = Math.min(...latitudes), north = Math.max(...latitudes);
    const area = (east - west) * (north - south);
    if (area > largestArea) {
      largestArea = area;
      anchor = [((west + east) / 2 + 540) % 360 - 180, (south + north) / 2];
    }
  }
  return anchor;
}
