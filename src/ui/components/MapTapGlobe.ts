import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LOCATO_THEME_EVENT, currentTheme } from "../theme";
import type { MapTapGuessResult } from "../../core/maptap";

const ESRI_ATTRIBUTION = "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const RESULT_LINE_COLOR_DARK = "#ffffff";
const RESULT_LINE_COLOR_LIGHT = "#33453c";

// Dark keeps the satellite imagery the mode shipped with; light swaps to a light cartographic
// basemap so every map surface follows the active theme.
function mapTapStyle(): maplibregl.StyleSpecification {
  const dark = currentTheme() === "dark";
  return {
    version: 8,
    // MapLibre GL JS v5 configures globe projection in the style object.
    projection: { type: "globe" },
    sources: {
      "esri-basemap": {
        type: "raster",
        tiles: [
          dark
            ? "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            : "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: ESRI_ATTRIBUTION,
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: "maptap-space-background",
        type: "background",
        paint: { "background-color": "rgba(0, 0, 0, 0)" },
      },
      {
        id: "esri-basemap-layer",
        type: "raster",
        source: "esri-basemap",
      },
    ],
  };
}

const RESULT_LINE_SOURCE_ID = "maptap-result-line";
const RESULT_LINE_LAYER_ID = "maptap-result-line-layer";
const EMPTY_LINE_DATA: Parameters<maplibregl.GeoJSONSource["setData"]>[0] = {
  type: "FeatureCollection",
  features: [],
};

export interface MapTapClick {
  readonly lat: number;
  readonly lng: number;
}

export interface MapTapGlobeOptions {
  readonly onGuess: (point: MapTapClick) => void;
  readonly signal: AbortSignal;
}

export interface MapTapMultiplayerGuess {
  readonly lat: number;
  readonly lng: number;
  readonly label: string;
  readonly color: string;
}

export interface MapTapGlobe {
  readonly element: HTMLElement;
  readonly reset: () => void;
  readonly reveal: (result: MapTapGuessResult) => void;
  readonly revealMultiplayer: (target: { lat: number; lng: number }, guesses: readonly MapTapMultiplayerGuess[]) => void;
  readonly setAcceptingGuesses: (accepting: boolean) => void;
  readonly destroy: () => void;
}

function createMarkerElement(className: string, label: string): HTMLElement {
  const marker = document.createElement("div");
  marker.className = className;
  marker.setAttribute("aria-label", label);
  marker.setAttribute("role", "img");
  return marker;
}

function resultLineData(result: MapTapGuessResult): Parameters<maplibregl.GeoJSONSource["setData"]>[0] {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [result.guess.lng, result.guess.lat],
            [result.target.lng, result.target.lat],
          ],
        },
      },
    ],
  };
}

export function createMapTapGlobe(options: MapTapGlobeOptions): MapTapGlobe {
  let acceptingGuesses = true;
  let guessMarker: maplibregl.Marker | null = null;
  let targetMarker: maplibregl.Marker | null = null;
  let extraMarkers: maplibregl.Marker[] = [];
  let destroyed = false;

  const element = document.createElement("div");
  element.className = "maptap-globe";

  const attribution = document.createElement("div");
  attribution.className = "maptap-attribution";
  attribution.textContent = "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

  const map = new maplibregl.Map({
    container: element,
    center: [12, 20],
    zoom: 1.2,
    minZoom: 0.4,
    maxZoom: 16,
    attributionControl: false,
    canvasContextAttributes: { alpha: true, antialias: true },
    style: mapTapStyle(),
  });

  element.append(attribution);

  function ensureLineLayer(): void {
    if (map.getSource(RESULT_LINE_SOURCE_ID) === undefined) {
      map.addSource(RESULT_LINE_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_LINE_DATA,
      });
    }
    if (map.getLayer(RESULT_LINE_LAYER_ID) === undefined) {
      map.addLayer({
        id: RESULT_LINE_LAYER_ID,
        type: "line",
        source: RESULT_LINE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-width": 3, "line-color": currentTheme() === "dark" ? RESULT_LINE_COLOR_DARK : RESULT_LINE_COLOR_LIGHT, "line-opacity": 0.9 },
      });
    }
  }

  let lastLineData: Parameters<maplibregl.GeoJSONSource["setData"]>[0] = EMPTY_LINE_DATA;

  function setLineData(data: Parameters<maplibregl.GeoJSONSource["setData"]>[0]): void {
    lastLineData = data;
    ensureLineLayer();
    const source = map.getSource(RESULT_LINE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(data);
  }

  function clearMarkers(): void {
    guessMarker?.remove();
    targetMarker?.remove();
    guessMarker = null;
    targetMarker = null;
    for (const m of extraMarkers) m.remove();
    extraMarkers = [];
  }

  map.on("load", () => {
    ensureLineLayer();
  });

  map.on("click", (event) => {
    if (!acceptingGuesses || destroyed) return;
    options.onGuess({ lng: event.lngLat.lng, lat: event.lngLat.lat });
  });

  function removeMap(): void {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener(LOCATO_THEME_EVENT, onThemeChange);
    map.remove();
  }

  // setStyle replaces all sources/layers, so re-add the result line and restore its data
  // once the new style is ready. DOM markers survive the swap.
  function onThemeChange(): void {
    if (destroyed) return;
    map.setStyle(mapTapStyle());
    map.once("styledata", () => {
      if (destroyed) return;
      ensureLineLayer();
      const source = map.getSource(RESULT_LINE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(lastLineData);
    });
  }

  window.addEventListener(LOCATO_THEME_EVENT, onThemeChange);

  options.signal.addEventListener("abort", removeMap);

  const resizeMap = () => map.resize();
  window.addEventListener("resize", resizeMap, { signal: options.signal });
  requestAnimationFrame(resizeMap);

  return {
    element,
    reset: () => {
      acceptingGuesses = true;
      clearMarkers();
      if (map.loaded()) setLineData(EMPTY_LINE_DATA);
    },
    reveal: (result) => {
      acceptingGuesses = false;
      clearMarkers();
      guessMarker = new maplibregl.Marker({ element: createMarkerElement("maptap-marker maptap-marker-guess", "Your guess"), anchor: "center" })
        .setLngLat([result.guess.lng, result.guess.lat])
        .addTo(map);
      targetMarker = new maplibregl.Marker({ element: createMarkerElement("maptap-marker maptap-marker-target", "Actual location"), anchor: "center" })
        .setLngLat([result.target.lng, result.target.lat])
        .addTo(map);
      setLineData(resultLineData(result));
      const bounds = new maplibregl.LngLatBounds([result.guess.lng, result.guess.lat], [result.guess.lng, result.guess.lat]).extend([result.target.lng, result.target.lat]);
      map.fitBounds(bounds, { padding: 90, duration: 800, maxZoom: 7 });
    },
    revealMultiplayer: (target, guesses) => {
      acceptingGuesses = false;
      clearMarkers();
      targetMarker = new maplibregl.Marker({ element: createMarkerElement("maptap-marker maptap-marker-target", "Actual location"), anchor: "center" })
        .setLngLat([target.lng, target.lat])
        .addTo(map);
      const bounds = new maplibregl.LngLatBounds([target.lng, target.lat], [target.lng, target.lat]);
      const lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      for (const guess of guesses) {
        const markerEl = createMarkerElement("maptap-marker", guess.label);
        markerEl.style.background = guess.color;
        const marker = new maplibregl.Marker({ element: markerEl, anchor: "center" })
          .setLngLat([guess.lng, guess.lat])
          .addTo(map);
        extraMarkers.push(marker);
        bounds.extend([guess.lng, guess.lat]);
        lineFeatures.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[guess.lng, guess.lat], [target.lng, target.lat]] } });
      }
      setLineData({ type: "FeatureCollection", features: lineFeatures });
      map.fitBounds(bounds, { padding: 90, duration: 800, maxZoom: 7 });
    },
    setAcceptingGuesses: (accepting) => {
      acceptingGuesses = accepting;
    },
    destroy: removeMap,
  };
}
