export type WorldMapPosition = readonly [number, number];
export type WorldMapRing = readonly WorldMapPosition[];
export type WorldMapPolygon = readonly WorldMapRing[];

export type WorldCountryGeometry =
  | { readonly type: "Polygon"; readonly coordinates: WorldMapPolygon }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly WorldMapPolygon[] };

export interface WorldCountryFeature {
  readonly name: string;
  readonly code: string;
  readonly continent: string;
  readonly geometry: WorldCountryGeometry;
}
