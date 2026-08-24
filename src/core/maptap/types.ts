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
  // Distance from the target that still scores full marks. Large natural features use a wide
  // zone (and optional extra anchors) so guessing "somewhere in the Andes" isn't pure luck.
  readonly toleranceKm?: number;
  readonly anchors?: readonly { readonly lat: number; readonly lng: number }[];
}

// Public round payload. Do not include lat/lng here when a backend is available.
export interface MapTapRoundTarget {
  readonly id: string;
  readonly name: string;
  readonly category: MapTapCategory;
  readonly difficulty: MapTapDifficulty;
  readonly toleranceKm?: number;
  readonly anchors?: readonly { readonly lat: number; readonly lng: number }[];
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
  readonly toleranceKm: number;
}
