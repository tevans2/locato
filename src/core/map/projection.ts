import type { WorldMapPosition } from "./types";

export const MAP_VIEWBOX_WIDTH = 1000;
export const MAP_VIEWBOX_HEIGHT = 500;
export const MAP_MIN_LONGITUDE = -180;
export const MAP_MAX_LONGITUDE = 180;
export const MAP_MIN_LATITUDE = -60;
export const MAP_MAX_LATITUDE = 85;

const LONGITUDE_SPAN = MAP_MAX_LONGITUDE - MAP_MIN_LONGITUDE;
const LATITUDE_SPAN = MAP_MAX_LATITUDE - MAP_MIN_LATITUDE;

export type ProjectedPoint = readonly [number, number];

export function projectWorldMapPosition([longitude, latitude]: WorldMapPosition): ProjectedPoint {
  const clampedLongitude = clampNumber(longitude, MAP_MIN_LONGITUDE, MAP_MAX_LONGITUDE);
  const clampedLatitude = clampNumber(latitude, MAP_MIN_LATITUDE, MAP_MAX_LATITUDE);

  return [
    ((clampedLongitude - MAP_MIN_LONGITUDE) / LONGITUDE_SPAN) * MAP_VIEWBOX_WIDTH,
    ((MAP_MAX_LATITUDE - clampedLatitude) / LATITUDE_SPAN) * MAP_VIEWBOX_HEIGHT,
  ];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
