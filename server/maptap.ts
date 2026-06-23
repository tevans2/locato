import { clampDecayKm, isValidLatLng, MAP_TAP_MAX_SCORE, normalizeLongitude, scoreMapTapGuess } from "../src/core/maptap/distance";
import { filterMapTapLocations, findMapTapLocation, isMapTapCategory, isMapTapDifficulty, toMapTapRoundTarget } from "../src/core/maptap/locations";
import type { MapTapGuessResult, MapTapLocation } from "../src/core/maptap/types";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pickRandom<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

export function createMapTapRoundResponse(url: URL): Response {
  const categoryRaw = url.searchParams.get("category");
  const difficultyRaw = url.searchParams.get("difficulty");
  const category = categoryRaw && isMapTapCategory(categoryRaw) ? categoryRaw : null;
  const difficulty = difficultyRaw && isMapTapDifficulty(difficultyRaw) ? difficultyRaw : null;
  const locations = filterMapTapLocations({ category, difficulty });
  const location = pickRandom(locations);
  if (!location) return json({ error: "No MapTap targets match those filters." }, 404);
  return json({ target: toMapTapRoundTarget(location) });
}

function buildGuessResult(location: MapTapLocation, guessLat: number, guessLng: number, decayKm: number): MapTapGuessResult | null {
  const guess = { lat: guessLat, lng: normalizeLongitude(guessLng) };
  if (!isValidLatLng(guess)) return null;
  const scored = scoreMapTapGuess(guess, location, decayKm);
  return {
    target: location,
    guess,
    distanceKm: Math.round(scored.distanceKm * 10) / 10,
    score: scored.score,
    maxScore: MAP_TAP_MAX_SCORE,
    decayKm: scored.decayKm,
  };
}

export async function validateMapTapGuessResponse(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  if (!body) return json({ error: "Invalid request body." }, 400);

  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  const location = findMapTapLocation(targetId);
  if (!location) return json({ error: "Unknown MapTap target." }, 404);

  const guessLat = typeof body.guessLat === "number" ? body.guessLat : NaN;
  const guessLng = typeof body.guessLng === "number" ? body.guessLng : NaN;
  const decayKm = clampDecayKm(typeof body.decayKm === "number" ? body.decayKm : undefined);
  const result = buildGuessResult(location, guessLat, guessLng, decayKm);
  if (!result) return json({ error: "Invalid guess coordinates." }, 400);

  return json(result);
}
