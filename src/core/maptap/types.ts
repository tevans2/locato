export type MapTapCategory = "city" | "mountain" | "poi" | "landmark";
export type MapTapDifficulty = "easy" | "medium" | "hard";

export interface MapTapLocation {
  readonly id: string;
  readonly name: string;
  readonly category: MapTapCategory;
  readonly lat: number;
  readonly lng: number;
  readonly difficulty: MapTapDifficulty;
  readonly wikiSlug: string;
}

// Public round payload. Do not include lat/lng here when a backend is available.
export interface MapTapRoundTarget {
  readonly id: string;
  readonly name: string;
  readonly category: MapTapCategory;
  readonly difficulty: MapTapDifficulty;
}

export interface MapTapGuessInput {
  readonly targetId: string;
  readonly guessLat: number;
  readonly guessLng: number;
  readonly decayKm?: number;
}

export interface MapTapGuessResult {
  readonly target: MapTapLocation;
  readonly guess: {
    readonly lat: number;
    readonly lng: number;
  };
  readonly distanceKm: number;
  readonly score: number;
  readonly maxScore: number;
  readonly decayKm: number;
}
