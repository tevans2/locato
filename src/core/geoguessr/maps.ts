import { rawCountries } from "../countries";
import type { GeoGuessrLocation } from "./index";

export interface GeoGameMap {
  /** World keeps the existing default leaderboard variant. */
  readonly id: string;
  readonly name: string;
  readonly category: "World" | "Regions" | "Countries";
  readonly description: string;
  readonly countryCodes?: readonly string[];
  readonly artwork: string;
  readonly color: string;
}
const region = (id: string, name: string, description: string, artwork: string, color: string): GeoGameMap => ({
  id, name, description, artwork, color, category: "Regions",
  countryCodes: rawCountries.filter(c => c.continent === name).map(c => c.code),
});
const country = (id: string, code: string, description: string, color = "#4e8775"): GeoGameMap => ({
  id, name: rawCountries.find(c => c.code === code)!.name, description, color,
  countryCodes: [code], category: "Countries", artwork: code,
});
export const GEO_GAME_MAPS: readonly GeoGameMap[] = [
  { id: "", name: "World", category: "World", description: "One planet. Endless discoveries. Explore cities, small towns and country roads around the world.", artwork: "world", color: "#4e8775" },
  region("europe", "Europe", "Old towns, winding lanes and a new language around every corner.", "FR", "#789164"),
  region("asia", "Asia", "From bustling streets to mountain roads. Follow the unexpected.", "JP", "#b9885c"),
  region("africa", "Africa", "Big skies, coastal cities and roads stretching to the horizon.", "ZA", "#b9924d"),
  region("north-america", "North America", "Wide open highways, lively neighbourhoods and hidden small towns.", "US", "#4d9389"),
  region("south-america", "South America", "Andean landscapes, colourful streets and Atlantic coastlines.", "BR", "#7a9861"),
  region("oceania", "Oceania", "Coastal drives, outback roads and dramatic island scenery.", "AU", "#638ca5"),
  country("united-states", "US", "Small-town streets, national highways and coast-to-coast discoveries.", "#4d9389"),
  country("canada", "CA", "Mountain towns, lakeside roads and vibrant city neighbourhoods.", "#b9885c"),
  country("mexico", "MX", "Colourful plazas, desert roads and tropical coastlines.", "#7a9861"),
  country("brazil", "BR", "Coastal cities, interior towns and a country of contrasts.", "#7a9861"),
  country("argentina", "AR", "Patagonian roads, wine country and lively city streets.", "#638ca5"),
  country("chile", "CL", "Desert towns, Pacific coastlines and mountain landscapes.", "#b9924d"),
  country("united-kingdom", "GB", "Country lanes, seaside towns and familiar high streets."),
  country("ireland", "IE", "Village streets and winding roads through the green countryside.", "#7a9861"),
  country("france", "FR", "Village squares, alpine towns and sunlit southern streets."),
  country("spain", "ES", "Coastal towns, mountain villages and sun-soaked plazas.", "#b9924d"),
  country("portugal", "PT", "Atlantic villages, colourful tiled streets and inland roads.", "#4d9389"),
  country("italy", "IT", "Hill towns, lively piazzas and winding coastal roads.", "#b9885c"),
  country("germany", "DE", "Half-timbered towns, city streets and countryside discoveries."),
  country("netherlands", "NL", "Canal-side streets, quiet villages and open countryside.", "#b9885c"),
  country("norway", "NO", "Fjords, fishing villages and spectacular mountain roads.", "#638ca5"),
  country("sweden", "SE", "Forest roads, lakeside villages and Scandinavian city streets.", "#638ca5"),
  country("finland", "FI", "Lakes, forests and quiet towns under wide northern skies.", "#4d9389"),
  country("poland", "PL", "Historic squares, country roads and colourful neighbourhoods."),
  country("czechia", "CZ", "Village lanes, old town streets and rolling countryside."),
  country("turkey", "TR", "Mediterranean towns, Anatolian roads and layered city streets.", "#b9924d"),
  country("japan", "JP", "Mountain villages, coastal roads and neon-lit neighbourhoods.", "#b9885c"),
  country("australia", "AU", "Coastal towns, red dirt roads and wide open horizons.", "#b9924d"),
  country("new-zealand", "NZ", "Alpine towns, quiet beaches and unforgettable country roads.", "#4d9389"),
  country("south-africa", "ZA", "Mountain passes, coastal roads and colourful neighbourhoods.", "#7a9861"),
];
export function geoGameMap(id: string): GeoGameMap | null {
  return GEO_GAME_MAPS.find(map => map.id === id) ?? null;
}
export function locationInGeoMap(location: Pick<GeoGuessrLocation, "countryCode">, map: GeoGameMap): boolean {
  return !map.countryCodes || map.countryCodes.includes(location.countryCode);
}
