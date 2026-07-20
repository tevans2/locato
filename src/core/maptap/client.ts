import type { MapTapCategory, MapTapDifficulty, MapTapGuessInput, MapTapGuessResult, MapTapRoundTarget } from "./types";
import { isValidLatLng, MAP_TAP_MAX_SCORE, normalizeLongitude, scoreMapTapGuess } from "./distance";
import { filterMapTapLocations, findMapTapLocation, toMapTapRoundTarget } from "./locations";

async function readJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function localRound(filters: { readonly category?: MapTapCategory | ""; readonly difficulty?: MapTapDifficulty | "" }): MapTapRoundTarget | null {
  const candidates = filterMapTapLocations(filters);
  if (candidates.length === 0) return null;
  return toMapTapRoundTarget(candidates[Math.floor(Math.random() * candidates.length)]!);
}

function localGuess(input: MapTapGuessInput): MapTapGuessResult | null {
  const target = findMapTapLocation(input.targetId);
  const guess = { lat: input.guessLat, lng: normalizeLongitude(input.guessLng) };
  if (!target || !isValidLatLng(guess)) return null;
  const scored = scoreMapTapGuess(guess, target, input.decayKm);
  return {
    target,
    guess,
    distanceKm: Math.round(scored.distanceKm * 10) / 10,
    score: scored.score,
    maxScore: MAP_TAP_MAX_SCORE,
    decayKm: scored.decayKm,
  };
}

export async function fetchMapTapRound(filters: { readonly category?: MapTapCategory | ""; readonly difficulty?: MapTapDifficulty | "" } = {}): Promise<MapTapRoundTarget | null> {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  try {
    const data = await readJson<{ readonly target: MapTapRoundTarget }>(await fetch(`/api/maptap/round${suffix}`));
    return data?.target ?? localRound(filters);
  } catch {
    return localRound(filters);
  }
}

export async function validateMapTapGuess(input: MapTapGuessInput): Promise<MapTapGuessResult | null> {
  try {
    const data = await readJson<MapTapGuessResult>(
      await fetch("/api/maptap/guess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    return data ?? localGuess(input);
  } catch {
    return localGuess(input);
  }
}
