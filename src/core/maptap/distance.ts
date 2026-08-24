export const EARTH_RADIUS_KM = 6371.0088;
export const MAP_TAP_MAX_SCORE = 5000;
export const MAP_TAP_DEFAULT_DECAY_KM = 1000;
export const MAP_TAP_MIN_DECAY_KM = 100;
export const MAP_TAP_MAX_DECAY_KM = 10000;
// Guesses landing within this distance of a target score full marks. Locations without an
// explicit tolerance fall back to this so even pinpoint targets forgive globe-tap imprecision.
export const MAP_TAP_DEFAULT_TOLERANCE_KM = 50;

// Extra representative points for sprawling features; see effectiveDistanceKm.
export interface ScoreableTarget extends LngLatPoint {
  readonly toleranceKm?: number;
  readonly anchors?: readonly LngLatPoint[];
}

export function effectiveDistanceKm(guess: LngLatPoint, target: ScoreableTarget): number {
  // A target may span a huge area (mountain ranges, rainforests, reefs); anchors are extra
  // representative points and the effective distance is the shortest to any of them.
  const points = target.anchors && target.anchors.length > 0 ? [target, ...target.anchors] : [target];
  let best = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = haversineDistanceKm(guess, point);
    if (Number.isFinite(distance) && distance < best) best = distance;
  }
  return best;
}

export function targetToleranceKm(target: ScoreableTarget): number {
  return clampToleranceKm(target.toleranceKm ?? MAP_TAP_DEFAULT_TOLERANCE_KM);
}

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

export const MAP_TAP_MIN_TOLERANCE_KM = 10;
export const MAP_TAP_MAX_TOLERANCE_KM = 1500;

function clampToleranceKm(toleranceKm: number): number {
  if (!Number.isFinite(toleranceKm)) return MAP_TAP_DEFAULT_TOLERANCE_KM;
  return Math.min(Math.max(toleranceKm, MAP_TAP_MIN_TOLERANCE_KM), MAP_TAP_MAX_TOLERANCE_KM);
}

// Full marks inside the tolerance zone, then exponential decay beyond it.
export function scoreMapTapDistance(distanceKm: number, decayKm = MAP_TAP_DEFAULT_DECAY_KM, maxScore = MAP_TAP_MAX_SCORE, toleranceKm = 0): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  const decay = clampDecayKm(decayKm);
  const excess = Math.max(0, distanceKm - Math.max(0, toleranceKm));
  const score = maxScore * Math.exp(-excess / decay);
  return Math.max(0, Math.min(maxScore, Math.round(score)));
}


export function scoreMapTapGuess(guess: LngLatPoint, target: ScoreableTarget, decayKm = MAP_TAP_DEFAULT_DECAY_KM): {
  readonly distanceKm: number;
  readonly score: number;
  readonly decayKm: number;
  readonly toleranceKm: number;
} {
  const normalizedGuess = { lat: guess.lat, lng: normalizeLongitude(guess.lng) };
  const normalizedTarget = { lat: target.lat, lng: normalizeLongitude(target.lng) };
  const anchors = target.anchors?.map((anchor) => ({ lat: anchor.lat, lng: normalizeLongitude(anchor.lng) }));
  const scoreableTarget: ScoreableTarget = { ...normalizedTarget, ...(target.toleranceKm !== undefined ? { toleranceKm: target.toleranceKm } : {}), ...(anchors ? { anchors } : {}) };
  const distanceKm = effectiveDistanceKm(normalizedGuess, scoreableTarget);
  const decay = clampDecayKm(decayKm);
  const tolerance = targetToleranceKm(scoreableTarget);
  return {
    distanceKm,
    score: scoreMapTapDistance(distanceKm, decay, MAP_TAP_MAX_SCORE, tolerance),
    decayKm: decay,
    toleranceKm: tolerance,
  };
}
