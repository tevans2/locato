export const EARTH_RADIUS_KM = 6371.0088;
export const MAP_TAP_MAX_SCORE = 5000;
export const MAP_TAP_DEFAULT_DECAY_KM = 1000;
export const MAP_TAP_MIN_DECAY_KM = 100;
export const MAP_TAP_MAX_DECAY_KM = 10000;

export interface LngLatPoint {
  readonly lat: number;
  readonly lng: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function normalizeLongitude(lng: number): number {
  if (!Number.isFinite(lng)) return NaN;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function isValidLatLng(point: LngLatPoint): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat >= -90 && point.lat <= 90;
}

export function haversineDistanceKm(a: LngLatPoint, b: LngLatPoint): number {
  if (!isValidLatLng(a) || !isValidLatLng(b)) return NaN;

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(normalizeLongitude(b.lng - a.lng));

  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function clampDecayKm(decayKm: number | undefined): number {
  if (!Number.isFinite(decayKm)) return MAP_TAP_DEFAULT_DECAY_KM;
  return Math.min(Math.max(decayKm!, MAP_TAP_MIN_DECAY_KM), MAP_TAP_MAX_DECAY_KM);
}

export function scoreMapTapDistance(distanceKm: number, decayKm = MAP_TAP_DEFAULT_DECAY_KM, maxScore = MAP_TAP_MAX_SCORE): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  const decay = clampDecayKm(decayKm);
  const score = maxScore * Math.exp(-distanceKm / decay);
  return Math.max(0, Math.min(maxScore, Math.round(score)));
}

export function scoreMapTapGuess(guess: LngLatPoint, target: LngLatPoint, decayKm = MAP_TAP_DEFAULT_DECAY_KM): { readonly distanceKm: number; readonly score: number; readonly decayKm: number } {
  const normalizedGuess = { lat: guess.lat, lng: normalizeLongitude(guess.lng) };
  const normalizedTarget = { lat: target.lat, lng: normalizeLongitude(target.lng) };
  const distanceKm = haversineDistanceKm(normalizedGuess, normalizedTarget);
  const decay = clampDecayKm(decayKm);
  return {
    distanceKm,
    score: scoreMapTapDistance(distanceKm, decay),
    decayKm: decay,
  };
}
