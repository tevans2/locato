// Development-only visual fixture. No simulated scores or imagery enter the production app.
import { createGeoGuessrScreen } from "../../src/ui/screens/GeoGuessrScreen";
import { indexCountries, rawCountries } from "../../src/core/countries";
import type { GeoGuessMapOptions } from "../../src/ui/components/GeoGuessMap";
import type { WorldCountryFeature } from "../../src/core/map";
import type { LngLatPoint } from "../../src/core/maptap/distance";
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
const svgNS = "http://www.w3.org/2000/svg";
const locations = [
  { countryCode: "IT", lat: 41.9, lng: 12.5 }, { countryCode: "JP", lat: 35.7, lng: 139.7 },
  { countryCode: "ZA", lat: -33.9, lng: 18.4 }, { countryCode: "BR", lat: -22.9, lng: -43.2 }, { countryCode: "CA", lat: 45.5, lng: -73.6 },
].map((point) => ({ ...point, heading: 0, label: "Fixture round" }));
const point = (p: LngLatPoint) => ({ x: p.lng + 180, y: 90 - p.lat });
function fixtureMap(options: GeoGuessMapOptions) {
  let accepts = true;
  const element = document.createElement("div");
  element.className = "geoguessr-map fixture-map";
  element.setAttribute("aria-label", "Preview world map. Click to place a guess.");
  element.style.background = "#14292b";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 360 180");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  const countries = document.createElementNS(svgNS, "g");
  const markers = document.createElementNS(svgNS, "g");
  svg.append(countries, markers);
  element.append(svg);
  void fetch("/assets/world-map.json").then(r => r.json()).then((features: WorldCountryFeature[]) => {
    for (const feature of features) {
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", polygons.map(polygon => polygon.map(ring => ring.map(([lng, lat], i) => `${i ? "L" : "M"}${lng + 180},${90 - lat}`).join(" ") + "Z").join(" ")).join(" "));
      path.setAttribute("fill", "#324542"); path.setAttribute("stroke", "#627469"); path.setAttribute("stroke-width", ".3");
      countries.append(path);
    }
  });
  function marker(p: LngLatPoint, color: string) {
    const xy = point(p); const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", String(xy.x)); circle.setAttribute("cy", String(xy.y)); circle.setAttribute("r", "2.8"); circle.setAttribute("fill", color); circle.setAttribute("stroke", "#fff"); circle.setAttribute("stroke-width", ".6"); markers.append(circle);
  }
  element.addEventListener("click", e => {
    if (!accepts) return;
    const transform = svg.getScreenCTM();
    if (!transform) return;
    const xy = new DOMPoint(e.clientX, e.clientY).matrixTransform(transform.inverse());
    const p = { lat: Math.max(-85, Math.min(85, 90 - xy.y)), lng: Math.max(-180, Math.min(180, xy.x - 180)) };
    markers.replaceChildren(); marker(p, "#d8ec99"); options.onGuessChange(p);
  }, { signal: options.signal });
  return { element, reset() { markers.replaceChildren(); accepts = true; }, setAcceptingGuesses(value: boolean) { accepts = value; }, resize() {}, destroy() {}, reveal(target: LngLatPoint, guesses: readonly LngLatPoint[]) {
    accepts = false; markers.replaceChildren();
    for (const guess of guesses) { const a = point(guess); const b = point(target); const line = document.createElementNS(svgNS, "line"); for (const [key, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#d8ec99", "stroke-width": .7, "stroke-dasharray": "2 1" })) line.setAttribute(key, String(value)); markers.append(line); marker(guess, "#d8ec99"); }
    marker(target, "#ef6a45");
  } };
}
const screen = createGeoGuessrScreen({ countryIndex: indexCountries(rawCountries), onHome: () => { location.href = "/"; }, onGameModeChange() {}, onDailyChallenge() {}, onMultiplayer() {} }, {
  createMap: fixtureMap,
  loadLocations: async () => locations,
  createPanorama(signal) {
    const element = document.createElement("div"); element.className = "geo-panorama";
    element.style.cssText = "background-color:#63755f;background-image:url('/.data/geoguessr-reference.png');background-repeat:no-repeat";
    // Frame only the street portion of the user's supplied reference, for local review.
    const observer = new ResizeObserver(() => { const s = Math.max(element.clientWidth / 1850, element.clientHeight / 1080); element.style.backgroundSize = `${2940 * s}px ${1912 * s}px`; element.style.backgroundPosition = `${-50 * s}px ${-560 * s}px`; });
    observer.observe(element); signal.addEventListener("abort", () => observer.disconnect(), { once: true });
    return { element, show: async p => ({ lat: p.lat, lng: p.lng }), reset() {}, destroy: () => observer.disconnect() };
  },
});
document.getElementById("app")!.append(screen.element);
const label = document.createElement("span"); label.textContent = "UI PREVIEW · SAMPLE SCENE & MAP"; label.style.cssText = "position:fixed;bottom:5px;left:12px;color:white;background:#14211e;padding:4px 7px;font:9px monospace;z-index:500;pointer-events:none"; document.body.append(label);
