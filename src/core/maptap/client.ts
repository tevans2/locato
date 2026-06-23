import type { MapTapCategory, MapTapDifficulty, MapTapGuessInput, MapTapGuessResult, MapTapRoundTarget } from "./types";

async function readJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export async function fetchMapTapRound(filters: { readonly category?: MapTapCategory | ""; readonly difficulty?: MapTapDifficulty | "" } = {}): Promise<MapTapRoundTarget | null> {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const data = await readJson<{ readonly target: MapTapRoundTarget }>(await fetch(`/api/maptap/round${suffix}`));
  return data?.target ?? null;
}

export async function validateMapTapGuess(input: MapTapGuessInput): Promise<MapTapGuessResult | null> {
  const data = await readJson<MapTapGuessResult>(
    await fetch("/api/maptap/guess", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return data;
}
