import { loadGeoCatalogueLocations } from "../../src/ui/components/GeoLocationCatalogue";
// Development-only game preview using real Google Maps and Street View.
// Real imported locations by default; ?fixed=1 keeps visual QA repeatable. Scores stay local.
import { sampleGeoLocations } from "../../src/core/geoguessr";
import { GEO_WORLD_LOCATIONS } from "../../src/core/geoguessr/locations";
import { geoGameMap, locationInGeoMap } from "../../src/core/geoguessr/maps";
import { createGeoGuessrScreen } from "../../src/ui/screens/GeoGuessrScreen";
import { indexCountries, rawCountries } from "../../src/core/countries";
import { initializeTheme, setTheme } from "../../src/ui/theme";
import "../../src/styles/tokens.css";
import "../../src/styles/base.css";
import "../../src/styles/layout.css";
import "../../src/styles/game.css";
import "../../src/styles/geoguessr.css";
import "../../src/styles/worldsplit.css";
import "../../src/styles/board.css";
import "../../src/styles/multiplayer.css";
import "../../src/styles/auth.css";
import "../../src/styles/stats.css";
import "../../src/styles/friends.css";
import "../../src/styles/responsive.css";
import "../../src/styles/theme-refresh.css";
import "../../src/styles/experience-refresh.css";
import "../../src/styles/sfx.css";
import "../../src/styles/design-system.css";
import "../../src/styles/landing.css";
import "../../src/styles/geoguessr-play.css";

if (!import.meta.env.DEV) throw new Error("Development fixture only");
initializeTheme(localStorage);
const previewTheme = new URLSearchParams(location.search).get("theme");
if (previewTheme === "light" || previewTheme === "dark") setTheme(previewTheme);
const locations = [
  { countryCode: "IT", lat: 41.9, lng: 12.5 },
  { countryCode: "JP", lat: 35.7, lng: 139.7 },
  { countryCode: "ZA", lat: -33.9, lng: 18.4 },
  { countryCode: "BR", lat: -22.9, lng: -43.2 },
  { countryCode: "CA", lat: 45.5, lng: -73.6 },
].map(point => ({ ...point, heading: 0, label: "Preview round" }));
const screen = createGeoGuessrScreen({
  countryIndex: indexCountries(rawCountries),
  onHome: () => { location.href = "/"; }, onGameModeChange() {}, onDailyChallenge() {},
}, {
  loadLocations: async (signal, mapId) => !new URLSearchParams(location.search).has("fixed") ? loadGeoCatalogueLocations(signal, mapId) : mapId ? sampleGeoLocations("map-preview", GEO_WORLD_LOCATIONS.filter(location => locationInGeoMap(location, geoGameMap(mapId)!)), 20) : locations,
  postAttempt: async () => ({ serverAccepted: null, rank: null }),
});
document.getElementById("app")!.append(screen.element);
