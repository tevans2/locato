/** Shape of the generated (world-countries derived) half of a country profile. */
export interface GeneratedCountryProfile {
  readonly code: string;
  readonly cca3: string;
  readonly commonName: string;
  readonly officialName: string;
  readonly nativeNames: readonly NativeName[];
  readonly region: string;
  readonly subregion: string;
  /** Every capital listed by the dataset (e.g. South Africa has three). */
  readonly capitals: readonly string[];
  /** Country centroid, [lat, lng]. */
  readonly latlng: readonly [number, number];
  /** Approximate coordinates of the primary capital (our `capital`), [lat, lng]. */
  readonly capitalLatLng: readonly [number, number] | null;
  readonly areaKm2: number;
  readonly landlocked: boolean;
  /** Land neighbours as our alpha-2 codes (only codes among the 196 playable countries). */
  readonly borders: readonly string[];
  readonly languages: readonly string[];
  readonly currencies: readonly Currency[];
  readonly demonym: string;
  /** International dialling prefix, e.g. "+27". Shared roots like "+1" are kept as-is. */
  readonly callingCode: string | null;
  readonly tld: readonly string[];
  readonly flagEmoji: string;
  readonly unMember: boolean;
}

export interface NativeName {
  readonly language: string;
  readonly official: string;
  readonly common: string;
}

export interface Currency {
  readonly code: string;
  readonly name: string;
  readonly symbol: string | null;
}

export type DrivingSide = "left" | "right";

/** Hand-authored learning content. */
export interface CuratedCountryProfile {
  /** One-line memory hook for recognising the country. */
  readonly hook: string;
  /** What makes the flag distinctive / how to tell it apart. */
  readonly flagNote: string;
  /** 2–3 short, verifiable facts. */
  readonly funFacts: readonly string[];
  /** 1–3 famous places. */
  readonly landmarks: readonly string[];
  readonly drivingSide: DrivingSide;
  readonly highestPoint?: { readonly name: string; readonly metres: number };
}
